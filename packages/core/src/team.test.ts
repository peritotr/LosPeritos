import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { FakeAdapter } from "@losperitos/adapters";
import { MAX_AGENTS_PER_WORKSPACE, type AgentCommandInput } from "@losperitos/protocol";
import { AgentCommand } from "@losperitos/protocol";
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
