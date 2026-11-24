import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStreamLine } from "./claude-code.js";

test("assistant text becomes output and a chat message", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "Done." }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] },
  });
  assert.deepEqual(parseStreamLine(line), [
    { type: "output", stream: "stdout", chunk: "Done.\n" },
    { type: "text", text: "Done." },
    { type: "output", stream: "stdout", chunk: '[Bash] {"command":"ls"}\n' },
  ]);
});

test("result ends the turn with usage, and reports errors", () => {
  const ok = JSON.stringify({
    type: "result",
    is_error: false,
    total_cost_usd: 0.5,
    usage: { input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 3 },
  });
  assert.deepEqual(parseStreamLine(ok), [
    { type: "turn_end", inputTokens: 3, outputTokens: 3, costUsd: 0.5 },
  ]);
  const failed = parseStreamLine(JSON.stringify({ type: "result", is_error: true, result: "boom" }));
  assert.equal(failed[0]!.type, "error");
  assert.equal(failed[1]!.type, "turn_end");
});

test("unknown and non-JSON lines do not throw", () => {
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: "system", subtype: "init" })), []);
  assert.deepEqual(parseStreamLine("plain text"), [{ type: "output", stream: "stdout", chunk: "plain text\n" }]);
  assert.deepEqual(parseStreamLine(""), []);
});

test("a tool call and its result are reported so they can be shown together", () => {
  const call = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "a.md", content: "x".repeat(7000) } }] },
  });
  const [event] = parseStreamLine(call) as Array<{ tool?: { id: string; name: string; input: { content: string } } }>;
  assert.equal(event!.tool!.id, "t1");
  assert.equal(event!.tool!.name, "Write");
  assert.ok(event!.tool!.input.content.length < 6100, "long arguments are clipped");

  const result = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "denied" }] }] },
  });
  assert.deepEqual(parseStreamLine(result), [
    { type: "output", stream: "stdout", chunk: "", result: { id: "t1", ok: false, text: "denied" } },
  ]);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: "user", message: { content: "plain" } })), []);
});

test("usage-limit failures are recognised and their reset time worked out", async () => {
  const { parseLimit } = await import("./claude-code.js");
  assert.equal(parseLimit("File not found"), undefined);
  assert.deepEqual(parseLimit("Claude AI usage limit reached|1763950000"), {
    resetAt: new Date(1763950000 * 1000).toISOString(),
  });
  const now = new Date(2026, 10, 23, 14, 0, 0);
  assert.equal(new Date(parseLimit("You've hit your limit · resets 3pm", now)!.resetAt!).getHours(), 15);
  const tomorrow = new Date(parseLimit("Usage limit reached. Resets at 1:53am", now)!.resetAt!);
  assert.deepEqual([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()], [24, 1, 53]);
  assert.deepEqual(parseLimit("You are out of usage for now"), { resetAt: null });
  const line = JSON.stringify({ type: "result", is_error: true, result: "Claude AI usage limit reached|1763950000" });
  assert.ok((parseStreamLine(line)[0] as { limit?: unknown }).limit);
});

test("what Claude Code says about the account's allowance is passed on", () => {
  // As seen from a real turn: room left, no figure, and the time the week renews.
  const seen = JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: { status: "allowed", resetsAt: 1796112000, rateLimitType: "seven_day", overageStatus: "rejected", isUsingOverage: false },
  });
  assert.deepEqual(parseStreamLine(seen), [
    { type: "allowance", status: "ok", window: "seven_day", used: null, resetAt: new Date(1796112000 * 1000).toISOString() },
  ]);
  const near = JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.85 } });
  assert.deepEqual(parseStreamLine(near), [{ type: "allowance", status: "warning", window: "five_hour", used: 0.85, resetAt: null }]);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: {} })), []);
});
