import { test } from "node:test";
import { WebSocket } from "ws";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { createServer as createHttp, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
import { FakeAdapter } from "@losperitos/adapters";
import { MAX_AGENTS_PER_WORKSPACE, type AgentCommandInput, OpenTerminalRequest } from "@losperitos/protocol";
import { AgentCommand, SaveConnectorRequest } from "@losperitos/protocol";
import { Core, CoreError } from "./core.js";
import { createServer } from "./server.js";

const sh = (cwd: string, ...args: string[]) => execFileSync(args[0]!, args.slice(1), { cwd, encoding: "utf8" });

function setup({ repo = true } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "lp-data-"));
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-ws-")));
  if (repo) {
    sh(folder, "git", "init", "-q", "-b", "main");
    sh(folder, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  }
  const adapter = new FakeAdapter();
  const core = new Core({ dataDir, adapters: [adapter], leadAdapter: "fake" });
  const workspace = core.openWorkspace(folder);
  // Starting the lead's session gives it a bridge token.
  core.sendMessage(workspace.id, { body: "plan", toAgentId: null, taskId: null });
  const tokenOf = (index: number) => adapter.starts[index]!.env!.LOSPERITOS_AGENT_TOKEN!;
  const as = (index: number, command: AgentCommandInput) =>
    core.agentCommand(tokenOf(index), AgentCommand.parse(command));
  return { core, adapter, folder, workspace, dataDir, as, tokenOf };
}

const tick = () => new Promise((done) => setTimeout(done, 20));

test("a task runs on its own branch and is merged only after approval", async () => {
  const { core, adapter, folder, workspace, as } = setup();
  const created = await as(0, { command: "task.create", title: "Add hello file", specialty: "developer" });
  assert.match(created.message, /assigned to Developer/);

  const [task] = core.listTasks(workspace.id);
  assert.equal(task!.status, "in_progress");
  assert.equal(task!.branch, "peritos/task-1-add-hello-file");
  assert.equal(task!.baseBranch, "main");
  assert.equal(adapter.starts[1]!.cwd, task!.worktree, "the member works inside the worktree");

  writeFileSync(join(task!.worktree!, "hello.txt"), "hi\n");
  await assert.rejects(
    as(1, { command: "task.done", report: { done: ["x"], tested: [], notVerified: [] } }),
    /uncommitted/,
  );
  sh(task!.worktree!, "git", "add", ".");
  sh(task!.worktree!, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "hello");

  await as(1, { command: "task.done", report: { done: ["added hello.txt"], tested: [], notVerified: ["nothing ran"] } });
  assert.equal(core.getTask(task!.id).status, "awaiting_approval");
  assert.match(await core.taskDiff(task!.id), /hello\.txt/);
  assert.ok(!existsSync(join(folder, "hello.txt")), "not merged before approval");

  const [approval] = core.waiting().approvals;
  assert.equal(approval!.kind, "merge");
  assert.match(approval!.detail, /Not verified: nothing ran/);
  await core.decideApproval(approval!.id, "approved");

  assert.equal(readFileSync(join(folder, "hello.txt"), "utf8"), "hi\n");
  assert.ok(!existsSync(task!.worktree!), "worktree removed");
  assert.equal(core.getTask(task!.id).status, "done");
  const member = core.listAgents(workspace.id).find((a) => a.role === "member")!;
  assert.equal(member.status, "stopped");
  assert.equal(member.taskId, null);
  await tick();
  assert.ok(core.listMessages(workspace.id).some((m) => m.body.startsWith("Echo: Task #1")), "lead was told");
});

test("a rejected merge sends the task back to the member", async () => {
  const { core, workspace, as } = setup();
  await as(0, { command: "task.create", title: "Change" });
  const [task] = core.listTasks(workspace.id);
  sh(task!.worktree!, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "c");
  await as(1, { command: "task.done", report: { done: ["c"], tested: [], notVerified: [] } });
  await core.decideApproval(core.waiting().approvals[0]!.id, "rejected");
  assert.equal(core.getTask(task!.id).status, "in_progress");
  assert.ok(existsSync(task!.worktree!));
});

test("a failed merge leaves the approval pending and the repo untouched", async () => {
  const { core, folder, workspace, as } = setup();
  await as(0, { command: "task.create", title: "Conflict" });
  const [task] = core.listTasks(workspace.id);
  const commit = (dir: string, text: string) => {
    writeFileSync(join(dir, "a.txt"), text);
    sh(dir, "git", "add", ".");
    sh(dir, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", text);
  };
  commit(task!.worktree!, "theirs");
  commit(folder, "ours");
  await as(1, { command: "task.done", report: { done: ["a"], tested: [], notVerified: [] } });
  const [approval] = core.waiting().approvals;
  await assert.rejects(core.decideApproval(approval!.id, "approved"), /Could not merge/);
  assert.equal(core.waiting().approvals.length, 1);
  assert.equal(readFileSync(join(folder, "a.txt"), "utf8"), "ours");
  assert.ok(!existsSync(join(folder, ".git", "MERGE_HEAD")), "the failed merge was aborted");
  assert.equal(sh(folder, "git", "status", "--porcelain").trim(), "", "nothing left behind in the checkout");
});

test("outside a git repo a task works in the folder and closes without a merge", async () => {
  const { core, workspace, as } = setup({ repo: false });
  await as(0, { command: "task.create", title: "No repo" });
  const [task] = core.listTasks(workspace.id);
  assert.equal(task!.branch, null);
  const result = await as(1, { command: "task.done", report: { done: ["x"], tested: [], notVerified: [] } });
  assert.match(result.message, /nothing to merge/);
  assert.equal(core.getTask(task!.id).status, "done");
  assert.equal(core.waiting().approvals.length, 0);
});

test("the team is capped; extra tasks queue and start when a seat frees up", async () => {
  const { core, workspace, as } = setup({ repo: false });
  for (let i = 1; i <= MAX_AGENTS_PER_WORKSPACE; i++) {
    await as(0, { command: "task.create", title: `Task ${i}` });
  }
  const statuses = () => core.listTasks(workspace.id).map((t) => t.status);
  assert.equal(statuses().filter((s) => s === "in_progress").length, MAX_AGENTS_PER_WORKSPACE - 1);
  assert.equal(statuses().at(-1), "queued");
  assert.equal(core.listAgents(workspace.id).length, MAX_AGENTS_PER_WORKSPACE);

  await as(1, { command: "task.done", report: { done: ["x"], tested: [], notVerified: [] } });
  assert.deepEqual(statuses().slice(0, 1), ["done"]);
  assert.equal(statuses().at(-1), "in_progress");
  assert.equal(core.listAgents(workspace.id).length, MAX_AGENTS_PER_WORKSPACE, "the freed member is reused");
});

test("agents can only do what their role allows", async () => {
  const { core, workspace, as } = setup({ repo: false });
  await as(0, { command: "task.create", title: "One" });
  await assert.rejects(as(1, { command: "task.create", title: "Two" }), /Only the lead/);
  await assert.rejects(as(0, { command: "task.done", report: { done: [], tested: [], notVerified: [] } }), /no task/);
  await assert.rejects(core.agentCommand("nope", { command: "task.list" }), CoreError);
  await assert.rejects(as(0, { command: "send", to: "Nobody", body: "hi" }), /No agent named/);

  await as(1, { command: "send", to: "lead", body: "question about scope" });
  await as(1, { command: "ask", body: "Which?", options: ["A", "B"] });
  await as(1, { command: "lesson", text: "Always run the tests" });
  await tick();
  assert.ok(core.listMessages(workspace.id).some((m) => m.body === "Echo: Message from Developer: question about scope"));
  assert.equal(core.waiting().questions.length, 1);
  assert.equal(core.listLessons(workspace.id)[0]!.status, "proposed");
  assert.match((await as(0, { command: "task.list" })).message, /#1 \[in_progress\] One \(Developer\)/);
});

test("the peritos CLI reaches the core over HTTP with the agent's own token", async () => {
  const { core, adapter, as } = setup({ repo: false });
  const server = createServer(core, "user-token");
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  core.setBridge(url, fileURLToPath(new URL("../../cli/dist/main.js", import.meta.url)));
  try {
    // A session started after setBridge gets the URL and PATH.
    await as(0, { command: "task.create", title: "From CLI test" });
    const env = { ...process.env, ...adapter.starts[1]!.env };
    assert.equal(env.LOSPERITOS_URL, url);
    const { execFile } = await import("node:child_process");
    const run = (...args: string[]) =>
      new Promise<{ code: number; out: string }>((done) =>
        execFile("peritos", args, { env }, (err, stdout, stderr) =>
          done({ code: err ? 1 : 0, out: stdout + stderr }),
        ),
      );
    const list = await run("task", "list");
    assert.deepEqual([list.code, list.out.trim()], [0, "#1 [in_progress] From CLI test (Developer)"]);
    const denied = await run("task", "create", "--title", "x");
    assert.equal(denied.code, 1);
    assert.match(denied.out, /Only the lead/);
    assert.equal((await run("bogus")).code, 1);

    const asUser = await fetch(`${url}/agent`, {
      method: "POST",
      headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
      body: JSON.stringify({ command: "task.list" }),
    });
    assert.equal(asUser.status, 401, "the user token is not an agent token");
  } finally {
    await core.close();
    server.close();
  }
});

test("an agent can be nicknamed, and teammates can address it by that name", async () => {
  const { core, workspace, as } = setup({ repo: false });
  await as(0, { command: "task.create", title: "One" });
  const member = core.listAgents(workspace.id).find((a) => a.role === "member")!;
  assert.equal(core.renameAgent(member.id, "  Ada  ").nickname, "Ada");
  await as(0, { command: "send", to: "ada", body: "hello" });
  assert.equal(core.listMessages(workspace.id).at(-1)!.toAgentId, member.id);

  const lead = core.listAgents(workspace.id).find((a) => a.role === "lead")!;
  assert.throws(() => core.renameAgent(lead.id, "ADA"), /already called/);
  assert.equal(core.renameAgent(member.id, "").nickname, null);
});

test("a remembered answer becomes a lesson that later agents are given", async () => {
  const { core, adapter, workspace, as } = setup({ repo: false });
  await as(0, { command: "task.create", title: "One" });
  await as(1, { command: "ask", body: "Tabs or spaces?", options: ["Tabs", "Spaces"], recommended: "Spaces" });
  const [question] = core.waiting().questions;
  assert.equal(question!.question!.recommended, "Spaces");

  core.answerQuestion(question!.id, "Spaces", true);
  const [lesson] = core.listLessons(workspace.id);
  assert.equal(lesson!.status, "accepted");
  assert.match(lesson!.text, /Tabs or spaces\?.*Spaces/);

  // The next agent to be seated starts with the lesson in its instructions.
  await as(0, { command: "task.create", title: "Two", specialty: "tester" });
  assert.match(adapter.starts.at(-1)!.systemPrompt!, /Standing lessons[\s\S]*Tabs or spaces/);

  // A recommendation that is not among the options is dropped.
  await as(1, { command: "ask", body: "Again?", options: ["A"], recommended: "Z" });
  assert.equal(core.waiting().questions.at(-1)!.question!.recommended, null);
});

test("a held tool call waits for the user and is answered by the decision", async () => {
  const { core, workspace, tokenOf } = setup({ repo: false });
  const lead = core.listAgents(workspace.id)[0]!;
  const held = core.requestPermission(tokenOf(0), "Bash", { command: "git push origin main", description: "Publish the branch" });
  const [approval] = core.waiting().approvals;
  assert.equal(approval!.kind, "command");
  assert.match(approval!.title, /^Bash: git push origin main$/);
  assert.equal(approval!.reversible, false);
  assert.equal(core.listAgents(workspace.id)[0]!.status, "awaiting_approval");

  // Let the reply to the opening message land first, so only new messages are counted.
  await tick();
  const before = core.listMessages(workspace.id).length;
  await core.decideApproval(approval!.id, "approved");
  assert.equal(await held, "approved");
  assert.equal(core.listAgents(workspace.id)[0]!.status, "working");
  await tick();
  assert.equal(core.listMessages(workspace.id).length, before, "no extra message: the tool result is the answer");

  // A call still held when the agent goes away is refused, not left hanging.
  const orphan = core.requestPermission(tokenOf(0), "Bash", { command: "rm -rf build" });
  await core.stopAgent(lead.id);
  assert.equal(await orphan, "rejected");
  assert.equal(core.waiting().approvals.length, 0);
  assert.throws(() => core.requestPermission("nope", "Bash", {}), CoreError);
});

test("an agent that hits the usage limit waits and then carries on by itself", async () => {
  const { core, workspace } = setup({ repo: false });
  await tick();
  core.sendMessage(workspace.id, { body: "/limit", toAgentId: null, taskId: null });
  await tick();
  const limited = core.listAgents(workspace.id)[0]!;
  assert.equal(limited.status, "limited");
  assert.ok(limited.resumeAt);

  // The fake's limit lifts after 60 ms; the core then nudges the agent without being asked.
  for (let i = 0; i < 100 && core.listAgents(workspace.id)[0]!.status !== "idle"; i++) await tick();
  assert.equal(core.listAgents(workspace.id)[0]!.status, "idle");
  assert.match(core.listMessages(workspace.id).at(-1)!.body, /usage limit has reset/);
});

test("a conversation is kept across restarts, and each new file starts a fresh one", async () => {
  const { core, adapter, workspace, as, dataDir } = setup({ repo: false });
  const first = adapter.starts[0]!;
  assert.ok(first.sessionId);
  assert.equal(first.resume, false);
  await as(0, { command: "task.create", title: "Small one", effort: "small" });
  assert.equal(adapter.starts[1]!.model, "haiku");
  assert.equal(adapter.starts[0]!.model, undefined, "the lead keeps the tool's default model");
  await core.close();

  // A new core on the same data: the lead reopens its conversation.
  const again = new FakeAdapter();
  const restarted = new Core({ dataDir, adapters: [again], leadAdapter: "fake" });
  restarted.sendMessage(workspace.id, { body: "back", toAgentId: null, taskId: null });
  assert.equal(again.starts[0]!.sessionId, first.sessionId);
  assert.equal(again.starts[0]!.resume, true);
  await restarted.close();
});

test("the user can write tasks, order them, pause the hand-out and cancel", async () => {
  const { core, workspace } = setup({ repo: false });
  const base = { description: "", specialty: "developer", effort: "normal" as const, priority: "normal" as const, dependsOn: [], start: true };
  core.updateWorkspace(workspace.id, { dispatchPaused: true });

  const low = await core.createTask(workspace.id, { ...base, title: "Low", priority: "low" });
  const high = await core.createTask(workspace.id, { ...base, title: "High", priority: "high" });
  const later = await core.createTask(workspace.id, { ...base, title: "Later", priority: "high", dependsOn: [high.id] });
  const draft = await core.createTask(workspace.id, { ...base, title: "Draft", start: false });
  const status = (id: string) => core.getTask(id).status;
  assert.deepEqual([low, high, later, draft].map((t) => status(t.id)), ["queued", "queued", "queued", "draft"], "paused: nothing starts");

  // Details can still change while a task waits.
  assert.equal((await core.updateTask(draft.id, { title: "Draft, renamed" })).title, "Draft, renamed");
  await assert.rejects(core.updateTask(later.id, { dependsOn: [later.id] }), /wait for itself/);

  core.updateWorkspace(workspace.id, { dispatchPaused: false });
  // Tasks are handed out one after another, so wait for the last of them.
  for (let i = 0; i < 50 && status(low.id) !== "in_progress"; i++) await tick();
  assert.equal(status(high.id), "in_progress");
  assert.equal(status(low.id), "in_progress");
  assert.equal(status(later.id), "queued", "waits for the task it depends on");
  assert.equal(status(draft.id), "draft", "a draft waits for the user");
  const started = core.listTasks(workspace.id).filter((t) => t.status === "in_progress");
  const seats = core.listAgents(workspace.id).filter((a) => a.role === "member");
  assert.equal(seats.find((a) => a.taskId === high.id)!.name, "Developer", "the urgent task took the first seat");
  assert.equal(started.length, 2);

  // Once handed out, a task can only be cancelled; cancelling frees its perito.
  await assert.rejects(core.updateTask(high.id, { title: "Too late" }), /handed out/);
  assert.equal((await core.updateTask(high.id, { status: "cancelled" })).status, "cancelled");
  assert.equal(core.listAgents(workspace.id).find((a) => a.name === "Developer")!.taskId, null);
  assert.equal(status(later.id), "queued", "a cancelled task does not unblock what waited for it");
  await assert.rejects(core.updateTask(high.id, { status: "queued" }), /already closed/);
});

test("the lead can make one task wait for another", async () => {
  const { core, workspace, as } = setup({ repo: false });
  await as(0, { command: "task.create", title: "First" });
  const reply = await as(0, { command: "task.create", title: "Second", after: [1] });
  assert.match(reply.message, /starts when the tasks it waits for are closed/);
  await assert.rejects(as(0, { command: "task.create", title: "Third", after: [99] }), /no task #99/);

  await as(1, { command: "task.done", report: { done: ["x"], tested: [], notVerified: [] } });
  assert.equal(core.listTasks(workspace.id).find((t) => t.title === "Second")!.status, "in_progress");
});

test("a marketing workspace briefs its team as marketers and lists the files they hand in", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "lp-data-"));
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-ws-")));
  const adapter = new FakeAdapter();
  const core = new Core({ dataDir, adapters: [adapter], leadAdapter: "fake" });
  const workspace = core.openWorkspace(folder, "marketing");
  assert.equal(workspace.kind, "marketing");
  assert.equal(core.openWorkspace(folder, "content").kind, "marketing", "the kind is chosen once");

  core.sendMessage(workspace.id, { body: "plan", toAgentId: null, taskId: null });
  const as = (index: number, command: AgentCommandInput) =>
    core.agentCommand(adapter.starts[index]!.env!.LOSPERITOS_AGENT_TOKEN!, AgentCommand.parse(command));
  assert.match(adapter.starts[0]!.systemPrompt!, /marketing specialists/);
  assert.match(adapter.starts[0]!.systemPrompt!, /--specialty <seo\|copywriter/);

  await as(0, { command: "task.create", title: "Keyword plan", specialty: "seo" });
  const member = adapter.starts[1]!.systemPrompt!;
  assert.match(member, /cannot publish/);
  assert.match(member, /draft folder of your own/);
  assert.doesNotMatch(member, /commit your changes/, "no git talk outside a repository");

  // Outside git the member writes to a draft folder; nothing reaches the project unsealed.
  let [task] = core.listTasks(workspace.id);
  assert.equal(task!.branch, null);
  assert.equal(adapter.starts[1]!.cwd, task!.worktree);
  assert.ok(adapter.starts[1]!.addDirs!.includes(folder), "the project is readable from the draft");
  writeFileSync(join(folder, "brief.md"), "old\n");
  writeFileSync(join(task!.worktree!, "keywords.md"), "# Keywords\n");
  writeFileSync(join(task!.worktree!, "brief.md"), "new\n");
  await as(1, { command: "task.done", report: { done: ["plan"], tested: [], notVerified: [] } });
  [task] = core.listTasks(workspace.id);
  assert.equal(task!.status, "awaiting_approval");
  assert.deepEqual(task!.report!.files, ["brief.md", "keywords.md"], "listed from the draft itself");
  assert.ok(!existsSync(join(folder, "keywords.md")), "not in the project before approval");

  const [approval] = core.waiting().approvals;
  assert.deepEqual(approval!.steps, ["Replace brief.md", "Add keywords.md", "Remove the draft"]);
  assert.equal(approval!.reversible, false, "replacing a file outside git cannot be undone");
  assert.equal(Buffer.from(core.taskFile(task!.id, "keywords.md").data, "base64").toString(), "# Keywords\n", "previewed from the draft");
  const draftDir = task!.worktree!;
  await core.decideApproval(approval!.id, "approved");
  assert.equal(readFileSync(join(folder, "brief.md"), "utf8"), "new\n");
  assert.ok(!existsSync(draftDir), "draft removed");
  assert.equal(core.getTask(task!.id).status, "done");

  const file = core.taskFile(task!.id, "keywords.md");
  assert.equal(file.mime, "text/markdown");
  assert.equal(Buffer.from(file.data, "base64").toString(), "# Keywords\n");
  assert.throws(() => core.taskFile(task!.id, "../outside.txt"), /No file/);
  assert.throws(() => core.taskFile(task!.id, "/etc/hosts"), /No file/);

  // Video, sound and PDF are served as bytes, to the user alone.
  writeFileSync(join(folder, "ad.mp4"), Buffer.from([0, 1, 2, 250, 251]));
  const server = createServer(core, "user-token");
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const raw = (path: string, token = "user-token") =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/tasks/${task!.id}/raw?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  const video = await raw("ad.mp4");
  assert.equal(video.headers.get("content-type"), "video/mp4");
  assert.deepEqual([...new Uint8Array(await video.arrayBuffer())], [0, 1, 2, 250, 251]);
  assert.equal((await raw("ad.mp4", "wrong")).status, 401);
  assert.equal((await raw("../outside.txt")).status, 404);
  server.close();

  core.updateWorkspace(workspace.id, { kind: "content" });
  assert.equal(core.listWorkspaces()[0]!.kind, "content", "settings can change it later");
});

test("in a repository the files a task changed come from git, whatever the agent listed", async () => {
  const { core, workspace, as } = setup();
  await as(0, { command: "task.create", title: "Write ad copy", specialty: "copywriter" });
  const [task] = core.listTasks(workspace.id);
  writeFileSync(join(task!.worktree!, "ads.md"), "Buy now\n");
  sh(task!.worktree!, "git", "add", ".");
  sh(task!.worktree!, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "ads");
  await as(1, { command: "task.done", report: { done: ["copy"], tested: [], notVerified: [] } });
  assert.deepEqual(core.getTask(task!.id).report!.files, ["ads.md"]);
  assert.equal(Buffer.from(core.taskFile(task!.id, "ads.md").data, "base64").toString(), "Buy now\n", "read from the worktree before the merge");
});

test("a rejected draft goes back to its writer, and nothing reaches the project", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "lp-data-"));
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-ws-")));
  const adapter = new FakeAdapter();
  const core = new Core({ dataDir, adapters: [adapter], leadAdapter: "fake" });
  const workspace = core.openWorkspace(folder, "content");
  core.sendMessage(workspace.id, { body: "plan", toAgentId: null, taskId: null });
  const as = (index: number, command: AgentCommandInput) =>
    core.agentCommand(adapter.starts[index]!.env!.LOSPERITOS_AGENT_TOKEN!, AgentCommand.parse(command));
  assert.match(adapter.starts[0]!.systemPrompt!, /writers and editors/);
  assert.match(adapter.starts[0]!.systemPrompt!, /at least --effort normal/);

  await as(0, { command: "task.create", title: "Newsletter", specialty: "writer" });
  const [task] = core.listTasks(workspace.id);
  const draft = join(task!.worktree!, "newsletter.md");
  writeFileSync(draft, "first try\n");
  await as(1, { command: "task.done", report: { done: ["draft"], tested: [], notVerified: [] } });
  await core.decideApproval(core.waiting().approvals[0]!.id, "rejected");

  assert.equal(core.getTask(task!.id).status, "in_progress", "back with the writer");
  assert.ok(existsSync(draft), "the draft is kept to be worked on");
  assert.ok(!existsSync(join(folder, "newsletter.md")));

  writeFileSync(draft, "second try\n");
  await as(1, { command: "task.done", report: { done: ["rewrote it"], tested: [], notVerified: [] } });
  await core.decideApproval(core.waiting().approvals[0]!.id, "approved");
  assert.equal(readFileSync(join(folder, "newsletter.md"), "utf8"), "second try\n");

  // An empty draft has nothing to seal.
  await as(0, { command: "task.create", title: "Nothing to write", specialty: "editor" });
  await as(2, { command: "task.done", report: { done: ["nothing needed"], tested: [], notVerified: [] } });
  assert.equal(core.listTasks(workspace.id)[1]!.status, "done");
  assert.equal(core.waiting().approvals.length, 0);
});

test("tasks carry labels, and the estimate learns from what closed tasks cost", async () => {
  const { core, workspace, as } = setup({ repo: false });
  const guess = core.estimate(workspace.id);
  assert.deepEqual(guess.small, { usd: 0.1, tasks: 0 }, "a built-in guess until something has closed");

  await as(0, { command: "task.create", title: "Tagged", effort: "small", labels: ["Launch", " blog "] });
  const [task] = core.listTasks(workspace.id);
  assert.deepEqual(task!.labels, ["launch", "blog"], "labels are tidied");
  await tick();
  await as(1, { command: "task.done", report: { done: ["x"], tested: [], notVerified: [] } });
  await tick();
  const learned = core.estimate(workspace.id);
  assert.equal(learned.small!.tasks, 1);
  assert.ok(learned.small!.usd > 0 && learned.small!.usd < 0.1, "the fake agent's turns cost a cent each");
  assert.equal(learned.large!.tasks, 0);

  const draft = await core.createTask(workspace.id, {
    title: "Later", description: "", specialty: "developer", effort: "normal", priority: "normal", dependsOn: [], labels: ["q3"], start: false,
  });
  assert.deepEqual((await core.updateTask(draft.id, { labels: ["q4"] })).labels, ["q4"]);
});

test("a connector reaches the team, keeps its secrets, and seals every call not set free", async () => {
  const { core, adapter, workspace, dataDir, folder, tokenOf, as } = setup({ repo: false });
  const save = (request: Record<string, unknown>) => core.saveConnector(workspace.id, SaveConnectorRequest.parse(request));
  const [listed] = save({
    id: "search-console",
    name: "Search Console",
    command: "npx",
    args: ["-y", "some-mcp-server"],
    secrets: { API_KEY: "s3cret" },
    free: ["get_*", "list_sites"],
  });
  assert.deepEqual(listed!.secretNames, ["API_KEY"]);
  assert.ok(!JSON.stringify(core.listConnectors(workspace.id)).includes("s3cret"), "values are never read back");
  // Kept with the machine's own state, readable by the user alone, and not in the project folder.
  const file = join(dataDir, "connectors.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!existsSync(join(folder, ".losperitos", "connectors.json")));

  // Saving again without the secret keeps it; an empty value removes it.
  save({ id: "search-console", name: "Search Console", command: "npx", args: [], free: ["get_*"] });
  assert.deepEqual(core.listConnectors(workspace.id)[0]!.secretNames, ["API_KEY"]);
  assert.throws(() => SaveConnectorRequest.parse({ id: "peritos", name: "x", command: "x" }));
  assert.throws(() => SaveConnectorRequest.parse({ id: "both", name: "x", command: "x", url: "https://example.com/mcp" }));
  assert.throws(() => SaveConnectorRequest.parse({ id: "neither", name: "x" }));

  // The next agent to sit down is given the connector and told about it.
  await as(0, { command: "task.create", title: "Look at search data", specialty: "developer" });
  const start = adapter.starts.at(-1)!;
  assert.deepEqual(start.connectors, { "search-console": { command: "npx", args: [], env: { API_KEY: "s3cret" } } });
  assert.match(start.systemPrompt!, /Search Console \(id: search-console\)/);

  // A tool set free goes straight through; any other waits for the seal.
  assert.equal(await core.requestPermission(tokenOf(1), "mcp__search-console__get_rows", { site: "example.com" }), "approved");
  assert.equal(core.waiting().approvals.length, 0);
  const held = core.requestPermission(tokenOf(1), "mcp__search-console__submit_sitemap", { url: "https://example.com/sitemap.xml" });
  const [approval] = core.waiting().approvals;
  assert.equal(approval!.kind, "connector");
  assert.equal(approval!.title, "Search Console: submit_sitemap");
  assert.match(approval!.detail, /sitemap\.xml/);
  assert.equal(approval!.reversible, false);
  await core.decideApproval(approval!.id, "rejected");
  assert.equal(await held, "rejected");

  // A tool of a server the bureau does not know is treated as any other command.
  void core.requestPermission(tokenOf(1), "mcp__other__get_rows", {});
  assert.equal(core.waiting().approvals[0]!.kind, "command");

  save({ id: "ads", name: "Ads", url: "https://example.com/mcp", secrets: { Authorization: "Bearer t", Gone: "" } });
  assert.deepEqual(core.listConnectors(workspace.id).map((c) => c.id), ["search-console", "ads"]);
  assert.deepEqual(core.removeConnector(workspace.id, "search-console").map((c) => c.id), ["ads"]);
  assert.deepEqual(core.listConnectors(workspace.id)[0]!.secretNames, ["Authorization"]);
});

test("a member that stops without a report is reminded once, then the user is asked in its name", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "lp-data-"));
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-ws-")));
  const adapter = new FakeAdapter();
  const core = new Core({ dataDir, adapters: [adapter], leadAdapter: "fake", stallMs: 30 });
  const workspace = core.openWorkspace(folder);
  core.sendMessage(workspace.id, { body: "plan", toAgentId: null, taskId: null });
  const token = () => adapter.starts[0]!.env!.LOSPERITOS_AGENT_TOKEN!;
  await core.agentCommand(token(), AgentCommand.parse({ command: "task.create", title: "Make the picture", specialty: "designer" }));
  const member = () => core.listAgents(workspace.id).find((agent) => agent.role === "member")!;
  const said = () => core.listMessages(workspace.id).map((message) => message.body);

  // Its first turn ends with the task open: after a pause it is reminded, not reported to the user.
  await new Promise((done) => setTimeout(done, 60));
  assert.ok(said().some((body) => /^Echo: Your turn ended but task #1 is still open/.test(body)), "the reminder reached it");
  assert.equal(core.waiting().questions.length, 0);

  // It stops again: now the user hears of it, with what the member last said.
  await new Promise((done) => setTimeout(done, 80));
  const [question] = core.waiting().questions;
  assert.match(question!.body, /^Task #1 stopped without a report\. Last said:\nEcho: Your turn ended/);
  assert.equal(member().status, "asking");
  assert.equal(core.getTask(member().taskId!).status, "in_progress");

  // The answer goes to the member, and it is not asked about again while it works.
  core.answerQuestion(question!.id, "Credit added, try again", false);
  await tick();
  assert.ok(said().some((body) => body.includes("Credit added, try again")));
  await core.close();
});

test("a connector's tools can be listed, a sealed tool remembered, and a change reaches the team", async () => {
  const { core, adapter, workspace, tokenOf, as } = setup({ repo: false });
  // A stand-in service: two tools, one of which says it only reads.
  const serverFile = join(mkdtempSync(join(tmpdir(), "lp-mcp-")), "server.mjs");
  writeFileSync(
    serverFile,
    `import { createInterface } from "node:readline";
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
console.log("starting up");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === "initialize") return reply(message.id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "shop", version: process.env.SHOP_KEY } });
  if (message.method === "tools/list") return reply(message.id, { tools: [
    { name: "get_slogan", description: "Read the slogan.\\nSecond line.", annotations: { readOnlyHint: true }, inputSchema: { type: "object" } },
    { name: "publish_slogan", description: "Publish a slogan.", inputSchema: { type: "object" } },
  ] });
});
`,
  );
  const connector = { id: "shop", name: "Shop", command: process.execPath, args: [serverFile], secrets: { SHOP_KEY: "k" } };
  core.saveConnector(workspace.id, SaveConnectorRequest.parse(connector));
  assert.deepEqual((await core.connectorTools(workspace.id, "shop")).tools, [
    { name: "get_slogan", description: "Read the slogan.", readOnly: true },
    { name: "publish_slogan", description: "Publish a slogan.", readOnly: null },
  ]);
  await assert.rejects(core.connectorTools(workspace.id, "nope"), /No connector/);
  core.saveConnector(workspace.id, SaveConnectorRequest.parse({ id: "broken", name: "Broken", command: "/no/such/program" }));
  await assert.rejects(core.connectorTools(workspace.id, "broken"), /Cannot run/);
  core.removeConnector(workspace.id, "broken");

  // Sealing a call with "do not ask again" frees that tool alone.
  // Adding the connector ended the lead's idle session; the next message starts it again.
  await tick();
  core.sendMessage(workspace.id, { body: "carry on", toAgentId: null, taskId: null });
  const leadAt = adapter.starts.length - 1;
  const memberToken = () => tokenOf(leadAt + 1);
  await as(leadAt, { command: "task.create", title: "Publish", specialty: "developer" });
  const held = core.requestPermission(memberToken(), "mcp__shop__publish_slogan", { slogan: "New" });
  const [approval] = core.waiting().approvals;
  assert.deepEqual(approval!.call, { connectorId: "shop", tool: "publish_slogan" });
  await core.decideApproval(approval!.id, "approved", true);
  assert.equal(await held, "approved");
  assert.deepEqual(core.listConnectors(workspace.id)[0]!.free, ["publish_slogan"]);
  assert.equal(await core.requestPermission(memberToken(), "mcp__shop__publish_slogan", { slogan: "Again" }), "approved");
  assert.equal(core.waiting().approvals.length, 0);
  // A refusal is never remembered as a yes.
  const other = core.requestPermission(memberToken(), "mcp__shop__get_slogan", {});
  await core.decideApproval(core.waiting().approvals[0]!.id, "rejected", true);
  assert.equal(await other, "rejected");
  assert.deepEqual(core.listConnectors(workspace.id)[0]!.free, ["publish_slogan"]);

  // Changing how the server is reached ends idle sessions, so the next message starts them on the new one.
  await tick();
  const lead = core.listAgents(workspace.id)[0]!;
  assert.equal(lead.status, "idle");
  const startsBefore = adapter.starts.length;
  core.saveConnector(workspace.id, SaveConnectorRequest.parse({ ...connector, free: ["publish_slogan", "get_*"] }));
  await tick();
  assert.equal(core.listAgents(workspace.id)[0]!.status, "idle", "only the free list changed: nobody is restarted");
  core.saveConnector(workspace.id, SaveConnectorRequest.parse({ ...connector, args: [serverFile, "--v2"], free: ["get_*"] }));
  await tick();
  assert.equal(core.listAgents(workspace.id)[0]!.status, "stopped");
  core.sendMessage(workspace.id, { body: "go on", toAgentId: null, taskId: null });
  assert.equal(adapter.starts.length, startsBefore + 1);
  assert.equal(adapter.starts.at(-1)!.resume, true, "on the same conversation");
  assert.deepEqual((adapter.starts.at(-1)!.connectors!.shop as { args: string[] }).args, [serverFile, "--v2"]);
  await core.close();
});

test("a draft is kept apart from the project, which is read-only to it; what changes there anyway is shown", async () => {
  const { core, adapter, folder, workspace, dataDir, as } = setup({ repo: false });
  core.updateWorkspace(workspace.id, { kind: "marketing" });
  writeFileSync(join(folder, "brief.md"), "old\n");
  await as(0, { command: "task.create", title: "Keyword plan", specialty: "seo" });
  const [task] = core.listTasks(workspace.id);
  assert.ok(task!.worktree!.startsWith(join(dataDir, "drafts")), "the draft is outside the project folder");
  assert.deepEqual(adapter.starts[1]!.readOnlyDirs, [folder]);
  assert.deepEqual(adapter.starts[0]!.readOnlyDirs, [], "the lead works in the folder itself");

  // The member writes one file where it should, and two straight into the project.
  writeFileSync(join(task!.worktree!, "keywords.md"), "# Keywords\n");
  writeFileSync(join(folder, "brief.md"), "changed in place, and longer\n");
  writeFileSync(join(folder, "stray.md"), "x\n");
  await as(1, { command: "task.done", report: { done: ["plan"], tested: [], notVerified: [] } });
  const [approval] = core.waiting().approvals;
  assert.match(approval!.detail, /Changed in the project outside the draft while this task ran: brief\.md, stray\.md$/);
  assert.ok(core.listMessages(workspace.id).some((m) => m.author.kind === "system" && /^Task #1: Changed in the project outside the draft/.test(m.body)));
  assert.deepEqual(approval!.steps, ["Add keywords.md", "Remove the draft"]);
  // Shown, not undone: the user may have made those changes.
  assert.equal(readFileSync(join(folder, "brief.md"), "utf8"), "changed in place, and longer\n");
  await core.decideApproval(approval!.id, "approved");
  assert.ok(existsSync(join(folder, "keywords.md")));
  assert.ok(!existsSync(task!.worktree!) && !existsSync(task!.worktree! + ".snapshot.json"), "draft and its picture removed");
});

test("the code panel reads the repository: branch, commits, task branches and uncommitted changes", async () => {
  const { core, folder, workspace, as } = setup();
  writeFileSync(join(folder, "a.txt"), "one\n");
  sh(folder, "git", "add", ".");
  sh(folder, "git", "-c", "user.name=Ada", "-c", "user.email=a@a", "commit", "-q", "-m", "Add a");
  await as(0, { command: "task.create", title: "Add b", specialty: "developer" });
  const [task] = core.listTasks(workspace.id);
  writeFileSync(join(task!.worktree!, "b.txt"), "two\n");
  sh(task!.worktree!, "git", "add", ".");
  sh(task!.worktree!, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "Add b");
  writeFileSync(join(folder, "a.txt"), "one\nmore\n");
  writeFileSync(join(folder, "new file.txt"), "x\n");

  const repo = await core.repo(workspace.id);
  assert.equal(repo.branch, "main");
  assert.deepEqual(repo.commits.map((c) => [c.subject, c.author]), [["Add a", "Ada"], ["init", "t"]]);
  assert.deepEqual(repo.changes, [{ path: "a.txt", status: " M" }, { path: "new file.txt", status: "??" }]);
  assert.deepEqual(repo.branches.find((b) => b.name === task!.branch), { name: task!.branch, ahead: 1, taskId: task!.id });
  assert.equal(repo.branches.find((b) => b.name === "main")!.ahead, 0);
  assert.match(await core.repoDiff(workspace.id, null), /\+more/);
  assert.match(await core.repoDiff(workspace.id, repo.commits[0]!.hash), /\+one/);
  await assert.rejects(core.repoDiff(workspace.id, "HEAD; rm -rf x"), /Not a commit hash/);

  // The tree lists what git knows of or would add, and files can be read and searched.
  writeFileSync(join(folder, ".gitignore"), "secret.env\n");
  writeFileSync(join(folder, "secret.env"), "KEY=1\n");
  assert.deepEqual((await core.repoFiles(workspace.id)).files, [".gitignore", "a.txt", "new file.txt"]);
  const file = core.repoFile(workspace.id, "a.txt");
  assert.equal(file.mime, "text/plain");
  assert.equal(Buffer.from(file.data, "base64").toString(), "one\nmore\n");
  assert.throws(() => core.repoFile(workspace.id, "../x"), /No file/);
  assert.deepEqual((await core.repoSearch(workspace.id, "MORE")).hits, [{ path: "a.txt", line: 2, text: "more" }]);
  assert.deepEqual((await core.repoSearch(workspace.id, "nowhere to be found")).hits, []);
  assert.deepEqual((await core.repoSearch(workspace.id, "KEY")).hits, [], "ignored files are not searched");

  const plain = setup({ repo: false });
  await assert.rejects(plain.core.repo(plain.workspace.id), /not a git repository/);
});

test("a connector that asks for a sign-in in the browser is signed in to, used, and renewed", async () => {
  // A stand-in provider: the MCP server, its description, and its authorization server in one.
  let issued = 0;
  const seen: { challenge?: string; registered?: Record<string, unknown>; resource?: string | null } = {};
  const provider = createHttp(async (req, res) => {
    const url = new URL(req.url!, "http://x");
    const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString();
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === "/mcp") {
      if (req.headers.authorization !== `Bearer access-${issued}`) {
        return json(401, { error: "Authentication required" }, { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
      }
      const message = JSON.parse(body);
      if (message.id === undefined) return json(202, {});
      return json(200, { jsonrpc: "2.0", id: message.id, result: message.method === "tools/list" ? { tools: [{ name: "get_rows", description: "Rows." }] } : { protocolVersion: "2025-03-26", capabilities: {} } });
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") return json(200, { resource: `${origin}/mcp`, authorization_servers: [`${origin}/auth`], scopes_supported: ["read"] });
    if (url.pathname === "/.well-known/oauth-authorization-server/auth") {
      return json(200, { authorization_endpoint: `${origin}/auth/authorize`, token_endpoint: `${origin}/auth/token`, registration_endpoint: `${origin}/auth/register` });
    }
    if (url.pathname === "/auth/register") {
      seen.registered = JSON.parse(body);
      return json(201, { client_id: "client-1" });
    }
    if (url.pathname === "/auth/authorize") {
      // The user "signs in": the provider sends the browser back with a code.
      seen.challenge = url.searchParams.get("code_challenge")!;
      seen.resource = url.searchParams.get("resource");
      res.writeHead(302, { Location: `${url.searchParams.get("redirect_uri")}?code=code-1&state=${url.searchParams.get("state")}` });
      return res.end();
    }
    if (url.pathname === "/auth/token") {
      const form = new URLSearchParams(body);
      const ok =
        form.get("grant_type") === "refresh_token"
          ? form.get("refresh_token") === "refresh-1"
          : form.get("code") === "code-1" && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === seen.challenge;
      if (!ok || form.get("client_id") !== "client-1") return json(400, { error: "invalid_grant" });
      issued++;
      // The first token lasts a moment, so the renewal can be watched.
      return json(200, { access_token: `access-${issued}`, refresh_token: "refresh-1", expires_in: issued === 1 ? 301 : 3600 });
    }
    json(404, {});
  });
  await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

  const { core, adapter, workspace } = setup({ repo: false });
  const server = createServer(core, "user-token");
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const here = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  core.setBridge(here, "cli.js");
  core.saveConnector(workspace.id, SaveConnectorRequest.parse({ id: "rows", name: "Rows", url: `${origin}/mcp` }));
  assert.equal(core.listConnectors(workspace.id)[0]!.signedIn, false);
  await assert.rejects(core.connectorTools(workspace.id, "rows"), /refused the sign-in/);

  // The app prepares the sign-in; the browser goes to the provider and comes back with a code.
  const { url } = await core.beginConnectorSignIn(workspace.id, "rows");
  assert.deepEqual(seen.registered!.redirect_uris, [`${here}/oauth/callback`]);
  assert.equal(seen.registered!.token_endpoint_auth_method, "none");
  const landed = await fetch(url);
  assert.match(await landed.text(), /Signed in to Rows/);
  assert.equal(seen.resource, `${origin}/mcp`);
  assert.equal(core.listConnectors(workspace.id)[0]!.signedIn, true);
  assert.ok(!JSON.stringify(core.listConnectors(workspace.id)).includes("access-1"), "tokens are never read back");
  assert.deepEqual((await core.connectorTools(workspace.id, "rows")).tools.map((tool) => tool.name), ["get_rows"]);

  // A callback nobody started, or one used twice, is turned away.
  assert.match(await (await fetch(`${here}/oauth/callback?code=code-1&state=made-up`)).text(), /did not go through/);
  assert.match(await (await fetch(landed.url)).text(), /did not go through/);

  // The team reaches it through the core's relay, holding its own token and never the provider's.
  core.sendMessage(workspace.id, { body: "go", toAgentId: null, taskId: null });
  const started = adapter.starts.length;
  const given = adapter.starts.at(-1)!.connectors!.rows as { url: string; headers: Record<string, string> };
  assert.equal(given.url, `${here}/relay/rows`);
  assert.ok(!JSON.stringify(given).includes("access-"), "the provider's token is not handed to the agent");
  const call = () =>
    fetch(given.url, { method: "POST", headers: { ...given.headers, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(((await (await call()).json()) as { result: { tools: unknown[] } }).result.tools.length, 1);
  assert.equal((await fetch(given.url, { method: "POST", headers: { Authorization: "Bearer made-up" }, body: "{}" })).status, 401);

  // The token was due within the renewal margin, so it is renewed; the same session goes on with the new one.
  await new Promise((done) => setTimeout(done, 1300));
  assert.equal(issued, 2);
  assert.equal((await call()).status, 200, "the relay sends the renewed token");
  core.sendMessage(workspace.id, { body: "on", toAgentId: null, taskId: null });
  assert.equal(adapter.starts.length, started, "a renewal does not restart the team");

  // Keeping the address keeps the sign-in; changing it does not.
  core.saveConnector(workspace.id, SaveConnectorRequest.parse({ id: "rows", name: "Rows", url: `${origin}/mcp`, free: ["get_*"] }));
  assert.equal(core.listConnectors(workspace.id)[0]!.signedIn, true);
  core.saveConnector(workspace.id, SaveConnectorRequest.parse({ id: "rows", name: "Rows", url: `${origin}/other` }));
  assert.equal(core.listConnectors(workspace.id)[0]!.signedIn, false);
  await core.close();
  server.close();
  provider.close();
});

test("in a folder that holds several repositories, a task works on a branch of the one it names", async () => {
  const { core, adapter, folder, workspace, as } = setup({ repo: false });
  for (const name of ["api", "web"]) {
    const dir = join(folder, name);
    sh(folder, "mkdir", name);
    sh(dir, "git", "init", "-q", "-b", "main");
    sh(dir, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", `init ${name}`);
  }
  // The lead is told about them when it next starts.
  await core.stopAgent(core.listAgents(workspace.id)[0]!.id);
  core.sendMessage(workspace.id, { body: "plan again", toAgentId: null, taskId: null });
  const leadAt = adapter.starts.length - 1;
  assert.match(adapter.starts[leadAt]!.systemPrompt!, /several git repositories: api, web/);
  assert.deepEqual(core.listWorkspaces()[0]!.repos.map((repo) => repo.path), ["api", "web"]);

  await assert.rejects(as(leadAt, { command: "task.create", title: "x", specialty: "developer", repo: "nope" }), /There are: api, web/);
  await as(leadAt, { command: "task.create", title: "Add route", specialty: "developer", repo: "api" });
  const [task] = core.listTasks(workspace.id);
  assert.equal(task!.repo, "api");
  assert.equal(task!.baseBranch, "main");
  assert.match(sh(join(folder, "api"), "git", "branch", "--list", task!.branch!), /peritos\/task-1/);
  assert.equal(sh(join(folder, "web"), "git", "branch", "--list", task!.branch!), "", "the other repository is untouched");

  writeFileSync(join(task!.worktree!, "route.js"), "export {};\n");
  sh(task!.worktree!, "git", "add", ".");
  sh(task!.worktree!, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "route");
  await as(leadAt + 1, { command: "task.done", report: { done: ["route"], tested: [], notVerified: [] } });
  const [approval] = core.waiting().approvals;
  assert.deepEqual(approval!.steps, [`Merge ${task!.branch} into main in api`, "Remove the task worktree"]);
  assert.match(await core.taskDiff(task!.id), /route\.js/);
  await core.decideApproval(approval!.id, "approved");
  assert.ok(existsSync(join(folder, "api", "route.js")), "merged into the repository it named");
  assert.equal(Buffer.from(core.taskFile(task!.id, "route.js").data, "base64").toString(), "export {};\n");

  // The code panel reads the repository it is asked for.
  assert.ok((await core.repo(workspace.id, "api")).commits.some((c) => c.subject === "init api"));
  assert.ok((await core.repo(workspace.id, "web")).commits.every((c) => c.subject === "init web"));
  assert.deepEqual((await core.repoFiles(workspace.id, "api")).files, ["route.js"]);
  await assert.rejects(core.repo(workspace.id, "../elsewhere"), /No repository/);
  await assert.rejects(core.repo(workspace.id), /not a git repository/);
});

test("the team keeps pages in the bureau's notebook, and the project's Markdown files are listed beside them", async () => {
  const { core, folder, workspace, as } = setup({ repo: false });
  const kept = await as(0, { command: "page", title: "Launch plan", body: "# Plan\n\n1. Write\n" });
  assert.match(kept.message, /kept in the notebook/);
  await tick();
  const replaced = await as(0, { command: "page", title: "launch plan", body: "# Plan\n\n1. Write\n2. Review\n" });
  assert.match(replaced.message, /replaced/);
  const [page] = core.listPages(workspace.id);
  assert.equal(core.listPages(workspace.id).length, 1, "the same title, in any case, is one page");
  assert.match(page!.body, /2\. Review/);
  assert.equal(page!.authorAgentId, core.listAgents(workspace.id)[0]!.id);
  assert.ok(!existsSync(join(folder, "Launch plan.md")), "a page is not a file of the project");

  sh(folder, "mkdir", "-p", "docs/guides", "node_modules/x", ".hidden");
  for (const file of ["README.md", "docs/guides/setup.md", "docs/notes.txt", "node_modules/x/README.md", ".hidden/secret.md"]) {
    writeFileSync(join(folder, file), "# x\n");
  }
  assert.deepEqual(core.listDocs(workspace.id).files, ["README.md", "docs/guides/setup.md"]);
  assert.equal(core.repoFile(workspace.id, "docs/guides/setup.md").mime, "text/markdown");

  // The user writes in the notebook too, and the team can read all of it.
  core.savePage(workspace.id, { id: page!.id, title: "Launch plan", body: "# Plan\n\nRewritten by hand.\n" });
  assert.equal(core.listPages(workspace.id)[0]!.authorAgentId, page!.authorAgentId, "a rewritten page keeps its author");
  await tick();
  const [mine] = core.savePage(workspace.id, { title: "House rules", body: "No emoji in copy." });
  assert.equal(mine!.authorAgentId, null);
  assert.throws(() => core.savePage(workspace.id, { title: "launch plan", body: "x" }), /already a page/);
  assert.throws(() => core.savePage(workspace.id, { id: "missing", title: "x", body: "x" }), /No page/);
  assert.match((await as(0, { command: "pages" })).message, /- House rules[\s\S]*- Launch plan/);
  assert.match((await as(0, { command: "pages", title: "house" })).message, /No emoji in copy/);
  await assert.rejects(as(0, { command: "pages", title: "nothing" }), /No page called/);
  core.removePage(mine!.id);

  assert.deepEqual(core.removePage(page!.id), []);
  assert.throws(() => core.removePage(page!.id), /No page/);
});

test("a terminal is a real shell in the bureau's folder that outlives the screen watching it", async (t) => {
  const { core, folder, workspace } = setup({ repo: false });
  if (!core.listTerminals(workspace.id).available) return t.skip("no pseudo-terminal library on this machine");
  const server = createServer(core, "user-token");
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;

  const terminal = core.openTerminal(workspace.id, OpenTerminalRequest.parse({ cols: 90, rows: 20 }));
  assert.equal(terminal.cwd, folder);
  assert.deepEqual(core.listTerminals(workspace.id).terminals.map((item) => item.id), [terminal.id]);

  const follow = (path: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    let seen = "";
    let exit: number | null = null;
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as { type: string; data?: string; code?: number };
      if (message.type === "data") seen += message.data;
      else exit = message.code ?? 0;
    });
    const until = async (test: () => boolean) => {
      for (let i = 0; i < 200 && !test(); i++) await tick();
      assert.ok(test(), `terminal printed: ${JSON.stringify(seen.slice(-300))}`);
    };
    return { socket, until, seen: () => seen, exit: () => exit, opened: new Promise((done) => socket.on("open", done)) };
  };
  const first = follow(`/terminals/${terminal.id}/socket?token=user-token`);
  await first.opened;
  first.socket.send(JSON.stringify({ type: "resize", cols: 77, rows: 20 }));
  first.socket.send(JSON.stringify({ type: "input", data: "echo sum-$((40+2)) && pwd && stty size\r" }));
  await first.until(() => first.seen().includes("sum-42") && first.seen().includes("20 77"));
  assert.ok(first.seen().includes(folder), "the shell starts in the bureau's folder");
  first.socket.close();

  // A screen that comes later is given what was printed while nobody watched.
  const second = follow(`/terminals/${terminal.id}/socket?token=user-token`);
  await second.until(() => second.seen().includes("sum-42"));
  second.socket.send(JSON.stringify({ type: "input", data: "exit 3\r" }));
  await second.until(() => second.exit() === 3);
  assert.equal(core.listTerminals(workspace.id).terminals[0]!.alive, false);

  const refused = new WebSocket(`ws://127.0.0.1:${port}/terminals/${terminal.id}/socket?token=wrong`);
  await new Promise((done) => refused.on("error", done));
  assert.deepEqual(core.closeTerminal(terminal.id), { closed: true });
  assert.deepEqual(core.listTerminals(workspace.id).terminals, []);
  second.socket.close();
  await core.close();
  server.close();
});

test("a bureau can be moved to another agent tool; its team starts afresh there, without connectors", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "lp-data-"));
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-ws-")));
  const claude = new FakeAdapter();
  const codex = new FakeAdapter();
  Object.assign(claude, { id: "claude-code", check: async () => ({ tool: "claude", required: true, found: true, version: "1", installHint: null }) });
  Object.assign(codex, { id: "codex", check: async () => ({ tool: "codex", required: false, found: false, version: null, installHint: "Install Codex" }) });
  const core = new Core({ dataDir, adapters: [claude, codex], leadAdapter: "claude-code" });
  assert.deepEqual((await core.setup()).map((check) => [check.tool, check.required]), [["git", true], ["claude", true], ["codex", false]]);

  const workspace = core.openWorkspace(folder);
  core.saveConnector(workspace.id, SaveConnectorRequest.parse({ id: "rows", name: "Rows", command: "node", args: ["rows.js"] }));
  core.sendMessage(workspace.id, { body: "plan", toAgentId: null, taskId: null });
  assert.equal(claude.starts.length, 1);
  assert.ok(claude.starts[0]!.connectors!.rows);
  const first = core.listAgents(workspace.id)[0]!;
  assert.equal(first.adapter, "claude-code");

  assert.equal(core.updateWorkspace(workspace.id, { agentTool: "codex" }).agentTool, "codex");
  const moved = core.listAgents(workspace.id)[0]!;
  assert.equal(moved.adapter, "codex");
  assert.equal(moved.sessionId, null, "the other tool's conversation is not carried over");
  core.sendMessage(workspace.id, { body: "again", toAgentId: null, taskId: null });
  assert.equal(codex.starts.length, 1);
  assert.equal(codex.starts[0]!.resume, false);
  assert.deepEqual(codex.starts[0]!.connectors, {}, "a tool that cannot wait for a seal is not given connectors");
  assert.match(codex.starts[0]!.systemPrompt!, /Nothing stops you before a command/);
  assert.throws(() => core.updateWorkspace(workspace.id, { agentTool: "fake" as "codex" }), /./);
  await core.close();
});

test("a lead can see the user's other bureaus and hand work to another bureau's lead, within a limit", async () => {
  const { core, adapter, workspace, as } = setup({ repo: false });
  assert.match((await as(0, { command: "bureaus" })).message, /only bureau/);
  const other = core.openWorkspace(realpathSync(mkdtempSync(join(tmpdir(), "lp-mk-"))), "marketing");
  core.updateWorkspace(other.id, { name: "Launch" });
  await core.createTask(other.id, { title: "Write the launch post", description: "", specialty: "copywriter", effort: undefined, priority: undefined, dependsOn: [], start: false });
  const listed = (await as(0, { command: "bureaus" })).message;
  assert.match(listed, /- Launch \(marketing, .*\): 1 open dossier/);
  assert.match(listed, /#1 Write the launch post/);

  const before = adapter.starts.length;
  assert.match((await as(0, { command: "send", to: "bureau:launch", body: "We shipped sign-in with a code. Please draft a short announcement." })).message, /Sent to the lead of Launch/);
  const arrived = core.listMessages(other.id).at(-1)!;
  assert.deepEqual(arrived.author, { kind: "bureau", workspaceId: workspace.id, name: workspace.name });
  assert.match(core.listMessages(workspace.id).at(-1)!.body, /^→ Launch: We shipped/);
  assert.equal(adapter.starts.length, before + 1, "the other bureau's lead is woken with the request");
  for (let i = 0; i < 50 && !adapter.sent.some((text) => text.startsWith("Message from the lead")); i++) await tick();
  assert.match(adapter.sent.find((text) => text.startsWith("Message from the lead"))!, /Message from the lead of the user's ".*" bureau/);

  await assert.rejects(as(0, { command: "send", to: "bureau:nowhere", body: "x" }), /No bureau named "nowhere". Bureaus: Launch/);
  // Leads cannot keep each other busy for ever: after a few, the user has to write there.
  for (let i = 0; i < 5; i++) await as(0, { command: "send", to: "bureau:Launch", body: `more ${i}` });
  await assert.rejects(as(0, { command: "send", to: "bureau:Launch", body: "one too many" }), /since the user last wrote there/);
  core.sendMessage(other.id, { body: "carry on", toAgentId: null, taskId: null });
  await as(0, { command: "send", to: "bureau:Launch", body: "allowed again" });
  await core.close();
});

test("the phone's door opens only when switched on, only with its key, and only onto questions, seals and messages", async () => {
  const { core, workspace, dataDir } = setup({ repo: false });
  assert.deepEqual(core.phone.status(), { enabled: false, urls: [], secure: false, fingerprint: null });
  const opened = await core.phone.set(true);
  assert.equal(opened.enabled, true);
  const inner = core as unknown as { app: { readSecret(name: string, fallback: null): { token: string } }; phone: { port: number } };
  const key = inner.app.readSecret("phone", null).token;
  const scheme = opened.secure ? "https" : "http";
  const base = `${scheme}://127.0.0.1:${inner.phone.port}/m/${key}`;
  // The certificate is the app's own: the test trusts exactly that one, as a phone does once the user has accepted it.
  const ca = opened.secure ? readFileSync(join(dataDir, "phone-cert.pem")) : undefined;
  if (opened.secure) {
    assert.match(opened.fingerprint!, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    assert.equal(statSync(join(dataDir, "phone-key.pem")).mode & 0o777, 0o600);
  }
  const ask = (url: string, value?: unknown) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const target = new URL(url);
      const req = (opened.secure ? httpsRequest : httpRequest)(
        target,
        { method: value === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, ...(ca && { ca }), agent: false },
        (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk)).on("end", () => resolve({ status: res.statusCode ?? 0, text }));
        },
      );
      req.on("error", reject);
      req.end(value === undefined ? undefined : JSON.stringify(value));
    });

  assert.match((await ask(base)).text, /<title>LosPeritos<\/title>/);
  assert.equal((await ask(base.replace(key, "wrong-key"))).status, 404);
  assert.notEqual((await ask(`${base}/terminals`)).status, 200, "the key opens nothing beyond the page's own actions");
  assert.equal((await ask(base.replace(`/m/${key}`, "/workspaces"))).status, 404, "the main API is not behind this door");

  core.sendMessage(workspace.id, { body: "/ask", toAgentId: null, taskId: null });
  core.sendMessage(workspace.id, { body: "/approve", toAgentId: null, taskId: null });
  type View = { bureaus: Array<{ id: string; questions: Array<{ id: string; options: string[] }>; seals: Array<{ id: string }>; recent: unknown[] }> };
  let view: View = { bureaus: [] };
  for (let i = 0; i < 100; i++) {
    view = JSON.parse((await ask(`${base}/state`)).text) as View;
    if (view.bureaus[0]?.questions.length && view.bureaus[0].seals.length) break;
    await tick();
  }
  const [bureau] = view.bureaus;
  assert.equal(bureau!.questions.length, 1);
  assert.equal(bureau!.seals.length, 1);

  const answered = JSON.parse((await ask(`${base}/answer`, { id: bureau!.questions[0]!.id, answer: bureau!.questions[0]!.options[0] ?? "Yes" })).text) as View;
  assert.equal(answered.bureaus[0]!.questions.length, 0);
  const sealed = JSON.parse((await ask(`${base}/decide`, { id: bureau!.seals[0]!.id, decision: "approved" })).text) as View;
  assert.equal(sealed.bureaus[0]!.seals.length, 0);
  assert.equal(core.listApprovals(workspace.id)[0]!.status, "approved");
  assert.equal((await ask(`${base}/decide`, { id: bureau!.seals[0]!.id, decision: "maybe" })).status, 400);
  await ask(`${base}/say`, { bureau: workspace.id, body: "from the phone" });
  assert.ok(core.listMessages(workspace.id).some((message) => message.author.kind === "user" && message.body === "from the phone"));

  // A new key shuts out every address handed out before, under the same certificate; switching off shuts the door.
  const renewed = await core.phone.set(true, true);
  assert.equal(renewed.fingerprint, opened.fingerprint, "the phone is not asked to accept a new certificate for a new key");
  assert.equal((await ask(base)).status, 404);
  assert.deepEqual(await core.phone.set(false), { enabled: false, urls: [], secure: false, fingerprint: null });
  await assert.rejects(ask(base));
  await core.close();
});

test("a nudge goes to the phone when something waits, and says nothing about the work", async () => {
  const heard: Array<{ path: string; title: string | undefined; body: string }> = [];
  const ntfy = createHttp(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    heard.push({ path: req.url ?? "", title: req.headers.title as string | undefined, body: Buffer.concat(chunks).toString() });
    res.end("{}");
  });
  await new Promise<void>((done) => ntfy.listen(0, "127.0.0.1", done));
  const server = `http://127.0.0.1:${(ntfy.address() as AddressInfo).port}`;

  const { core, workspace } = setup({ repo: false });
  assert.equal(await core.notifier.nudge("seal"), false, "nothing is sent until the user sets it up");
  assert.throws(() => core.notifier.set({ enabled: true, server: "ftp://x" }), /http/);
  const settings = core.notifier.set({ enabled: true, server: `${server}/`, lang: "tr" });
  assert.match(settings.topic!, /^losperitos-[0-9a-f]{24}$/);
  assert.equal(await core.notifier.nudge("test"), true);

  core.sendMessage(workspace.id, { body: "/ask", toAgentId: null, taskId: null });
  core.sendMessage(workspace.id, { body: "/approve", toAgentId: null, taskId: null });
  for (let i = 0; i < 100 && heard.length < 2; i++) await tick();
  await tick();
  assert.equal(heard.length, 2, "the test nudge, then one for what was raised together");
  assert.deepEqual(heard[1], { path: `/${settings.topic}`, title: "LosPeritos", body: heard[1]!.body });
  assert.match(heard[1]!.body, /seni bekliyor\.$/);
  assert.ok(!heard.some((item) => /option|Deploy|staging/i.test(item.body)), "the text of the question or seal does not leave the machine");

  assert.notEqual(core.notifier.set({ enabled: true, renew: true }).topic, settings.topic);
  assert.equal(core.notifier.set({ enabled: false }).topic, null);
  await core.close();
  ntfy.close();
});
