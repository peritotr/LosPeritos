/**
 * Just enough of an MCP client to ask a server which tools it has, so the
 * user can see them before any agent is given the connector.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { launch, type McpServer } from "@losperitos/adapters";
import type { ConnectorTool } from "@losperitos/protocol";

const TIMEOUT_MS = 45_000;
const INIT = {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "losperitos", version: "1" },
};

interface RawTool {
  name?: unknown;
  description?: unknown;
  annotations?: { readOnlyHint?: unknown };
}

function shape(result: unknown): ConnectorTool[] {
  const tools = (result as { tools?: RawTool[] } | undefined)?.tools;
  if (!Array.isArray(tools)) throw new Error("The server did not list any tools.");
  return tools
    .filter((tool): tool is RawTool & { name: string } => typeof tool.name === "string")
    .map((tool) => {
      const text = typeof tool.description === "string" ? tool.description.trim().split("\n")[0]! : "";
      return {
        name: tool.name,
        description: text.length > 200 ? text.slice(0, 199) + "…" : text,
        readOnly: typeof tool.annotations?.readOnlyHint === "boolean" ? tool.annotations.readOnlyHint : null,
      };
    });
}

/** A local program: newline-delimited JSON-RPC over its stdin and stdout. */
function listOverStdio(server: Extract<McpServer, { command: string }>): Promise<ConnectorTool[]> {
  return new Promise((resolve, reject) => {
    const how = launch(server.command, server.args);
    const child = spawn(how.file, how.args, {
      shell: how.shell,
      env: { ...process.env, ...server.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let errors = "";
    const end = (act: () => void) => {
      clearTimeout(timer);
      child.kill();
      act();
    };
    const timer = setTimeout(() => end(() => reject(new Error("The server did not answer in time."))), TIMEOUT_MS);
    const say = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
    child.on("error", (err) => end(() => reject(new Error(`Cannot run ${server.command}: ${err.message}`))));
    child.on("exit", (code) =>
      end(() => reject(new Error(`The server stopped (${code ?? "killed"}). ${errors.trim().split("\n").at(-1) ?? ""}`.trim()))),
    );
    child.stdin.on("error", () => undefined);
    child.stderr.on("data", (data: Buffer) => (errors = (errors + data.toString()).slice(-2000)));
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line);
      } catch {
        return; // Some servers print a greeting before they speak JSON.
      }
      if (message.error) return end(() => reject(new Error(message.error!.message ?? "The server refused.")));
      if (message.id === 1) {
        say({ method: "notifications/initialized" });
        say({ id: 2, method: "tools/list" });
      } else if (message.id === 2) {
        end(() => {
          try {
            resolve(shape(message.result));
          } catch (err) {
            reject(err as Error);
          }
        });
      }
    });
    say({ id: 1, method: "initialize", params: INIT });
  });
}

/** A server over HTTP: one POST per call; the answer is JSON or a short event stream. */
async function listOverHttp(server: Extract<McpServer, { url: string }>): Promise<ConnectorTool[]> {
  let session: string | null = null;
  const call = async (body: object): Promise<unknown> => {
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        ...server.headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(session && { "Mcp-Session-Id": session }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("The server refused the sign-in. It may need a secret, or a sign-in this app cannot do yet.");
    }
    if (!response.ok) throw new Error(`The server answered ${response.status}.`);
    session = response.headers.get("mcp-session-id") ?? session;
    const text = await response.text();
    if (!text.trim()) return undefined;
    const json = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).at(-1)
      : text;
    const message = JSON.parse(json ?? "{}") as { result?: unknown; error?: { message?: string } };
    if (message.error) throw new Error(message.error.message ?? "The server refused.");
    return message.result;
  };
  await call({ id: 1, method: "initialize", params: INIT });
  await call({ method: "notifications/initialized" });
  return shape(await call({ id: 2, method: "tools/list" }));
}

export function listTools(server: McpServer): Promise<ConnectorTool[]> {
  return "url" in server ? listOverHttp(server) : listOverStdio(server);
}
