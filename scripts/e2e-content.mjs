// End-to-end check of a content bureau with your real `claude` CLI, outside
// git: a writer drafts a short newsletter, the first draft is rejected with a
// note, and the second is accepted. Spends real usage (capped by a $2
// workspace budget). Run `npm run build` first.
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeCodeAdapter } from "../packages/adapters/dist/index.js";
import { Core, createServer } from "../packages/core/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-e2e-content-")));
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
  if (event.type === "task.updated") console.log(`[task] #${event.task.number} ${event.task.specialty} ${event.task.effort} ${event.task.status} — ${event.task.title}`);
  if (event.type === "approval.requested") console.log(`[approval] ${event.approval.kind}: ${event.approval.title}`);
});

const workspace = core.openWorkspace(folder, "content");
core.updateWorkspace(workspace.id, { dailyBudgetUsd: 2 });
core.sendMessage(workspace.id, {
  body:
    "Bunu tek bir görev olarak bir yazara ver, kendin yapma, soru sorma: İzmir Alsancak'taki butik kahve dükkânımızın " +
    "aylık bülteni için yaklaşık 120 kelimelik bir yazı. Konu: yeni gelen Etiyopya çekirdeği. Dosya adı bulten.md olsun.",
  toAgentId: null,
  taskId: null,
});

const NOTE = "Başlığı soru cümlesi yap ve sonuna dükkânın açılış saatlerini ekle: her gün 08.00-20.00.";
const deadline = Date.now() + 8 * 60_000;
const seals = [];
while (Date.now() < deadline && seals.length < 2) {
  await new Promise((done) => setTimeout(done, 1000));
  if (core.listAgents(workspace.id).some((a) => a.status === "error")) break;
  const approval = core.waiting().approvals.find((a) => a.kind === "merge");
  if (!approval) continue;
  const task = core.getTask(approval.taskId);
  const draft = readFileSync(join(task.worktree, "bulten.md"), "utf8");
  const inProject = existsSync(join(folder, "bulten.md"));
  seals.push({ draft, inProject });
  console.log(`\n── draft ${seals.length} (in the project already: ${inProject})\n${draft}`);
  if (seals.length === 1) {
    await core.decideApproval(approval.id, "rejected");
    core.sendMessage(workspace.id, { body: NOTE, toAgentId: task.assigneeId, taskId: task.id });
  } else {
    await core.decideApproval(approval.id, "approved");
  }
}
await new Promise((done) => setTimeout(done, 15_000));

const final = existsSync(join(folder, "bulten.md")) ? readFileSync(join(folder, "bulten.md"), "utf8") : null;
const heading = final?.split("\n").find((line) => line.trim()) ?? "";
const words = final?.split(/\s+/).filter(Boolean).length ?? 0;
const ok =
  seals.length === 2 &&
  seals.every((seal) => !seal.inProject) &&
  final === seals[1].draft &&
  heading.includes("?") &&
  /08[.:]00/.test(final);
console.log("\ntasks:", core.listTasks(workspace.id).map((t) => `#${t.number} ${t.effort} ${t.status}`).join(", "));
console.log("heading:", heading, "| words:", words);
console.log("spent (USD):", core.budget(workspace.id).spentUsd.toFixed(3));
console.log(ok ? "PASS" : "FAIL");
await core.close();
server.close();
process.exit(ok ? 0 : 1);
