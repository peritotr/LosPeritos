import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { ClaudeCodeAdapter, CodexAdapter, FakeAdapter } from "@losperitos/adapters";
import { AppStore } from "@losperitos/storage";
import { Core } from "./core.js";
import { createServer } from "./server.js";

export interface StartOptions {
  /** Machine-level state: the workspace list and the API token. */
  dataDir: string;
  /** Run every agent on the scripted fake adapter; spends no tokens. */
  fake?: boolean;
  /** Port to listen on; 0 (the default) picks a free one. */
  port?: number;
  /** Path of the `peritos` CLI entry point agents call back through. */
  cliEntry: string;
}

export interface RunningCore {
  core: Core;
  server: Server;
  url: string;
  token: string;
  close(): Promise<void>;
}

/**
 * Start the core and its HTTP + WebSocket server on 127.0.0.1.
 * Used by the `losperitos-core` command and by the desktop app.
 */
export async function startCore(options: StartOptions): Promise<RunningCore> {
  const store = new AppStore(options.dataDir);
  let token = store.token();
  if (!token) {
    token = randomBytes(24).toString("hex");
    store.setToken(token);
  }
  const core = new Core({
    dataDir: options.dataDir,
    adapters: [new FakeAdapter(0.04, 700), new ClaudeCodeAdapter(), new CodexAdapter("codex", join(options.dataDir, "codex-threads.json"))],
    leadAdapter: options.fake ? "fake" : "claude-code",
  });
  const server = createServer(core, token);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  core.setBridge(url, options.cliEntry);
  return {
    core,
    server,
    url,
    token,
    async close() {
      await core.close();
      server.close();
    },
  };
}
