import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { FakeAdapter } from "@losperitos/adapters";
import { EventEnvelope, type Event } from "@losperitos/protocol";
import { Core, CoreError } from "./core.js";
import { createServer } from "./server.js";

function setup(costPerTurnUsd = 0.01) {
  const dataDir = mkdtempSync(join(tmpdir(), "lp-data-"));
  const folder = mkdtempSync(join(tmpdir(), "lp-ws-"));
  const make = () =>
    new Core({ dataDir, adapters: [new FakeAdapter(costPerTurnUsd)], leadAdapter: "fake" });
  const core = make();
  const events: Event[] = [];
  core.subscribe((envelope) => {
    EventEnvelope.parse(envelope);
    events.push(envelope.event);
  });
  return { core, events, folder, make };
}

/** Resolve once an event of this type has been seen. */
async function until(events: Event[], type: Event["type"], count = 1): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (events.filter((event) => event.type === type).length >= count) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  assert.fail(`Timed out waiting for ${count}× ${type}`);
}

test("opening a folder creates a workspace with a lead and its own .gitignore", () => {
  const { core, folder } = setup();
  const workspace = core.openWorkspace(folder);
  const agents = core.listAgents(workspace.id);
  assert.equal(agents.length, 1);
  assert.equal(agents[0]!.role, "lead");
  assert.equal(readFileSync(join(folder, ".losperitos", ".gitignore"), "utf8"), "*\n");
  assert.equal(core.openWorkspace(folder).id, workspace.id, "opening twice returns the same workspace");
});

test("a message to the lead produces a reply, a run and an idle agent", async () => {
  const { core, events, folder } = setup();
  const workspace = core.openWorkspace(folder);
  core.sendMessage(workspace.id, { body: "hello", toAgentId: null, taskId: null });
  assert.equal(core.listAgents(workspace.id)[0]!.status, "working");
  await until(events, "budget.updated");

  const messages = core.listMessages(workspace.id);
  assert.deepEqual(messages.map((m) => m.body), ["hello", "Echo: hello"]);
  assert.equal(core.listAgents(workspace.id)[0]!.status, "idle");
  assert.equal(core.budget(workspace.id).spentUsd, 0.01);
  assert.ok(events.some((event) => event.type === "agent.output"));
});

test("a question waits for the user and the answer goes back to the agent", async () => {
  const { core, events, folder } = setup();
  const workspace = core.openWorkspace(folder);
  core.sendMessage(workspace.id, { body: "/ask", toAgentId: null, taskId: null });
  await until(events, "budget.updated");

  const [question] = core.waiting().questions;
  assert.ok(question);
  assert.equal(core.listAgents(workspace.id)[0]!.status, "asking");

  core.answerQuestion(question.id, "A");
  await until(events, "budget.updated", 2);
  assert.equal(core.waiting().questions.length, 0);
  assert.equal(core.listMessages(workspace.id).at(-1)!.body, "Echo: A");
  assert.throws(() => core.answerQuestion(question.id, "B"), CoreError);
});

test("an approval stays pending until decided, and cannot be decided twice", async () => {
  const { core, events, folder } = setup();
  const workspace = core.openWorkspace(folder);
  core.sendMessage(workspace.id, { body: "/approve", toAgentId: null, taskId: null });
  await until(events, "approval.requested");

  const [approval] = core.waiting().approvals;
  assert.ok(approval);
  assert.equal(core.listAgents(workspace.id)[0]!.status, "awaiting_approval");

  assert.equal((await core.decideApproval(approval.id, "approved")).status, "approved");
  assert.equal(core.waiting().approvals.length, 0);
  await assert.rejects(core.decideApproval(approval.id, "rejected"), CoreError);
});

test("budget warns at 80% and refuses new jobs once spent", async () => {
  const { core, events, folder } = setup(0.4);
  const workspace = core.openWorkspace(folder);
  core.updateWorkspace(workspace.id, { dailyBudgetUsd: 1 });
  const send = () => core.sendMessage(workspace.id, { body: "go", toAgentId: null, taskId: null });

  send();
  await until(events, "budget.updated", 2);
  assert.equal(core.budget(workspace.id).level, "ok");
  send();
  await until(events, "budget.updated", 3);
  assert.equal(core.budget(workspace.id).level, "warning");
  send();
  await until(events, "budget.updated", 4);
  assert.equal(core.budget(workspace.id).level, "exhausted");
  assert.throws(send, (err: unknown) => err instanceof CoreError && err.code === "budget_exhausted");
});

test("an agent error is shown on the agent, and stopping marks it stopped", async () => {
  const { core, events, folder } = setup();
  const workspace = core.openWorkspace(folder);
  core.sendMessage(workspace.id, { body: "/fail", toAgentId: null, taskId: null });
  await until(events, "agent.updated", 2);
  const failed = core.listAgents(workspace.id)[0]!;
  assert.equal(failed.status, "error");
  assert.equal(failed.error, "Fake failure");

  core.sendMessage(workspace.id, { body: "again", toAgentId: null, taskId: null });
  await until(events, "budget.updated");
  assert.equal((await core.stopAgent(failed.id)).status, "stopped");
});

test("workspaces and history survive a restart", async () => {
  const { core, events, folder, make } = setup();
  const workspace = core.openWorkspace(folder);
  core.sendMessage(workspace.id, { body: "hello", toAgentId: null, taskId: null });
  await until(events, "budget.updated");
  await core.close();

  const restarted = make();
  assert.deepEqual(restarted.listWorkspaces().map((w) => w.id), [workspace.id]);
  assert.equal(restarted.listMessages(workspace.id).length, 2);
  assert.equal(restarted.budget(workspace.id).spentUsd, 0.01);
});

test("HTTP API requires the token and streams events over WebSocket", async () => {
  const { core, folder } = setup();
  const server = createServer(core, "secret");
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const call = (method: string, path: string, body?: unknown, token = "secret") =>
    fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  try {
    assert.equal((await call("GET", "/workspaces", undefined, "wrong")).status, 401);
    assert.equal((await call("GET", "/nope")).status, 404);
    assert.equal((await call("POST", "/workspaces", {})).status, 400);

    const workspace = (await (await call("POST", "/workspaces", { path: folder })).json()) as { id: string };
    assert.ok(existsSync(join(folder, ".losperitos")));

    const socket = new WebSocket(`ws://127.0.0.1:${port}/events?token=secret`);
    const seen: Event[] = [];
    socket.on("message", (data) => seen.push(EventEnvelope.parse(JSON.parse(String(data))).event));
    await new Promise((done) => socket.once("open", done));

    const sent = await call("POST", `/workspaces/${workspace.id}/messages`, { body: "hi" });
    assert.equal(sent.status, 200);
    await until(seen, "budget.updated");
    assert.ok(seen.some((e) => e.type === "message.created" && e.message.body === "Echo: hi"));
    socket.close();

    const rejected = new WebSocket(`ws://127.0.0.1:${port}/events?token=wrong`);
    await new Promise((done) => rejected.once("error", done));
  } finally {
    await core.close();
    server.close();
  }
});
