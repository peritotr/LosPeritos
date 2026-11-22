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
