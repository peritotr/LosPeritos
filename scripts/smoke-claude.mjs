// Two-turn check of the Claude Code adapter against your real `claude` CLI.
// Spends a few tokens. Run `npm run build` first, then: node scripts/smoke-claude.mjs
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";

const cwd = mkdtempSync(join(tmpdir(), "lp-smoke-"));
const session = new ClaudeCodeAdapter().start({ cwd, trustMode: "restricted" });
const prompts = ["Reply with exactly: one", "Reply with exactly: two"];
const replies = [];
const costs = [];
let failed = false;

const timer = setTimeout(() => {
  console.error("FAIL: timed out");
  session.stop().then(() => process.exit(1));
}, 150_000);

session.onEvent(async (event) => {
  if (event.type === "text") replies.push(event.text.trim());
  if (event.type === "error") {
    failed = true;
    console.error("Agent error:", event.message);
  }
  if (event.type === "turn_end") {
    costs.push(event.costUsd);
    if (costs.length < prompts.length) session.send(prompts[costs.length]);
    else await session.stop();
  }
  if (event.type === "exit") {
    clearTimeout(timer);
    console.log("replies:", replies);
    console.log("cost per turn (USD):", costs);
    const ok = !failed && replies.join(",") === "one,two";
    console.log(ok ? "PASS" : "FAIL");
    process.exit(ok ? 0 : 1);
  }
});
session.send(prompts[0]);
