// End-to-end check of connectors with your real `claude` CLI: a bureau is given
// a small MCP server with one tool that reads and one that publishes. The
// reading tool is set free and goes straight through; the publishing one waits
// for a seal, and nothing is published before it. Spends real usage (capped by
// a $1 workspace budget). Run `npm run build` first.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";
import { SaveConnectorRequest } from "../packages/protocol/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-connector-")));
const outside = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-outside-")));
const published = join(outside, "published.txt");

// The "outside service": newline-delimited JSON-RPC over stdio, two tools.
const serverFile = join(outside, "server.mjs");
writeFileSync(
  serverFile,
  `import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
const tools = [
  { name: "get_slogan", description: "Read the shop's current slogan.", inputSchema: { type: "object", properties: {} } },
  { name: "publish_slogan", description: "Publish a new slogan on the shop's site.", inputSchema: { type: "object", properties: { slogan: { type: "string" } }, required: ["slogan"] } },
];
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === "initialize") return reply(message.id, { protocolVersion: message.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "shop", version: "1" } });
  if (message.method === "tools/list") return reply(message.id, { tools });
  if (message.method === "tools/call") {
    if (process.env.SHOP_KEY !== "k-123") return reply(message.id, { isError: true, content: [{ type: "text", text: "wrong key" }] });
    if (message.params.name === "get_slogan") return reply(message.id, { content: [{ type: "text", text: "Kahve, yavaş yavaş." }] });
    writeFileSync(${JSON.stringify(published)}, message.params.arguments.slogan);
    return reply(message.id, { content: [{ type: "text", text: "Published." }] });
  }
  reply(message.id, {});
});
`,
);

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
  if (event.type === "agent.output" && event.tool) console.log(`[tool] ${event.tool.name}`);
  if (event.type === "approval.requested") console.log(`[approval] ${event.approval.kind}: ${event.approval.title}`);
});

const workspace = core.openWorkspace(folder, "marketing");
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 1 });
core.saveConnector(
  workspace.id,
  SaveConnectorRequest.parse({
    id: "shop",
    name: "Shop site",
    command: process.execPath,
    args: [serverFile],
    secrets: { SHOP_KEY: "k-123" },
    free: ["get_*"],
  }),
);
core.sendMessage(workspace.id, {
  body:
    "Bunu kendin yap, görev açma, soru sorma: Shop site bağlayıcısıyla dükkânın şu anki sloganını oku, " +
    "sonra aynı bağlayıcıyla yeni slogan olarak tam şunu yayınla: Alsancak'ın en taze fincanı. " +
    "Sonunda eski sloganın ne olduğunu yaz.",
  toAgentId: null,
  taskId: null,
});

const deadline = Date.now() + 4 * 60_000;
let sealed = 0;
let early = false;
let kinds = [];
while (Date.now() < deadline) {
  await new Promise((done) => setTimeout(done, 500));
  for (const approval of core.waiting().approvals) {
    kinds.push(approval.kind);
    if (existsSync(published)) early = true;
    console.log(`[seal] ${approval.title}\n${approval.detail}\n       published before the seal: ${existsSync(published)}`);
    await core.decideApproval(approval.id, "approved");
    sealed++;
  }
  const lead = core.listAgents(workspace.id)[0];
  if (sealed > 0 && lead?.status === "idle") break;
  if (lead?.status === "error") break;
}
await new Promise((done) => setTimeout(done, 3000));

const said = core.listMessages(workspace.id).filter((m) => m.author.kind === "agent").map((m) => m.body).join("\n");
const text = existsSync(published) ? readFileSync(published, "utf8") : null;
console.log("\nlead said:\n" + said);
console.log("\npublished:", text, "| seals:", sealed, kinds.join(","), "| published early:", early);
console.log("spent (USD):", core.budget(workspace.id).spentUsd.toFixed(3));
// One seal, for the publishing call alone; the read went through unasked and its answer came back.
const ok = sealed === 1 && kinds[0] === "connector" && !early && !!text && /Alsancak/.test(text) && /yavaş yavaş/i.test(said);
console.log(ok ? "PASS" : "FAIL");
await core.close();
server.close();
process.exit(ok ? 0 : 1);
