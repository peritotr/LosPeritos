// End-to-end check, with your real `claude` CLI, of leaving routine seals to
// the lead: a content bureau is asked for a short text, a teammate writes it in
// a draft, and the lead (not the user) reviews and seals it. Nobody answers on
// the user's behalf in this script; if a seal reaches the user, the check fails.
// Spends real usage (capped by a $2 budget). Run `npm run build` first.
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-deleg-")));
const core = new Core({ dataDir: mkdtempSync(join(tmpdir(), "lp-e2e-data-")), adapters: [new ClaudeCodeAdapter()], leadAdapter: "claude-code" });
const server = createServer(core, "e2e");
await new Promise((done) => server.listen(0, "127.0.0.1", done));
core.setBridge(`http://127.0.0.1:${server.address().port}`, fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url)));
core.subscribe(({ event }) => {
  if (event.type === "agent.updated") console.log(`[agent] ${event.agent.name}: ${event.agent.status}`);
  if (event.type === "agent.output" && event.tool && /peritos (seal|task|ask)/.test(JSON.stringify(event.tool.input))) console.log(`[tool] ${JSON.stringify(event.tool.input).slice(0, 260)}`);
});
const workspace = core.openWorkspace(folder, "content");
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 2, language: "tr", delegation: "routine" });
core.sendMessage(workspace.id, {
  body: "Kahve dükkânımız için 'pazar günleri de açığız' diyen üç cümlelik bir duyuru yazdır; duyuru.md dosyasına yazılsın. Bunu bir ekip arkadaşına görev olarak ver.",
  toAgentId: null,
  taskId: null,
});

const deadline = Date.now() + 7 * 60_000;
let reachedUser = [];
while (Date.now() < deadline) {
  await new Promise((done) => setTimeout(done, 1000));
  reachedUser = core.waiting().approvals;
  if (reachedUser.length || core.waiting().questions.length) break;
  const tasks = core.listTasks(workspace.id);
  const agents = core.listAgents(workspace.id);
  if (tasks.length && tasks.every((task) => task.status === "done") && agents.every((agent) => agent.status !== "working")) break;
  if (agents.some((agent) => agent.status === "error")) break;
}
await new Promise((done) => setTimeout(done, 5000));
const tasks = core.listTasks(workspace.id);
const seals = core.listApprovals(workspace.id);
const questions = core.waiting().questions.map((message) => message.body);
const spent = core.budget(workspace.id).spentUsd;
const said = core.listMessages(workspace.id).filter((m) => m.author.kind === "agent").map((m) => m.body).slice(-3);
await core.close();
server.close();

const file = join(folder, "duyuru.md");
console.log("\nseals:");
for (const seal of seals) console.log(`  ${seal.title} → ${seal.status}, decided by ${seal.decidedBy ?? "-"}${seal.delegated ? " (still with the lead)" : ""}\n    note: ${seal.note ?? "-"}`);
console.log("reached the user:", reachedUser.map((seal) => seal.title), "| questions:", questions);
console.log("tasks:", tasks.map((task) => `#${task.number} ${task.status}`).join(", "));
console.log("duyuru.md in the folder:", existsSync(file) ? JSON.stringify(readFileSync(file, "utf8").slice(0, 300)) : "missing");
console.log("\nlead's last words:\n" + said.join("\n---\n"));
console.log("\nspent (USD):", spent.toFixed(3));
const byLead = seals.filter((seal) => seal.kind === "merge" && seal.status === "approved" && seal.decidedBy === "lead");
const ok = byLead.length >= 1 && reachedUser.length === 0 && tasks.length >= 1 && tasks.every((task) => task.status === "done") && existsSync(file) && !!byLead[0].note;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
