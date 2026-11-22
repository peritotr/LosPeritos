// Checks, with your real `claude` CLI, that the lead's conversation survives a
// restart: tell it a word, shut the core down, start a new core on the same
// data, and ask for the word. Spends a little real usage. Run `npm run build` first.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startCore } from "../packages/core/dist/index.js";

const folder = realpathSync(mkdtempSync(join(tmpdir(), "lp-resume-")));
const dataDir = mkdtempSync(join(tmpdir(), "lp-resume-data-"));
const cliEntry = fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url));

/** Send one message to the lead and wait for its turn to end; returns its reply. */
async function turn(core, workspaceId, body) {
  const before = core.listMessages(workspaceId).length;
  core.sendMessage(workspaceId, { body, toAgentId: null, taskId: null });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 400));
    const [lead] = core.listAgents(workspaceId);
    if (lead.status === "error") throw new Error(lead.error);
    if (lead.status === "idle" && core.listMessages(workspaceId).length > before + 1) break;
  }
  return core.listMessages(workspaceId).at(-1).body;
}

let spent = 0;
const first = await startCore({ dataDir, cliEntry });
const workspace = first.core.openWorkspace(folder);
console.log("first run :", (await turn(first.core, workspace.id, "Remember this word for later: kumquat. Reply with only: ok")).slice(0, 80));
const sessionId = first.core.listAgents(workspace.id)[0].sessionId;
spent += first.core.budget(workspace.id).spentUsd;
await first.close();

const second = await startCore({ dataDir, cliEntry });
const reply = await turn(second.core, workspace.id, "Which word did I ask you to remember? Reply with the word only.");
console.log("second run:", reply.slice(0, 80));
const same = second.core.listAgents(workspace.id)[0].sessionId === sessionId;
spent = second.core.budget(workspace.id).spentUsd;
await second.close();

const ok = same && /kumquat/i.test(reply);
console.log("same conversation id:", same, "| spent (USD):", spent.toFixed(3));
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
