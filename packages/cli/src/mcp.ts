/**
 * `peritos mcp` — the permission bridge. Claude Code starts this as an MCP
 * server and calls its one tool, `approve`, whenever a tool call needs the
 * user's say-so. The call is passed to the LosPeritos core, which shows it to
 * the user as a seal request and answers once they have decided.
 *
 * MCP over stdio is newline-delimited JSON-RPC 2.0; this file speaks just the
 * part a tool server needs.
 */
import http from "node:http";
import { createInterface } from "node:readline";

interface Rpc {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, any>;
}

const TOOL = {
  name: "approve",
  description: "Ask the LosPeritos user to approve or refuse a tool call.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: { type: "object" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
};

/** POST and wait for the answer however long it takes: the user may be away for hours. */
function askCore(url: string, token: string, body: unknown): Promise<{ decision?: string; error?: { message: string } }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const request = http.request(
      `${url}/agent/permission`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: 0,
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error("LosPeritos gave an unreadable answer"));
          }
        });
      },
    );
    request.on("error", reject);
    request.end(data);
  });
}

export function runPermissionBridge(url: string, token: string): void {
  const reply = (id: Rpc["id"], result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  const fail = (id: Rpc["id"], code: number, message: string) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");

  createInterface({ input: process.stdin }).on("line", async (line) => {
    let message: Rpc;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // Notifications carry no id and get no reply.
    if (message.id === undefined) return;
    switch (message.method) {
      case "initialize":
        return reply(message.id, {
          protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "peritos", version: "0.1.0" },
        });
      case "ping":
        return reply(message.id, {});
      case "tools/list":
        return reply(message.id, { tools: [TOOL] });
      case "tools/call": {
        const args = message.params?.arguments ?? {};
        const input = args.input ?? {};
        let verdict: Record<string, unknown>;
        try {
          const answer = await askCore(url, token, { tool: String(args.tool_name ?? "tool"), input });
          verdict =
            answer.decision === "approved"
              ? { behavior: "allow", updatedInput: input }
              : { behavior: "deny", message: answer.error?.message ?? "The user refused this. Do not retry it; continue without it or ask what to do instead." };
        } catch (err) {
          // If the core cannot be reached, the safe answer is no.
          verdict = { behavior: "deny", message: `LosPeritos could not be reached (${(err as Error).message}).` };
        }
        return reply(message.id, { content: [{ type: "text", text: JSON.stringify(verdict) }] });
      }
      default:
        return fail(message.id, -32601, `Unknown method ${message.method}`);
    }
  });
}
