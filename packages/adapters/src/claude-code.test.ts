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
