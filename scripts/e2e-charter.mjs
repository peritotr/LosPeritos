// End-to-end check, with your real `claude` CLI, of a bureau that works by a
// charter of the user's own: a made-up kind of bureau with its own roles, its
// own shape of handed-in work and its own checks. The team should hand the
// work to one of the charter's roles and hand in what the charter describes.
// Routine seals are left to the lead, so nobody answers for the user here.
// Spends real usage (capped by a $2 budget). Run `npm run build` first.
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";
import { Charter } from "../packages/protocol/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-charter-")));
const core = new Core({ dataDir: mkdtempSync(join(tmpdir(), "lp-e2e-data-")), adapters: [new ClaudeCodeAdapter()], leadAdapter: "claude-code" });
const server = createServer(core, "e2e");
await new Promise((done) => server.listen(0, "127.0.0.1", done));
core.setBridge(`http://127.0.0.1:${server.address().port}`, fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url)));
core.subscribe(({ event }) => {
  if (event.type === "agent.updated") console.log(`[agent] ${event.agent.name}: ${event.agent.status}`);
});
const charter = Charter.parse({
  template: "custom",
  title: "Slogan atölyesi",
  job: "Küçük işletmeler için kısa sloganlar yazarız. Her iş bir işletmenin tarifiyle başlar ve işletme sahibinin tabelaya yazdırabileceği üç seçenekle biter. Süslü değil, akılda kalan sözler ararız.",
  specialties: ["Sloganci", "Dil denetçisi"],
  deliverable: "sloganlar.md adında tek bir dosya: tam üç satır, her satırda bir slogan, başka hiçbir şey yok (başlık, numara ya da açıklama yok).",
  done: ["Dosyada tam üç satır var", "Her slogan en fazla 40 karakter; wc ile sayıldı", "Hiçbir sloganda ünlem işareti yok"],
  seal: ["İngilizce slogan yazmak"],
});
const workspace = core.openWorkspace(folder, "content", charter);
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 2, language: "tr", delegation: "routine" });
core.sendMessage(workspace.id, { body: "Mahallemizdeki bir kahve dükkânı için slogan yazdır. Bunu bir ekip arkadaşına görev olarak ver.", toAgentId: null, taskId: null });

const deadline = Date.now() + 7 * 60_000;
while (Date.now() < deadline) {
  await new Promise((done) => setTimeout(done, 1000));
  if (core.waiting().approvals.length || core.waiting().questions.length) break;
  const tasks = core.listTasks(workspace.id);
  const agents = core.listAgents(workspace.id);
  if (tasks.length && tasks.every((task) => task.status === "done") && agents.every((agent) => agent.status !== "working")) break;
  if (agents.some((agent) => agent.status === "error")) break;
}
await new Promise((done) => setTimeout(done, 4000));
const tasks = core.listTasks(workspace.id);
const members = core.listAgents(workspace.id).filter((agent) => agent.role === "member").map((agent) => agent.specialty);
const reached = [...core.waiting().approvals.map((a) => a.title), ...core.waiting().questions.map((q) => q.body)];
const spent = core.budget(workspace.id).spentUsd;
await core.close();
server.close();

const file = join(folder, "sloganlar.md");
const text = existsSync(file) ? readFileSync(file, "utf8") : null;
const slogans = (text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
console.log("\nroles the lead handed work to:", members);
console.log("tasks:", tasks.map((task) => `#${task.number} ${task.status} (${task.specialty})`).join(", "));
console.log("report:", JSON.stringify(tasks[0]?.report, null, 1));
console.log("sloganlar.md:", text === null ? "missing" : JSON.stringify(text));
console.log("reached the user:", reached);
console.log("spent (USD):", spent.toFixed(3));
const ok =
  tasks.length >= 1 && tasks.every((task) => task.status === "done") &&
  members.every((role) => ["sloganci", "dil-denetçisi", "dil-denetcisi"].includes(String(role).toLowerCase())) &&
  slogans.length === 3 && slogans.every((line) => [...line].length <= 40 && !line.includes("!")) && reached.length === 0;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
