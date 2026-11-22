// Start the core and the UI together.
//   npm run dev            scripted fake agents, demo workspace, spends nothing
//   npm run dev -- --real  your own Claude Code CLI and your real workspaces
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const real = process.argv.includes("--real");
const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = join(homedir(), real ? ".losperitos" : ".losperitos-demo");
const url = "http://127.0.0.1:7420";

const core = spawn(
  process.execPath,
  [join(root, "packages/core/dist/main.js"), ...(real ? [] : ["--fake"])],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const children = [core];
const stop = () => children.forEach((child) => child.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
core.on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});

await new Promise((ready) => {
  core.stdout.on("data", (data) => {
    process.stdout.write(data);
    if (String(data).includes("listening")) ready();
  });
});
const token = JSON.parse(readFileSync(join(dataDir, "token.json"), "utf8")).token;

if (!real) {
  const folder = join(dataDir, "workspace");
  mkdirSync(folder, { recursive: true });
  await fetch(`${url}/workspaces`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: folder }),
  });
}

const ui = spawn("npm", ["run", "dev", "--workspace", "@losperitos/ui"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, LP_CORE_URL: url, LP_CORE_TOKEN: token },
});
children.push(ui);
ui.on("exit", stop);
