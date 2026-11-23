/**
 * The bureau from a phone: a small page, served on the local network when the
 * user switches it on, for answering questions, sealing and writing to a lead.
 *
 * It is a second door with its own key. The key opens only what is on that
 * page: no files, no terminals, no connectors, no settings. It travels in the
 * address, over plain HTTP, so it is for a network the user trusts.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import type { PhoneAccess } from "@losperitos/protocol";
import type { Core } from "./core.js";
import { PHONE_PAGE } from "./phone-page.js";

export interface PhoneConfig {
  enabled: boolean;
  token: string;
  port: number;
}

/** After this many wrong keys from one address, it is turned away for a while. */
const WRONG_LIMIT = 10;
const WRONG_WINDOW_MS = 10 * 60_000;
const DEFAULT_PORT = 7421;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 100_000) throw new Error("Too large");
    chunks.push(chunk as Buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export class Phone {
  private server: Server | null = null;
  private port: number | null = null;
  private readonly wrong = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly core: Core,
    private readonly read: () => PhoneConfig | null,
    private readonly write: (config: PhoneConfig) => void,
  ) {}

  /** Addresses of this machine on the networks it is on. */
  private hosts(): string[] {
    return Object.values(networkInterfaces())
      .flat()
      .filter((item) => item && item.family === "IPv4" && !item.internal)
      .map((item) => item!.address);
  }

  status(): PhoneAccess {
    const config = this.read();
    const on = !!config?.enabled && this.server !== null && this.port !== null;
    return { enabled: on, urls: on ? this.hosts().map((host) => `http://${host}:${this.port}/m/${config!.token}`) : [] };
  }

  /** Bring the door in line with the stored choice; called at start and after every change. */
  async apply(): Promise<PhoneAccess> {
    const config = this.read();
    if (!config?.enabled) {
      await this.close();
      return this.status();
    }
    if (!this.server) {
      const server = createServer((req, res) => void this.handle(req, res));
      const listen = (port: number) =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, "0.0.0.0", () => (server.off("error", reject), resolve()));
        });
      // The remembered port keeps a bookmark on the phone working; if it is taken, any free one will do.
      await listen(config.port).catch(() => listen(0));
      this.server = server;
      this.port = (server.address() as AddressInfo).port;
      if (this.port !== config.port) this.write({ ...config, port: this.port });
    }
    return this.status();
  }

  async set(enabled: boolean, renew = false): Promise<PhoneAccess> {
    const before = this.read();
    const token = !before || renew ? randomBytes(18).toString("base64url") : before.token;
    this.write({ enabled, token, port: before?.port ?? DEFAULT_PORT });
    return this.apply();
  }

  close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  /** What the phone is shown: who is waiting for the user, and the last words of each bureau. */
  private view() {
    const waiting = this.core.waiting();
    return {
      bureaus: this.core.listWorkspaces().map((workspace) => {
        const agents = this.core.listAgents(workspace.id);
        const who = (agentId: string | null) => {
          const agent = agents.find((item) => item.id === agentId);
          return agent ? (agent.role === "lead" ? "Lead" : (agent.nickname ?? agent.name)) : "";
        };
        return {
          id: workspace.id,
          name: workspace.name,
          working: agents.filter((agent) => agent.status === "working").length,
          questions: waiting.questions
            .filter((message) => message.workspaceId === workspace.id)
            .map((message) => ({
              id: message.id,
              from: who(message.author.kind === "agent" ? message.author.agentId : null),
              body: message.body,
              options: message.question!.options,
              recommended: message.question!.recommended ?? null,
            })),
          seals: waiting.approvals
            .filter((approval) => approval.workspaceId === workspace.id)
            .map((approval) => ({
              id: approval.id,
              from: who(approval.agentId),
              kind: approval.kind,
              title: approval.title,
              detail: approval.detail.slice(0, 4000),
              steps: approval.steps,
              reversible: approval.reversible,
            })),
          recent: this.core
            .listMessages(workspace.id)
            .slice(-6)
            .map((message) => ({
              from: message.author.kind === "user" ? "you" : message.author.kind === "agent" ? who(message.author.agentId) : message.author.kind === "bureau" ? message.author.name : "",
              body: message.body.slice(0, 600),
              at: message.createdAt,
            })),
        };
      }),
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, value: unknown, type = "application/json") => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
      res.end(typeof value === "string" ? value : JSON.stringify(value));
    };
    try {
      const config = this.read();
      const from = req.socket.remoteAddress ?? "";
      const now = Date.now();
      const strikes = this.wrong.get(from);
      if (strikes && now - strikes.since > WRONG_WINDOW_MS) this.wrong.delete(from);
      if ((this.wrong.get(from)?.count ?? 0) >= WRONG_LIMIT) return send(429, { error: "Too many wrong keys. Try again later." });
      const match = /^\/m\/([^/]+)(\/[a-z]+)?$/.exec(new URL(req.url ?? "/", "http://x").pathname);
      if (!config?.enabled || !match || !same(match[1]!, config.token)) {
        const entry = this.wrong.get(from) ?? { count: 0, since: now };
        this.wrong.set(from, { count: entry.count + 1, since: entry.since });
        return send(404, { error: "Not found" });
      }
      const action = match[2] ?? "";
      if (req.method === "GET" && action === "") return send(200, PHONE_PAGE, "text/html; charset=utf-8");
      if (req.method === "GET" && action === "/state") return send(200, this.view());
      if (req.method !== "POST") return send(405, { error: "Method not allowed" });
      const input = await body(req);
      const text = (name: string) => (typeof input[name] === "string" ? (input[name] as string).trim() : "");
      if (action === "/answer" && text("id") && text("answer")) {
        this.core.answerQuestion(text("id"), text("answer").slice(0, 4000));
      } else if (action === "/decide" && text("id") && (input.decision === "approved" || input.decision === "rejected")) {
        await this.core.decideApproval(text("id"), input.decision);
      } else if (action === "/say" && text("bureau") && text("body")) {
        this.core.sendMessage(text("bureau"), { body: text("body").slice(0, 4000), toAgentId: null, taskId: null });
      } else {
        return send(400, { error: "Bad request" });
      }
      send(200, this.view());
    } catch (err) {
      send(400, { error: (err as Error).message });
    }
  }
}
