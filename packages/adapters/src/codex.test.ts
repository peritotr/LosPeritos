import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter, parseCodexLine } from "./codex.js";
import type { SessionEvent } from "./types.js";

test("Codex's event lines become output, chat messages and tool calls", () => {
  assert.equal(parseCodexLine(JSON.stringify({ type: "thread.started", thread_id: "t-1" })).threadId, "t-1");
  assert.deepEqual(parseCodexLine(JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Done." } })).events, [
    { type: "output", stream: "stdout", chunk: "Done.\n" },
    { type: "text", text: "Done." },
  ]);
  const started = parseCodexLine(JSON.stringify({ type: "item.started", item: { id: "item_1", type: "command_execution", command: "ls", status: "in_progress" } })).events[0]!;
  assert.deepEqual(started.type === "output" && started.tool, { id: "item_1", name: "Bash", input: { command: "ls" } });
  const ended = parseCodexLine(JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "ls", aggregated_output: "a\n", exit_code: 0 } })).events[0]!;
  assert.deepEqual(ended.type === "output" && ended.result, { id: "item_1", ok: true, text: "a\n" });
  assert.deepEqual(parseCodexLine(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 3 } })).usage, { input: 10, output: 3 });
  // A notice is not a failure; a failed turn is, and a usage limit is told apart with its time.
  assert.equal(parseCodexLine(JSON.stringify({ type: "item.completed", item: { id: "i", type: "error", message: "model rerouted" } })).failed, undefined);
  const limited = parseCodexLine(JSON.stringify({ type: "turn.failed", error: { message: "You’ve hit your usage limit. Try again at 9:30 PM." } }));
  assert.equal(limited.failed, true);
  const error = limited.events[0]!;
  assert.ok(error.type === "error" && error.limit?.resetAt, "the limit carries when it lifts");
});

/** A stand-in for the `codex` command: it speaks the same lines, and remembers threads in a file. */
function standIn(dir: string): string {
  const bin = join(dir, "codex");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli 0.171.0"); process.exit(0); }
fs.appendFileSync(${JSON.stringify(join(dir, "calls.jsonl"))}, JSON.stringify(args) + "\\n");
const store = ${JSON.stringify(join(dir, "threads.json"))};
const threads = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, "utf8")) : {};
const at = args.indexOf("resume");
const id = at >= 0 ? args[at + 1] : "thread-" + (Object.keys(threads).length + 1);
let prompt = "";
process.stdin.on("data", (chunk) => (prompt += chunk)).on("end", () => {
  const say = (line) => console.log(JSON.stringify(line));
  say({ type: "thread.started", thread_id: id });
  say({ type: "turn.started" });
  if (prompt.includes("LIMIT")) {
    // As the real command does: the same failure twice.
    say({ type: "error", message: "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 29th, 2026 12:29 AM." });
    say({ type: "turn.failed", error: { message: "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 29th, 2026 12:29 AM." } });
    process.exit(1);
  }
  if (prompt.includes("CRASH")) { console.error("Not logged in"); process.exit(1); }
  const turns = (threads[id] ?? 0) + 1;
  threads[id] = turns;
  fs.writeFileSync(store, JSON.stringify(threads));
  say({ type: "item.started", item: { id: "item_0", type: "command_execution", command: "pwd", status: "in_progress" } });
  say({ type: "item.completed", item: { id: "item_0", type: "command_execution", command: "pwd", aggregated_output: process.cwd() + "\\n", exit_code: 0, status: "completed" } });
  say({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "turn " + turns + ": " + prompt } });
  say({ type: "turn.completed", usage: { input_tokens: 100 * turns, cached_input_tokens: 0, output_tokens: 10 * turns } });
});
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

const collect = (session: { onEvent(listener: (event: SessionEvent) => void): void }) => {
  const events: SessionEvent[] = [];
  session.onEvent((event) => events.push(event));
  const turns = async (count: number) => {
    for (let i = 0; i < 400 && events.filter((event) => event.type === "turn_end").length < count; i++) await new Promise((done) => setTimeout(done, 10));
    assert.equal(events.filter((event) => event.type === "turn_end").length, count);
  };
  return { events, turns };
};

test("the Codex adapter runs one command per turn and carries the conversation on", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-codex-"));
  const bin = standIn(dir);
  const state = join(dir, "state", "codex-threads.json");
  const adapter = new CodexAdapter(bin, state);
  assert.deepEqual(await adapter.check(), { tool: "codex", required: false, found: true, version: "codex-cli 0.171.0", installHint: null });
  assert.equal((await new CodexAdapter(join(dir, "missing")).check()).found, false);

  const session = adapter.start({ cwd: dir, trustMode: "full", sessionId: "s-1", systemPrompt: 'Say "hi"\nand stop.', model: "sonnet", connectors: { rows: { command: "node", args: ["rows.js"], env: { KEY: "v" } } } });
  const first = collect(session);
  session.send("one");
  session.send("two"); // Sent while the first turn runs: it waits its turn.
  await first.turns(2);
  const texts = first.events.flatMap((event) => (event.type === "text" ? [event.text] : []));
  assert.deepEqual(texts, ["turn 1: one", "turn 2: two"]);
  const ends = first.events.filter((event) => event.type === "turn_end");
  assert.deepEqual(ends, [
    { type: "turn_end", inputTokens: 100, outputTokens: 10, costUsd: 0 },
    { type: "turn_end", inputTokens: 100, outputTokens: 10, costUsd: 0 },
  ], "Codex reports a running total; each turn is charged its own share");
  const calls = readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert.deepEqual(calls[0]!.slice(0, 7), ["exec", "--json", "--skip-git-repo-check", "-C", dir, "-s", "workspace-write"]);
  assert.ok(!calls[0]!.includes("-m"), "a model name meant for another tool is not passed on");
  assert.ok(calls[0]!.includes('developer_instructions="Say \\"hi\\"\\nand stop."'));
  assert.ok(calls[0]!.includes('mcp_servers.rows.env={"KEY"="v"}'));
  assert.ok(!calls[0]!.includes("resume"));
  assert.deepEqual(calls[1]!.slice(-3), ["resume", "thread-1", "-"]);
  await session.stop();
  assert.equal(first.events.at(-1)!.type, "exit");

  // After a restart the conversation is picked up where it was, and only new use is counted.
  const later = new CodexAdapter(bin, state).start({ cwd: dir, trustMode: "full", sessionId: "s-1", resume: true });
  const second = collect(later);
  later.send("three");
  await second.turns(1);
  assert.deepEqual(second.events.find((event) => event.type === "text"), { type: "text", text: "turn 3: three" });
  assert.deepEqual(second.events.find((event) => event.type === "turn_end"), { type: "turn_end", inputTokens: 100, outputTokens: 10, costUsd: 0 });

  // A usage limit and a command that dies both end the turn with an error, and the next turn still runs.
  later.send("LIMIT");
  await second.turns(2);
  const limits = second.events.filter((event) => event.type === "error");
  assert.equal(limits.length, 1, "a failure Codex says twice is passed on once");
  const limit = limits[0]!;
  assert.ok(limit.type === "error" && limit.limit, "the usage limit is recognised");
  assert.equal(limit.type === "error" && limit.limit!.resetAt, new Date(2026, 10, 29, 0, 29).toISOString(), "with the day and hour it lifts");
  later.send("CRASH");
  await second.turns(3);
  assert.ok(second.events.some((event) => event.type === "error" && event.message === "Not logged in"));
  later.send("four");
  await second.turns(4);
  await later.stop();
});
