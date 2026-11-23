// End-to-end check of the coordinator with your real `claude` CLI: two bureaus
// and a coordinator over them. The coordinator is given one job with two parts
// and has to hand each part to the bureau it belongs to, opening no dossier and
// doing no work itself. The check ends once both hand-overs have arrived; the
// bureaus are stopped before they spend on the work. Spends real usage (capped
// by small budgets). Run `npm run build` first.
import { mkdtempSync, realpathSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";

const site = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-site-")));
const copy = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-copy-")));
writeFileSync(join(site, "index.html"), "<h1>Kahve Dükkânı</h1>\n<p>Hafta içi 08:00-20:00</p>\n");
const dataDir = mkdtempSync(join(tmpdir(), "lp-e2e-data-"));

const core = new Core({ dataDir, adapters: [new ClaudeCodeAdapter()], leadAdapter: "claude-code" });
const server = createServer(core, "e2e");
await new Promise((done) => server.listen(0, "127.0.0.1", done));
core.setBridge(`http://127.0.0.1:${server.address().port}`, fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url)));
core.subscribe(({ event }) => {
  if (event.type === "agent.updated") console.log(`[agent] ${event.agent.workspaceId.slice(0, 4)} ${event.agent.name}: ${event.agent.status}${event.agent.error ? " — " + event.agent.error : ""}`);
  if (event.type === "agent.output" && event.tool) console.log(`[tool] ${event.tool.name} ${JSON.stringify(event.tool.input).slice(0, 160)}`);
});

const siteBureau = core.openWorkspace(site, "software");
core.updateWorkspace(siteBureau.id, { name: "Dükkan Sitesi", dailyBudgetUsd: 0.5 });
const copyBureau = core.openWorkspace(copy, "content");
core.updateWorkspace(copyBureau.id, { name: "Dükkan Yazıları", dailyBudgetUsd: 0.5 });
const coordinator = core.openCoordinator("Koordinatör");
core.updateWorkspace(coordinator.id, { dailyBudgetUsd: 1 });

core.sendMessage(coordinator.id, {
  body: "Dükkân artık pazar günleri de 10:00-18:00 arası açık. Sitedeki çalışma saatlerine bunu ekletir misin, bir de bunu duyuran iki cümlelik bir yazı yazdır.",
  toAgentId: null,
  taskId: null,
});

const arrived = (bureau) => core.listMessages(bureau.id).filter((message) => message.author.kind === "bureau");
const deadline = Date.now() + 4 * 60_000;
while (Date.now() < deadline) {
  await new Promise((done) => setTimeout(done, 500));
  if (arrived(siteBureau).length && arrived(copyBureau).length) break;
  const lead = core.listAgents(coordinator.id)[0];
  if (lead?.status === "error" || lead?.status === "asking") break;
}
// The hand-overs are what is being checked: stop the bureaus before they spend on the work itself.
const coordinatorTasks = core.listTasks(coordinator.id).length;
await new Promise((done) => setTimeout(done, 4000));
const said = core.listMessages(coordinator.id).filter((message) => message.author.kind === "agent").map((message) => message.body);
const toSite = arrived(siteBureau).map((message) => message.body);
const toCopy = arrived(copyBureau).map((message) => message.body);
const spent = [coordinator, siteBureau, copyBureau].map((bureau) => core.budget(bureau.id).spentUsd);
await core.close();
server.close();

console.log("\ncoordinator said:\n" + said.join("\n---\n"));
console.log("\nto the site bureau:\n" + toSite.join("\n---\n"));
console.log("\nto the copy bureau:\n" + toCopy.join("\n---\n"));
console.log("\nfiles the coordinator left in its own folder:", readdirSync(join(dataDir, "coordinator")).filter((name) => name !== ".losperitos"));
console.log("spent (USD): coordinator", spent[0].toFixed(3), "| site", spent[1].toFixed(3), "| copy", spent[2].toFixed(3));
// Each part went to the bureau it belongs to; the coordinator opened no dossier and wrote nothing itself.
const ok =
  toSite.length >= 1 && toCopy.length >= 1 && coordinatorTasks === 0 &&
  /pazar/i.test(toSite.join(" ")) && /pazar/i.test(toCopy.join(" ")) &&
  readdirSync(join(dataDir, "coordinator")).filter((name) => name !== ".losperitos").length === 0;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
