import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import type { z } from "zod";
import {
  AgentCommand,
  AnswerQuestionRequest,
  DecideApprovalRequest,
  DecideLessonRequest,
  OpenWorkspaceRequest,
  SendMessageRequest,
  UpdateWorkspaceRequest,
  type ApiError,
} from "@losperitos/protocol";
import { Core, CoreError } from "./core.js";

type Params = Record<string, string>;
type Handler = (params: Params, body: unknown) => unknown;

const STATUS: Record<ApiError["error"]["code"], number> = {
  unauthorized: 401,
  not_found: 404,
  bad_request: 400,
  budget_exhausted: 409,
  conflict: 409,
  internal: 500,
};

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new CoreError("bad_request", result.error.issues[0]?.message ?? "Invalid body");
  return result.data;
}

function buildRoutes(core: Core): Array<{ method: string; pattern: RegExp; handler: Handler }> {
  const table: Record<string, Handler> = {
    "GET /setup": () => core.setup(),
    "GET /workspaces": () => core.listWorkspaces(),
    "POST /workspaces": (_p, body) => core.openWorkspace(parse(OpenWorkspaceRequest, body).path),
    "PATCH /workspaces/:workspaceId": (p, body) =>
      core.updateWorkspace(p.workspaceId!, parse(UpdateWorkspaceRequest, body)),
    "GET /workspaces/:workspaceId/agents": (p) => core.listAgents(p.workspaceId!),
    "POST /agents/:agentId/stop": (p) => core.stopAgent(p.agentId!),
    "GET /workspaces/:workspaceId/tasks": (p) => core.listTasks(p.workspaceId!),
    "GET /tasks/:taskId": (p) => core.getTask(p.taskId!),
    "GET /tasks/:taskId/diff": async (p) => ({ diff: await core.taskDiff(p.taskId!) }),
    "GET /workspaces/:workspaceId/messages": (p) => core.listMessages(p.workspaceId!),
    "POST /workspaces/:workspaceId/messages": (p, body) =>
      core.sendMessage(p.workspaceId!, parse(SendMessageRequest, body)),
    "POST /messages/:messageId/answer": (p, body) =>
      core.answerQuestion(p.messageId!, parse(AnswerQuestionRequest, body).answer),
    "GET /workspaces/:workspaceId/approvals": (p) => core.listApprovals(p.workspaceId!),
    "POST /approvals/:approvalId/decision": (p, body) =>
      core.decideApproval(p.approvalId!, parse(DecideApprovalRequest, body).decision),
    "GET /workspaces/:workspaceId/lessons": (p) => core.listLessons(p.workspaceId!),
    "POST /lessons/:lessonId/decision": (p, body) =>
      core.decideLesson(p.lessonId!, parse(DecideLessonRequest, body).decision),
    "GET /workspaces/:workspaceId/budget": (p) => core.budget(p.workspaceId!),
    "GET /waiting": () => core.waiting(),
  };
  return Object.entries(table).map(([route, handler]) => {
    const [method, path] = route.split(" ") as [string, string];
    const pattern = new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    return { method, pattern, handler };
  });
}

function tokenMatches(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new CoreError("bad_request", "Body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CoreError("bad_request", "Body is not valid JSON");
  }
}

/**
 * HTTP + WebSocket front for a Core. Every request needs the bearer token;
 * the WebSocket takes it as `?token=` because browsers cannot set headers there.
 */
export function createServer(core: Core, token: string): Server {
  const routes = buildRoutes(core);
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  };

  const server = createHttpServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      const bearer = req.headers.authorization?.replace(/^Bearer /, "");
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "POST" && path === "/agent") {
        // Agents authenticate with their own token, not the user's.
        const command = parse(AgentCommand, await readBody(req));
        send(200, await core.agentCommand(bearer ?? "", command));
        return;
      }
      if (!tokenMatches(bearer, token)) throw new CoreError("unauthorized", "Missing or wrong token");
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = route.pattern.exec(path);
        if (!match) continue;
        const body = req.method === "GET" ? undefined : await readBody(req);
        send(200, await route.handler(match.groups ?? {}, body));
        return;
      }
      throw new CoreError("not_found", `No route ${req.method} ${path}`);
    } catch (err) {
      if (err instanceof CoreError) {
        send(STATUS[err.code], { error: { code: err.code, message: err.message } });
      } else {
        console.error(err);
        send(500, { error: { code: "internal", message: "Internal error" } });
      }
    }
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/events" || !tokenMatches(url.searchParams.get("token"), token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const unsubscribe = core.subscribe((envelope) => ws.send(JSON.stringify(envelope)));
      ws.on("close", unsubscribe);
      ws.on("error", unsubscribe);
    });
  });
  server.on("close", () => sockets.close());

  return server;
}
