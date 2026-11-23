import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";
import type { z } from "zod";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_MEDIA_BYTES,
  AgentCommand,
  AnswerQuestionRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  DecideApprovalRequest,
  DecideLessonRequest,
  OpenWorkspaceRequest,
  PermissionRequest,
  SaveConnectorRequest,
  SavePageRequest,
  OpenTerminalRequest,
  SetPhoneRequest,
  SaveRoutineRequest,
  TreatRequest,
  SignInToolRequest,
  SetNotifyRequest,
  TerminalInput,
  SendMessageRequest,
  UpdateAgentRequest,
  UploadAttachmentRequest,
  UpdateWorkspaceRequest,
  type ApiError,
} from "@losperitos/protocol";
import { Core, CoreError } from "./core.js";

type Params = Record<string, string>;
type Handler = (params: Params, body: unknown, query: URLSearchParams) => unknown;

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
    "POST /workspaces": (_p, body) => {
      const request = parse(OpenWorkspaceRequest, body);
      return core.openWorkspace(request.path, request.kind, request.charter);
    },
    "PATCH /workspaces/:workspaceId": (p, body) =>
      core.updateWorkspace(p.workspaceId!, parse(UpdateWorkspaceRequest, body)),
    "GET /workspaces/:workspaceId/agents": (p) => core.listAgents(p.workspaceId!),
    "POST /agents/:agentId/stop": (p) => core.stopAgent(p.agentId!),
    "POST /agents/:agentId/treat": (p, body) => core.treatAgent(p.agentId!, parse(TreatRequest, body).kind),
    "PATCH /agents/:agentId": (p, body) => core.renameAgent(p.agentId!, parse(UpdateAgentRequest, body).nickname),
    "GET /workspaces/:workspaceId/tasks": (p) => core.listTasks(p.workspaceId!),
    "POST /workspaces/:workspaceId/tasks": (p, body) => core.createTask(p.workspaceId!, parse(CreateTaskRequest, body)),
    "PATCH /tasks/:taskId": (p, body) => core.updateTask(p.taskId!, parse(UpdateTaskRequest, body)),
    "GET /workspaces/:workspaceId/issues": (p) => core.listIssues(p.workspaceId!),
    "GET /tasks/:taskId": (p) => core.getTask(p.taskId!),
    "GET /tasks/:taskId/diff": async (p) => ({ diff: await core.taskDiff(p.taskId!) }),
    "GET /tasks/:taskId/file": (p, _body, query) => core.taskFile(p.taskId!, query.get("path") ?? ""),
    "GET /workspaces/:workspaceId/messages": (p) => core.listMessages(p.workspaceId!),
    "POST /workspaces/:workspaceId/messages": (p, body) =>
      core.sendMessage(p.workspaceId!, parse(SendMessageRequest, body)),
    "POST /workspaces/:workspaceId/attachments": (p, body) => {
      const upload = parse(UploadAttachmentRequest, body);
      return core.uploadAttachment(p.workspaceId!, upload.name, upload.data);
    },
    "POST /messages/:messageId/answer": (p, body) => {
      const request = parse(AnswerQuestionRequest, body);
      return core.answerQuestion(p.messageId!, request.answer, request.remember);
    },
    "GET /workspaces/:workspaceId/approvals": (p) => core.listApprovals(p.workspaceId!),
    "POST /approvals/:approvalId/decision": (p, body) =>
      {
        const request = parse(DecideApprovalRequest, body);
        return core.decideApproval(p.approvalId!, request.decision, request.remember);
      },
    "GET /workspaces/:workspaceId/lessons": (p) => core.listLessons(p.workspaceId!),
    "POST /lessons/:lessonId/decision": (p, body) =>
      core.decideLesson(p.lessonId!, parse(DecideLessonRequest, body).decision),
    "GET /workspaces/:workspaceId/budget": (p) => core.budget(p.workspaceId!),
    "GET /workspaces/:workspaceId/estimate": (p) => core.estimate(p.workspaceId!),
    "GET /workspaces/:workspaceId/runs": (p) => core.listRuns(p.workspaceId!),
    "GET /waiting": () => core.waiting(),
    "GET /workspaces/:workspaceId/repo": (p, _body, query) => core.repo(p.workspaceId!, query.get("repo")),
    "GET /workspaces/:workspaceId/repo/files": (p, _body, query) => core.repoFiles(p.workspaceId!, query.get("repo")),
    "GET /workspaces/:workspaceId/repo/file": (p, _body, query) =>
      core.repoFile(p.workspaceId!, query.get("path") ?? "", query.get("repo")),
    "GET /workspaces/:workspaceId/repo/search": (p, _body, query) =>
      core.repoSearch(p.workspaceId!, query.get("q") ?? "", query.get("repo")),
    "GET /workspaces/:workspaceId/repo/diff": async (p, _body, query) => ({
      diff: await core.repoDiff(p.workspaceId!, query.get("commit"), query.get("repo")),
    }),
    "GET /workspaces/:workspaceId/pages": (p) => core.listPages(p.workspaceId!),
    "POST /workspaces/:workspaceId/pages": (p, body) => core.savePage(p.workspaceId!, parse(SavePageRequest, body)),
    "POST /pages/:pageId/remove": (p) => core.removePage(p.pageId!),
    "GET /workspaces/:workspaceId/docs": (p) => core.listDocs(p.workspaceId!),
    "GET /notify": () => core.notifier.settings(),
    "POST /notify": (_p, body) => {
      try {
        return core.notifier.set(parse(SetNotifyRequest, body));
      } catch (err) {
        throw err instanceof CoreError ? err : new CoreError("bad_request", (err as Error).message);
      }
    },
    "POST /notify/test": async () => ({ sent: await core.notifier.nudge("test") }),
    "POST /coordinator": (_p, body) => {
      const name = (body as { name?: unknown } | undefined)?.name;
      return core.openCoordinator(typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : undefined);
    },
    "GET /workspaces/:workspaceId/routines": (p) => core.listRoutines(p.workspaceId!),
    "POST /workspaces/:workspaceId/routines": (p, body) => core.saveRoutine(p.workspaceId!, parse(SaveRoutineRequest, body)),
    "POST /routines/:routineId/remove": (p) => core.removeRoutine(p.routineId!),
    "POST /routines/:routineId/run": (p) => core.runRoutine(p.routineId!),
    "GET /workspaces/:workspaceId/folder": (p) => core.listFolder(p.workspaceId!),
    "GET /messages/:messageId/pictures": (p) => core.messagePictures(p.messageId!),
    "POST /setup/sign-in": (_p, body) => core.signInTool(parse(SignInToolRequest, body).tool),
    "GET /phone": () => core.phone.status(),
    "POST /phone": (_p, body) => {
      const request = parse(SetPhoneRequest, body);
      return core.phone.set(request.enabled, request.renew);
    },
    "GET /workspaces/:workspaceId/terminals": (p) => core.listTerminals(p.workspaceId!),
    "POST /workspaces/:workspaceId/terminals": (p, body) => core.openTerminal(p.workspaceId!, parse(OpenTerminalRequest, body ?? {})),
    "POST /terminals/:terminalId/close": (p) => core.closeTerminal(p.terminalId!),
    "GET /workspaces/:workspaceId/connectors": (p) => core.listConnectors(p.workspaceId!),
    "POST /workspaces/:workspaceId/connectors": (p, body) =>
      core.saveConnector(p.workspaceId!, parse(SaveConnectorRequest, body)),
    "POST /workspaces/:workspaceId/connectors/:connectorId/signin": (p) =>
      core.beginConnectorSignIn(p.workspaceId!, p.connectorId!),
    "GET /workspaces/:workspaceId/connectors/:connectorId/tools": (p) =>
      core.connectorTools(p.workspaceId!, p.connectorId!),
    "POST /workspaces/:workspaceId/connectors/:connectorId/remove": (p) =>
      core.removeConnector(p.workspaceId!, p.connectorId!),
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

async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new CoreError("bad_request", "Body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CoreError("bad_request", "Body is not valid JSON");
  }
}

/** Headers of an MCP call that travel through the relay, each way. */
const RELAYED_IN = ["content-type", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const RELAYED_OUT = ["content-type", "mcp-session-id", "cache-control", "www-authenticate"];

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
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (req.method === "POST" && path === "/agent/permission") {
        // Stays open for as long as the user takes to decide.
        req.socket.setTimeout(0);
        const request = parse(PermissionRequest, await readBody(req));
        send(200, { decision: await core.requestPermission(bearer ?? "", request.tool, request.input) });
        return;
      }
      if (req.method === "POST" && path === "/agent/hook") {
        // A hook of the agent's tool shows a call before it runs; the answer may wait for the user.
        req.socket.setTimeout(0);
        const request = parse(PermissionRequest, await readBody(req));
        send(200, { decision: await core.screenToolCall(bearer ?? "", request.tool, request.input) });
        return;
      }
      if (req.method === "POST" && path === "/agent") {
        // Agents authenticate with their own token, not the user's.
        const command = parse(AgentCommand, await readBody(req));
        send(200, await core.agentCommand(bearer ?? "", command));
        return;
      }
      const relay = /^\/relay\/([^/]+)$/.exec(path);
      if (relay) {
        // An agent's call to a signed-in connector: passed on with the provider's current token, the answer streamed back.
        const target = core.relayTarget(bearer ?? "", relay[1]!);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const passed = Object.fromEntries(
          RELAYED_IN.flatMap((name) => (typeof req.headers[name] === "string" ? [[name, req.headers[name] as string]] : [])),
        );
        const gone = new AbortController();
        res.on("close", () => gone.abort());
        req.socket.setTimeout(0);
        let answer: Response;
        try {
          answer = await fetch(target.url, {
            method: req.method,
            headers: { ...passed, ...target.headers },
            body: req.method === "GET" || req.method === "DELETE" ? undefined : Buffer.concat(chunks),
            signal: gone.signal,
          });
        } catch (err) {
          if (gone.signal.aborted) return;
          throw new CoreError("bad_request", `The connector did not answer: ${(err as Error).message}`);
        }
        res.writeHead(answer.status, Object.fromEntries(RELAYED_OUT.flatMap((name) => (answer.headers.get(name) ? [[name, answer.headers.get(name)!]] : []))));
        if (!answer.body) return void res.end();
        Readable.fromWeb(answer.body as import("node:stream/web").ReadableStream).on("error", () => res.destroy()).pipe(res);
        return;
      }
      if (req.method === "GET" && path === "/oauth/callback") {
        // The browser arrives here from the provider, without the user's token; the one-time state stands in for it.
        const page = (title: string, body: string) => {
          const safe = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!doctype html><meta charset="utf-8"><title>LosPeritos</title><body style="font:16px system-ui;margin:15vh auto;max-width:28rem;padding:0 1rem"><h1 style="font-size:1.3rem">${safe(title)}</h1><p>${safe(body)}</p>`);
        };
        const failure = url.searchParams.get("error_description") ?? url.searchParams.get("error");
        if (failure) return page("Sign-in did not go through", failure);
        try {
          const name = await core.finishConnectorSignIn(url.searchParams.get("state") ?? "", url.searchParams.get("code") ?? "");
          page(`Signed in to ${name}`, "You can close this tab and go back to LosPeritos.");
        } catch (err) {
          page("Sign-in did not go through", (err as Error).message);
        }
        return;
      }
      if (!tokenMatches(bearer, token)) throw new CoreError("unauthorized", "Missing or wrong token");
      const attached = req.method === "GET" && /^\/workspaces\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
      if (attached) {
        const file = core.attachmentAt(attached[1]!, decodeURIComponent(attached[2]!));
        // An attachment is shown, never run: a page or a script among them is sent as plain bytes to save.
        const type = /^(image\/(png|jpeg|gif|webp|avif)|video\/|audio\/|application\/pdf|text\/plain)/.test(file.mime) ? file.mime : "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Content-Length": file.size, "X-Content-Type-Options": "nosniff", ...cors });
        createReadStream(file.full).on("error", () => res.destroy()).pipe(res);
        return;
      }
      const inFolder = req.method === "GET" && /^\/workspaces\/([^/]+)\/folder\/raw$/.exec(path);
      if (inFolder) {
        const file = core.folderFileAt(inFolder[1]!, url.searchParams.get("path") ?? "");
        if (file.size > MAX_MEDIA_BYTES) throw new CoreError("bad_request", "File is too large to show");
        // Shown, never run: a page or a script from the folder is sent as plain bytes.
        const type = /^(image\/(png|jpeg|gif|webp|avif)|video\/|audio\/|application\/pdf|text\/(plain|markdown|csv))/.test(file.mime) ? file.mime : "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Content-Length": file.size, "X-Content-Type-Options": "nosniff", ...cors });
        createReadStream(file.full).on("error", () => res.destroy()).pipe(res);
        return;
      }
      const raw = req.method === "GET" && /^\/tasks\/([^/]+)\/raw$/.exec(path);
      if (raw) {
        const file = core.taskFileAt(raw[1]!, url.searchParams.get("path") ?? "");
        if (file.size > MAX_MEDIA_BYTES) throw new CoreError("bad_request", "File is too large to preview");
        res.writeHead(200, { "Content-Type": file.mime, "Content-Length": file.size, ...cors });
        createReadStream(file.full).on("error", () => res.destroy()).pipe(res);
        return;
      }
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = route.pattern.exec(path);
        if (!match) continue;
        // Attachments arrive base64-encoded, so the body is a third larger than the file.
        const limit = path.endsWith("/attachments") ? MAX_ATTACHMENT_BYTES * 1.4 : undefined;
        const body = req.method === "GET" ? undefined : await readBody(req, limit);
        send(200, await route.handler(match.groups ?? {}, body, url.searchParams));
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
    const terminal = /^\/terminals\/([^/]+)\/socket$/.exec(url.pathname);
    if ((url.pathname !== "/events" && !terminal) || !tokenMatches(url.searchParams.get("token"), token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    if (terminal) {
      sockets.handleUpgrade(req, socket, head, (ws) => {
        const detach = core.terminals.attach(terminal[1]!, (message) => ws.send(JSON.stringify(message)));
        if (!detach) return ws.close(4404, "No such terminal");
        ws.on("message", (raw) => {
          let message: z.infer<typeof TerminalInput>;
          try {
            message = TerminalInput.parse(JSON.parse(String(raw)));
          } catch {
            return;
          }
          if (message.type === "input") core.terminals.write(terminal[1]!, message.data);
          else core.terminals.resize(terminal[1]!, message.cols, message.rows);
        });
        ws.on("close", detach);
        ws.on("error", detach);
      });
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
