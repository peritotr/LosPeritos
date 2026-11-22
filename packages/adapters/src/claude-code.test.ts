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
