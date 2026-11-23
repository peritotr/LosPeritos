// End-to-end check of the Replicate connector with your real `claude` CLI and
// your own Replicate account: a content bureau is asked for one small image.
// Looking up the model goes through unasked; the call that makes the image
// waits for a seal; the image lands in the project once its draft is accepted.
//
// Spends real usage on both: Claude (capped by a $1 workspace budget) and
// Replicate (one image from a cheap model, well under a cent at the time of
// writing). Run `npm run build` first, then:
//   REPLICATE_API_TOKEN=... node scripts/e2e-replicate.mjs
import { existsSync, mkdtempSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";
import { SaveConnectorRequest } from "../packages/protocol/dist/index.js";

const token = process.env.REPLICATE_API_TOKEN;
if (!token) {
  console.error("Set REPLICATE_API_TOKEN to a token from replicate.com/account/api-tokens.");
  process.exit(2);
}

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-replicate-")));
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
  if (event.type === "task.updated") console.log(`[task] #${event.task.number} ${event.task.status} — ${event.task.title}`);
  if (event.type === "agent.output" && event.tool) console.log(`[tool] ${event.tool.name}`);
  if (event.type === "approval.requested") console.log(`[approval] ${event.approval.kind}: ${event.approval.title}`);
});

const workspace = core.openWorkspace(folder, "content");
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 1 });
// The same values the Replicate template in Settings fills in.
core.saveConnector(
  workspace.id,
  SaveConnectorRequest.parse({
    id: "replicate",
    name: "Replicate",
    command: "npx",
    args: ["-y", "replicate-mcp@0.9.0"],
    secrets: { REPLICATE_API_TOKEN: token },
    free: [
      "search_models", "list_models", "get_models", "get_models_*", "list_models_*",
      "list_collections", "get_collections", "list_hardware", "get_predictions", "list_predictions",
    ],
  }),
);
core.sendMessage(workspace.id, {
  body:
    "Tek bir küçük görev aç, soru sorma: bir tasarımcı Replicate bağlayıcısıyla black-forest-labs/flux-schnell modelini " +
    "kullanarak tek bir görsel üretsin: ahşap masada bir fincan kahve, sabah ışığı. Yalnızca bir kez üretsin, " +
    "görseli kahve.webp adıyla kaydetsin.",
  toAgentId: null,
  taskId: null,
});

const deadline = Date.now() + 8 * 60_000;
const seals = [];
while (Date.now() < deadline) {
  await new Promise((done) => setTimeout(done, 1000));
  for (const approval of core.waiting().approvals) {
    seals.push(`${approval.kind}: ${approval.title}`);
    console.log(`[seal] ${approval.kind}: ${approval.title}\n${approval.detail.slice(0, 600)}`);
    await core.decideApproval(approval.id, "approved");
  }
  const tasks = core.listTasks(workspace.id);
  if (tasks.length > 0 && tasks.every((task) => task.status === "done")) break;
  if (core.listAgents(workspace.id).some((agent) => agent.status === "error")) break;
}
await new Promise((done) => setTimeout(done, 10_000));

const [task] = core.listTasks(workspace.id);
const files = task?.report?.files ?? [];
const image = files.find((file) => /\.(webp|png|jpe?g)$/i.test(file));
const size = image && existsSync(join(folder, image)) ? statSync(join(folder, image)).size : 0;
console.log("\nreport:", JSON.stringify(task?.report, null, 2));
console.log("seals:", seals.join(" | "));
console.log("image:", image ?? "none", "| bytes:", size, "| folder:", folder);
console.log("spent on Claude (USD):", core.budget(workspace.id).spentUsd.toFixed(3));
// The paid call was sealed as a connector call, reading was not, and a real image reached the project.
const paid = seals.filter((seal) => seal.startsWith("connector: Replicate: create_"));
const asked = seals.filter((seal) => /Replicate: (search|list|get)_/.test(seal));
const ok = task?.status === "done" && paid.length >= 1 && asked.length === 0 && size > 5000;
console.log(ok ? "PASS" : "FAIL");
await core.close();
server.close();
process.exit(ok ? 0 : 1);
