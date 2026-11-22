#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ClaudeCodeAdapter, FakeAdapter } from "@losperitos/adapters";
import { AppStore } from "@losperitos/storage";
import { Core } from "./core.js";
import { createServer } from "./server.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "7420" },
    "data-dir": { type: "string" },
    /** Run every agent on the scripted fake adapter; spends no tokens. */
    fake: { type: "boolean", default: false },
  },
});

const fake = values.fake;
const dataDir = values["data-dir"] ?? join(homedir(), fake ? ".losperitos-demo" : ".losperitos");

const app = new AppStore(dataDir);
let token = app.token();
if (!token) {
  token = randomBytes(24).toString("hex");
  app.setToken(token);
}

const core = new Core({
  dataDir,
  adapters: [new FakeAdapter(), new ClaudeCodeAdapter()],
  leadAdapter: fake ? "fake" : "claude-code",
});
const server = createServer(core, token);
core.setBridge(
  `http://127.0.0.1:${values.port}`,
  fileURLToPath(new URL("../../cli/dist/main.js", import.meta.url)),
);

server.listen(Number(values.port), "127.0.0.1", () => {
  console.log(`LosPeritos core listening on http://127.0.0.1:${values.port}${fake ? " (fake agents)" : ""}`);
  console.log(`Token file: ${join(dataDir, "token.json")}`);
});

const shutdown = async () => {
  await core.close();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
