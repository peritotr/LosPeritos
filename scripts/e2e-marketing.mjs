// End-to-end check of a marketing bureau with your real `claude` CLI: in a
// folder that is not a git repository, the lead hands out two tasks, each team
// member writes a document to its draft folder, and it reaches the project only
// once sealed. Spends real usage (capped by a $2
// workspace budget). Run `npm run build` first.
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-marketing-")));
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
  if (event.type === "agent.updated") console.log(`[agent] ${event.agent.name}: ${event.agent.status}${event.agent.error ? " — " + event.agent.error : ""}`);
  if (event.type === "task.updated") console.log(`[task] #${event.task.number} ${event.task.specialty} ${event.task.status} — ${event.task.title}`);
  if (event.type === "message.created" && event.message.question) console.log(`[question] ${event.message.body}`);
  if (event.type === "approval.requested") console.log(`[approval] ${event.approval.kind}: ${event.approval.title}`);
});

const workspace = core.openWorkspace(folder, "marketing");
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 2 });
core.sendMessage(workspace.id, {
  body:
    "Küçük bir butik kahve dükkânımız var, İzmir Alsancak'ta. Bunu iki ayrı göreve böl ve ekibe ver, kendin yapma, soru sorma: " +
    "(1) bir SEO uzmanı 10 anahtar kelimelik kısa bir plan çıkarsın (anahtar kelime, arama niyeti, öncelik); " +
    "(2) bir metin yazarı Google arama reklamı için 3 başlık (en çok 30 karakter) ve 2 açıklama (en çok 90 karakter) yazsın. " +
    "İkisi de küçük iş.",
  toAgentId: null,
  taskId: null,
});

// Outside git each member writes to a draft folder; its files reach the project only when sealed.
const deadline = Date.now() + 8 * 60_000;
const closed = () => core.listTasks(workspace.id).filter((t) => t.status === "done");
let leaked = false;
let sealed = 0;
while (Date.now() < deadline) {
  await new Promise((done) => setTimeout(done, 1000));
  for (const approval of core.waiting().approvals.filter((a) => a.kind === "merge")) {
    const task = core.getTask(approval.taskId);
    const early = (task.report?.files ?? []).filter((file) => existsSync(join(folder, file)));
    if (early.length) leaked = true;
    console.log(`[seal] ${approval.title}\n       steps: ${approval.steps.join(" | ")}\n       in the project before approval: ${early.length ? early.join(", ") : "nothing"}`);
    await core.decideApproval(approval.id, "approved");
    sealed++;
  }
  if (core.listTasks(workspace.id).length >= 2 && closed().length === core.listTasks(workspace.id).length) break;
  if (core.listAgents(workspace.id).some((a) => a.status === "error")) break;
}
// Let the lead's closing turn end so its cost is counted.
await new Promise((done) => setTimeout(done, 15_000));

const tasks = core.listTasks(workspace.id);
let ok = tasks.length >= 2 && closed().length === tasks.length && sealed === tasks.length && !leaked;
for (const task of tasks) {
  console.log(`\n── #${task.number} [${task.specialty}] ${task.status} — ${task.title}`);
  console.log("report:", JSON.stringify(task.report, null, 2));
  const files = task.report?.files ?? [];
  if (files.length === 0) ok = false;
  for (const file of files) {
    const present = existsSync(join(folder, file));
    if (!present) ok = false;
    console.log(`\n── ${file}${present ? "" : " (MISSING)"}`);
    if (present) console.log(readFileSync(join(folder, file), "utf8").slice(0, 2500));
  }
}
console.log("\nsealed:", sealed, "| leaked before approval:", leaked);
console.log("agents:", core.listAgents(workspace.id).map((a) => `${a.name}:${a.status}`).join(", "));
console.log("folder:", folder);
console.log("spent (USD):", core.budget(workspace.id).spentUsd.toFixed(3));
console.log(ok ? "PASS" : "FAIL");
await core.close();
server.close();
process.exit(ok ? 0 : 1);
