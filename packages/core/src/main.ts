#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { startCore } from "./start.js";

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

try {
  const running = await startCore({
    dataDir,
    fake,
    port: Number(values.port),
    cliEntry: fileURLToPath(new URL("../../cli/dist/main.js", import.meta.url)),
  });
  console.log(`LosPeritos core listening on ${running.url}${fake ? " (fake agents)" : ""}`);
  console.log(`Token file: ${join(dataDir, "token.json")}`);

  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(
      `Port ${values.port} is already in use: LosPeritos is probably running already. ` +
        "Open http://localhost:5173, or stop the other copy first.",
    );
    process.exit(1);
  }
  throw err;
}
