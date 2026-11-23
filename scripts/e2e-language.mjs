// End-to-end check, with your real `claude` CLI, that a team answers in the
// user's language: the user writes Turkish, the lead hands a task to a
// teammate, and everything the user reads (the lead's messages, the task, the
// report) should be Turkish, also after the app's own English notices.
// Spends real usage (capped by a $1.5 budget). Run `npm run build` first.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-lang-")));
const core = new Core({ dataDir: mkdtempSync(join(tmpdir(), "lp-e2e-data-")), adapters: [new ClaudeCodeAdapter()], leadAdapter: "claude-code" });
const server = createServer(core, "e2e");
await new Promise((done) => server.listen(0, "127.0.0.1", done));
core.setBridge(`http://127.0.0.1:${server.address().port}`, fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url)));
core.subscribe(({ event }) => {
  if (event.type === "agent.updated") console.log(`[agent] ${event.agent.name}: ${event.agent.status}${event.agent.error ? " — " + event.agent.error : ""}`);
});
const workspace = core.openWorkspace(folder);
// As the app does when it is shown in Turkish.
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 1.5, language: "tr" });
core.sendMessage(workspace.id, {
  body: "Merhaba. Bu klasöre notlar.md adında bir dosya açtır; içinde hafta sonu kahvaltısı için üç maddelik bir alışveriş listesi olsun. Bunu kendin yapma, bir ekip arkadaşına görev olarak ver; bitince bana kısaca haber ver.",
  toAgentId: null,
  taskId: null,
});

const deadline = Date.now() + 6 * 60_000;
while (Date.now() < deadline) {
  await new Promise((done) => setTimeout(done, 1000));
  for (const approval of core.waiting().approvals) await core.decideApproval(approval.id, "approved");
  const tasks = core.listTasks(workspace.id);
  const agents = core.listAgents(workspace.id);
  if (tasks.length && tasks.every((task) => task.status === "done") && agents.every((agent) => agent.status !== "working")) break;
  if (agents.some((agent) => agent.status === "error")) break;
}
await new Promise((done) => setTimeout(done, 6000));
const tasks = core.listTasks(workspace.id);
const messages = core.listMessages(workspace.id);
const spent = core.budget(workspace.id).spentUsd;
await core.close();
server.close();

const lead = core.listAgents(workspace.id).find((agent) => agent.role === "lead");
const fromLead = messages.filter((m) => m.author.kind === "agent" && m.author.agentId === lead.id).map((m) => m.body);
// What a teammate writes while it works shows in the conversation too.
const fromTeam = messages.filter((m) => m.author.kind === "agent" && m.author.agentId !== lead.id).map((m) => m.body);
const report = tasks[0]?.report;
const read = [...fromLead, ...fromTeam, ...tasks.map((task) => `${task.title}\n${task.description}`), ...(report ? [...report.done, ...report.tested, ...report.notVerified] : [])];
// Rough but telling: Turkish text has Turkish letters or words; English text has these very common words.
const turkish = (text) => /[çğıöşüİ]|\b(ve|bir|için|dosya|görev|tamam|hazır|eklendi|oluşturuldu)\b/i.test(text);
const english = (text) => /\b(the|and|with|has been|created|done|task|file is|I have|I've)\b/i.test(text.replace(/`[^`]*`/g, ""));
for (const [label, text] of [["lead", fromLead.join("\n---\n")], ["teammate", fromTeam.join("\n---\n")], ["task", tasks.map((task) => `${task.title}: ${task.description}`).join("\n")], ["report", report ? JSON.stringify(report, null, 1) : "(none)"]]) console.log(`\n${label}:\n${text}`);
const wrong = read.filter((text) => text.trim() && (!turkish(text) || english(text)));
console.log("\nspent (USD):", spent.toFixed(3), "| pieces read by the user:", read.length, "| not Turkish:", wrong.length);
for (const text of wrong) console.log("  ✗ " + text.slice(0, 160).replace(/\n/g, " "));
const ok = tasks.length >= 1 && tasks.every((task) => task.status === "done") && fromLead.length >= 2 && wrong.length === 0;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
