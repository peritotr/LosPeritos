// End-to-end check, with your real `claude` CLI, that a lead shows the user
// what it is asking about: the folder holds two logo drawings and the user asks
// to be asked which one to keep. The question should arrive with both drawings
// attached. Spends real usage (capped by a $1 budget). Run `npm run build` first.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-show-")));
mkdirSync(join(folder, "gorseller/logo"), { recursive: true });
const svg = (shape) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3A4A3A"/>${shape}</svg>`;
writeFileSync(join(folder, "gorseller/logo/rota-m.svg"), svg('<path d="M20 70 L35 30 L50 55 L65 30 L80 70" stroke="#F2ECE0" stroke-width="6" fill="none"/>'));
writeFileSync(join(folder, "gorseller/logo/yol-rozeti.svg"), svg('<circle cx="50" cy="50" r="30" stroke="#F2ECE0" stroke-width="6" fill="none"/>'));

const core = new Core({ dataDir: mkdtempSync(join(tmpdir(), "lp-e2e-data-")), adapters: [new ClaudeCodeAdapter()], leadAdapter: "claude-code" });
const server = createServer(core, "e2e");
await new Promise((done) => server.listen(0, "127.0.0.1", done));
core.setBridge(`http://127.0.0.1:${server.address().port}`, fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url)));
core.subscribe(({ event }) => {
  if (event.type === "agent.output" && event.tool) console.log(`[tool] ${event.tool.name} ${JSON.stringify(event.tool.input).slice(0, 220)}`);
});
const workspace = core.openWorkspace(folder, "marketing");
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 1, language: "tr" });
core.sendMessage(workspace.id, {
  body: "gorseller/logo klasöründe iki logo taslağı var. Görev açma; ikisine bak ve hangisini seçmem gerektiğini bana sor.",
  toAgentId: null,
  taskId: null,
});

const deadline = Date.now() + 3 * 60_000;
let question;
while (Date.now() < deadline && !question) {
  await new Promise((done) => setTimeout(done, 500));
  question = core.waiting().questions[0];
  if (core.listAgents(workspace.id)[0]?.status === "error") break;
}
await new Promise((done) => setTimeout(done, 1500));
const spent = core.budget(workspace.id).spentUsd;
await core.close();
server.close();
console.log("\nquestion:", question?.body, "\noptions:", question?.question?.options, "\nattached:", question?.attachments);
console.log("spent (USD):", spent.toFixed(3));
const ok = !!question && (question.attachments?.length ?? 0) === 2 && !/widget/i.test(question.body);
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
