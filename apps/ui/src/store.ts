import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  Agent,
  Approval,
  BudgetState,
  EventEnvelope,
  Lesson,
  Message,
  Run,
  Task,
  ToolCheck,
  Workspace,
} from "@losperitos/protocol";

declare const __CORE_URL__: string;
declare const __CORE_TOKEN__: string;

/** What the desktop shell's preload script provides; absent in a plain browser. */
export interface Shell {
  coreUrl: string;
  token: string;
  platform: string;
  pickFolder(): Promise<string | null>;
}
declare global {
  interface Window {
    losperitos?: Shell;
  }
}
export const shell: Shell | undefined = window.losperitos;

export const CORE_URL = shell?.coreUrl || __CORE_URL__;
const TOKEN_KEY = "losperitos.token";

function readToken(): string {
  if (shell?.token) return shell.token;
  if (__CORE_TOKEN__) return __CORE_TOKEN__;
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(CORE_URL + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("offline", "Cannot reach the local service.");
  }
  const json = await response.json();
  if (!response.ok) throw new ApiError(json.error?.code ?? "internal", json.error?.message ?? "Request failed");
  return json as T;
}

/** A note travelling across the floor: a message between two seats. */
export interface Flight {
  id: string;
  workspaceId: string;
  /** Agent id, or "user". */
  from: string;
  to: string;
}

/** The seal coming down on the floor, shown briefly after a decision. */
export interface FloorStamp {
  id: string;
  workspaceId: string;
  taskId: string | null;
  approved: boolean;
}

/** Everything the UI knows, across all bureaus. Screens filter by workspace. */
export interface State {
  phase: "connecting" | "needs_token" | "offline" | "ready";
  /** False until the first full load has landed. */
  loaded: boolean;
  workspaces: Workspace[];
  agents: Agent[];
  tasks: Task[];
  messages: Message[];
  approvals: Approval[];
  lessons: Lesson[];
  budgets: Record<string, BudgetState>;
  /** Today's finished turns per workspace. */
  runs: Record<string, Run[]>;
  /** Recent output lines per agent, since this window opened. */
  output: Record<string, string[]>;
  flights: Flight[];
  stamps: FloorStamp[];
}

const initial: State = {
  phase: "connecting",
  loaded: false,
  workspaces: [],
  agents: [],
  tasks: [],
  messages: [],
  approvals: [],
  lessons: [],
  budgets: {},
  runs: {},
  output: {},
  flights: [],
  stamps: [],
};

type Loaded = Pick<State, "workspaces" | "agents" | "tasks" | "messages" | "approvals" | "lessons" | "budgets" | "runs">;

type Action =
  | { type: "phase"; phase: State["phase"] }
  | { type: "loaded"; data: Loaded }
  | { type: "workspace"; data: Loaded }
  | { type: "runs"; workspaceId: string; runs: Run[] }
  | { type: "event"; envelope: EventEnvelope }
  | { type: "flight_done"; id: string }
  | { type: "stamp_done"; id: string };

const MAX_OUTPUT_LINES = 400;

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...list, item];
  const next = [...list];
  next[index] = item;
  return next;
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "phase":
      return { ...state, phase: action.phase };
    case "loaded":
      return { ...state, ...action.data, phase: "ready", loaded: true };
    case "workspace": {
      // Merge one freshly opened workspace into what is already known.
      const merge = <T extends { id: string }>(list: T[], more: T[]) => more.reduce(upsert, list);
      return {
        ...state,
        workspaces: merge(state.workspaces, action.data.workspaces),
        agents: merge(state.agents, action.data.agents),
        tasks: merge(state.tasks, action.data.tasks),
        messages: merge(state.messages, action.data.messages),
        approvals: merge(state.approvals, action.data.approvals),
        lessons: merge(state.lessons, action.data.lessons),
        budgets: { ...state.budgets, ...action.data.budgets },
        runs: { ...state.runs, ...action.data.runs },
      };
    }
    case "runs":
      return { ...state, runs: { ...state.runs, [action.workspaceId]: action.runs } };
    case "flight_done":
      return { ...state, flights: state.flights.filter((flight) => flight.id !== action.id) };
    case "stamp_done":
      return { ...state, stamps: state.stamps.filter((stamp) => stamp.id !== action.id) };
    case "event": {
      const { event, seq } = action.envelope;
      switch (event.type) {
        case "workspace.updated":
          return { ...state, workspaces: upsert(state.workspaces, event.workspace) };
        case "agent.updated":
          return { ...state, agents: upsert(state.agents, event.agent) };
        case "agent.output": {
          const lines = [...(state.output[event.agentId] ?? []), ...event.chunk.split("\n").filter(Boolean)];
          return { ...state, output: { ...state.output, [event.agentId]: lines.slice(-MAX_OUTPUT_LINES) } };
        }
        case "task.updated":
          return { ...state, tasks: upsert(state.tasks, event.task) };
        case "message.created": {
          const message = event.message;
          const from = message.author.kind === "agent" ? message.author.agentId : message.author.kind;
          // A note flies when a message has both a sender and a receiver seat.
          const to = message.toAgentId ?? (message.author.kind === "agent" ? "user" : null);
          const flights =
            from !== "system" && to && from !== to
              ? [...state.flights, { id: `f${seq}`, workspaceId: message.workspaceId, from, to }]
              : state.flights;
          return { ...state, messages: upsert(state.messages, message), flights };
        }
        case "message.updated":
          return { ...state, messages: upsert(state.messages, event.message) };
        case "approval.requested":
          return { ...state, approvals: upsert(state.approvals, event.approval) };
        case "approval.decided":
          return {
            ...state,
            approvals: upsert(state.approvals, event.approval),
            stamps: [
              ...state.stamps,
              {
                id: `s${seq}`,
                workspaceId: event.approval.workspaceId,
                taskId: event.approval.taskId,
                approved: event.approval.status === "approved",
              },
            ],
          };
        case "lesson.updated":
          return { ...state, lessons: upsert(state.lessons, event.lesson) };
        case "budget.updated":
          return { ...state, budgets: { ...state.budgets, [event.budget.workspaceId]: event.budget } };
      }
    }
  }
}

export interface Actions {
  setToken(token: string): void;
  reconnect(): void;
  openWorkspace(path: string): Promise<Workspace>;
  updateWorkspace(
    workspaceId: string,
    patch: Partial<Pick<Workspace, "dailyBudgetUsd" | "trustMode">>,
  ): Promise<void>;
  send(workspaceId: string, body: string, toAgentId?: string | null, attachments?: string[]): Promise<void>;
  /** Store a file for the next message; resolves to the name to attach. */
  upload(workspaceId: string, name: string, base64: string): Promise<string>;
  answer(messageId: string, answer: string): Promise<void>;
  decideApproval(approvalId: string, decision: "approved" | "rejected"): Promise<void>;
  decideLesson(lessonId: string, decision: "accepted" | "rejected"): Promise<void>;
  stopAgent(agentId: string): Promise<void>;
  /** Give a perito a name of your own; null goes back to the default. */
  renameAgent(agentId: string, nickname: string | null): Promise<void>;
  checkTools(): Promise<ToolCheck[]>;
  taskDiff(taskId: string): Promise<string>;
  flightDone(id: string): void;
  stampDone(id: string): void;
}

/** Live state of every bureau: loaded over HTTP, kept current over WebSocket. */
export function useCore(): [State, Actions] {
  const [state, dispatch] = useReducer(reduce, initial);
  const token = useRef(readToken());
  const reconnectNow = useRef<() => void>(() => undefined);

  const loadWorkspaces = useCallback(async (workspaces: Workspace[]): Promise<Loaded> => {
    const data: Loaded = {
      workspaces,
      agents: [],
      tasks: [],
      messages: [],
      approvals: [],
      lessons: [],
      budgets: {},
      runs: {},
    };
    await Promise.all(
      workspaces.map(async (workspace) => {
        const get = <T,>(path: string) => call<T>(token.current, "GET", `/workspaces/${workspace.id}/${path}`);
        const [agents, tasks, messages, approvals, lessons, budget, runs] = await Promise.all([
          get<Agent[]>("agents"),
          get<Task[]>("tasks"),
          get<Message[]>("messages"),
          get<Approval[]>("approvals"),
          get<Lesson[]>("lessons"),
          get<BudgetState>("budget"),
          get<Run[]>("runs"),
        ]);
        data.agents.push(...agents);
        data.tasks.push(...tasks);
        data.messages.push(...messages);
        data.approvals.push(...approvals);
        data.lessons.push(...lessons);
        data.budgets[workspace.id] = budget;
        data.runs[workspace.id] = runs;
      }),
    );
    return data;
  }, []);

  useEffect(() => {
    if (!token.current) {
      dispatch({ type: "phase", phase: "needs_token" });
      return;
    }
    let closed = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      clearTimeout(retry);
      try {
        const workspaces = await call<Workspace[]>(token.current, "GET", "/workspaces");
        const data = await loadWorkspaces(workspaces);
        if (closed) return;
        dispatch({ type: "loaded", data });
      } catch (err) {
        if (closed) return;
        const unauthorized = err instanceof ApiError && err.code === "unauthorized";
        dispatch({ type: "phase", phase: unauthorized ? "needs_token" : "offline" });
        if (!unauthorized) retry = setTimeout(connect, 2500);
        return;
      }
      socket = new WebSocket(`${CORE_URL.replace(/^http/, "ws")}/events?token=${encodeURIComponent(token.current)}`);
      socket.onmessage = (message) => {
        const envelope = JSON.parse(String(message.data)) as EventEnvelope;
        dispatch({ type: "event", envelope });
        // A budget change means a turn was just recorded.
        if (envelope.event.type === "budget.updated") {
          const workspaceId = envelope.event.budget.workspaceId;
          call<Run[]>(token.current, "GET", `/workspaces/${workspaceId}/runs`).then(
            (runs) => dispatch({ type: "runs", workspaceId, runs }),
            () => undefined,
          );
        }
      };
      socket.onclose = () => {
        if (closed) return;
        dispatch({ type: "phase", phase: "offline" });
        retry = setTimeout(connect, 2500);
      };
    };
    reconnectNow.current = () => {
      socket?.close();
      void connect();
    };
    void connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [state.phase === "needs_token", loadWorkspaces]);

  const post = useCallback(
    <T,>(path: string, body?: unknown, method = "POST") => call<T>(token.current, method, path, body),
    [],
  );

  const actions: Actions = {
    setToken(value) {
      token.current = value.trim();
      try {
        localStorage.setItem(TOKEN_KEY, token.current);
      } catch {
        // Private mode: the token just lasts for this page load.
      }
      dispatch({ type: "phase", phase: "connecting" });
    },
    reconnect: () => reconnectNow.current(),
    async openWorkspace(path) {
      const workspace = await post<Workspace>("/workspaces", { path });
      dispatch({ type: "workspace", data: await loadWorkspaces([workspace]) });
      return workspace;
    },
    updateWorkspace: async (workspaceId, patch) => void (await post(`/workspaces/${workspaceId}`, patch, "PATCH")),
    send: async (workspaceId, body, toAgentId = null, attachments = []) =>
      void (await post(`/workspaces/${workspaceId}/messages`, { body, toAgentId, attachments })),
    upload: async (workspaceId, name, data) =>
      (await post<{ name: string }>(`/workspaces/${workspaceId}/attachments`, { name, data })).name,
    answer: async (messageId, answer) => void (await post(`/messages/${messageId}/answer`, { answer })),
    decideApproval: async (approvalId, decision) =>
      void (await post(`/approvals/${approvalId}/decision`, { decision })),
    decideLesson: async (lessonId, decision) => void (await post(`/lessons/${lessonId}/decision`, { decision })),
    stopAgent: async (agentId) => void (await post(`/agents/${agentId}/stop`)),
    renameAgent: async (agentId, nickname) => void (await post(`/agents/${agentId}`, { nickname }, "PATCH")),
    checkTools: () => post<ToolCheck[]>("/setup", undefined, "GET"),
    taskDiff: async (taskId) => (await post<{ diff: string }>(`/tasks/${taskId}/diff`, undefined, "GET")).diff,
    flightDone: (id) => dispatch({ type: "flight_done", id }),
    stampDone: (id) => dispatch({ type: "stamp_done", id }),
  };
  return [state, actions];
}
