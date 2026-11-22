// Checks, with your real `claude` CLI, that a risky command waits for the
// user: the lead is told to run `git push`, the request must arrive as a seal
// request, and refusing it must stop the push. Spends a little real usage.
// Run `npm run build` first.
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startCore } from "../packages/core/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-perm-")));
const git = (...args) => execFileSync("git", args, { cwd: folder, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("config", "user.name", "LosPeritos E2E");
git("config", "user.email", "e2e@example.invalid");
git("commit", "-q", "--allow-empty", "-m", "init");

const running = await startCore({
  dataDir: mkdtempSync(join(tmpdir(), "lp-perm-data-")),
  cliEntry: fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url)),
});
const { core } = running;
const seen = [];
core.subscribe(({ event }) => {
  if (event.type === "agent.output") process.stdout.write(`  | ${event.chunk}`);
  if (event.type === "approval.requested") console.log(`[approval] ${event.approval.kind}: ${event.approval.title}`);
  if (event.type === "agent.updated") seen.push(event.agent.status);
});

const workspace = core.openWorkspace(folder);
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 1 });
core.sendMessage(workspace.id, {
  body:
    "Do exactly two things yourself, in order, and do not create any task: " +
    "1) run `git status --short`; 2) run `git push origin main`. Then tell me in one sentence what happened with each.",
  toAgentId: null,
  taskId: null,
});

const deadline = Date.now() + 3 * 60_000;
let approval;
while (Date.now() < deadline && !approval) {
  await new Promise((done) => setTimeout(done, 500));
  approval = core.waiting().approvals.find((a) => a.kind === "command");
  if (core.listAgents(workspace.id).some((a) => a.status === "error")) break;
}

let ok = false;
if (approval) {
  console.log("held command:", approval.detail.split("\n").at(-1));
  await core.decideApproval(approval.id, "rejected");
  // Give the lead time to finish its turn after the refusal.
  const end = Date.now() + 60_000;
  while (Date.now() < end && core.listAgents(workspace.id)[0].status !== "idle") await new Promise((done) => setTimeout(done, 500));
  const last = core.listMessages(workspace.id).at(-1);
  console.log("lead said:", last.body.slice(0, 300));
  ok = /push/.test(approval.title) && core.listAgents(workspace.id)[0].status === "idle";
} else {
  console.log("No command approval arrived. Agent statuses seen:", [...new Set(seen)].join(", "));
  console.log("last message:", core.listMessages(workspace.id).at(-1)?.body.slice(0, 300));
}
console.log("spent (USD):", core.budget(workspace.id).spentUsd.toFixed(3));
console.log(ok ? "PASS" : "FAIL");
await running.close();
process.exit(ok ? 0 : 1);
