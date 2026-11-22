// End-to-end check with your real `claude` CLI: the lead splits off one task,
// a team member does it on its own branch, and the merge waits for approval.
// Spends real usage (capped by a $2 workspace budget). Run `npm run build` first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-")));
const git = (...args) => execFileSync("git", args, { cwd: folder, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("config", "user.name", "LosPeritos E2E");
git("config", "user.email", "e2e@example.invalid");
git("commit", "-q", "--allow-empty", "-m", "init");

const core = new Core({
  dataDir: mkdtempSync(join(tmpdir(), "lp-e2e-data-")),
  adapters: [new ClaudeCodeAdapter()],
  leadAdapter: "claude-code",
});
const server = createServer(core, "e2e");
await new Promise((done) => server.listen(0, "127.0.0.1", done));
core.setBridge(
  `http://127.0.0.1:${server.address().port}`,
  fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url)),
);
core.subscribe(({ event }) => {
  if (event.type === "agent.output") process.stdout.write(`  | ${event.chunk}`);
  if (event.type === "agent.updated") console.log(`[agent] ${event.agent.name}: ${event.agent.status}${event.agent.error ? " — " + event.agent.error : ""}`);
  if (event.type === "task.updated") console.log(`[task] #${event.task.number} ${event.task.status} ${event.task.branch ?? ""}`);
  if (event.type === "approval.requested") console.log(`[approval] ${event.approval.kind}: ${event.approval.title}`);
});

const workspace = core.openWorkspace(folder);
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 2 });
core.sendMessage(workspace.id, {
  body:
    "Hand this to one developer teammate as a single task, do not do it yourself: " +
    "create a file named hello.txt containing exactly the line `hello from the team`.",
  toAgentId: null,
  taskId: null,
});

const deadline = Date.now() + 5 * 60_000;
let approval;
while (Date.now() < deadline && !approval) {
  await new Promise((done) => setTimeout(done, 1000));
  approval = core.waiting().approvals.find((a) => a.kind === "merge");
  if (core.listAgents(workspace.id).some((a) => a.status === "error")) break;
}

let ok = false;
if (approval) {
  const mergedBefore = existsSync(join(folder, "hello.txt"));
  await core.decideApproval(approval.id, "approved");
  const content = existsSync(join(folder, "hello.txt")) ? git("show", "HEAD:hello.txt").trim() : null;
  console.log("merged before approval:", mergedBefore, "| hello.txt after approval:", JSON.stringify(content));
  ok = !mergedBefore && content === "hello from the team";
  // Let the lead's "task finished" turn end so its cost is counted.
  await new Promise((done) => setTimeout(done, 20_000));
} else {
  console.log("No merge approval arrived.");
}
console.log("tasks:", core.listTasks(workspace.id).map((t) => `#${t.number} ${t.status}`));
console.log("spent (USD):", core.budget(workspace.id).spentUsd.toFixed(3));
console.log(ok ? "PASS" : "FAIL");
await core.close();
server.close();
process.exit(ok ? 0 : 1);
