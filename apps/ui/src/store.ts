import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  Agent,
  Approval,
  BudgetState,
  EventEnvelope,
  Issue,
  Lesson,
  Message,
  Run,
  Task,
  ToolCheck,
  Workspace,
  Estimate,
  TaskFile,
  ToolCall,
  ToolOutcome,
  WorkspaceKind,
  Connector,
  Page,
  RepoState,
  ConnectorTool,
  SaveConnectorRequest,
} from "@losperitos/protocol";

declare const __CORE_URL__: string;
declare const __CORE_TOKEN__: string;

/** What the desktop shell's preload script provides; absent in a plain browser. */
export interface Shell {
  coreUrl: string;
  token: string;
  platform: string;
  pickFolder(): Promise<string | null>;
  /** Present when the app can fetch a newer release and replace itself with it. */
  update?: {
    state(): Promise<SelfUpdate>;
    check(): Promise<void>;
    install(): Promise<void>;
    onState(listener: (state: SelfUpdate) => void): () => void;
  };
}
/** Where a self-update stands; `version` is known once it has been downloaded. */
export interface SelfUpdate {
  state: "idle" | "checking" | "downloading" | "ready" | "current" | "failed";
  version?: string;
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

/** "?a=1&b=2" from the values that are set. */
const query = (values: Record<string, string | null | undefined>) => {
  const set = Object.entries(values).filter((entry): entry is [string, string] => !!entry[1]);
  return set.length ? "?" + set.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&") : "";
};

/** What the user fills in to open a file themselves. */
export interface NewTask {
  title: string;
  description?: string;
  specialty?: string;
  effort?: Task["effort"];
  priority?: Task["priority"];
  dependsOn?: string[];
  labels?: string[];
  /** The subfolder repository it works in, where the folder holds several. */
  repo?: string;
  /** Queue it straight away; otherwise it is kept as a draft. */
  start?: boolean;
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
  /** The same output with tool calls kept whole, for the terminal view. */
  activity: Record<string, Activity[]>;
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
  activity: {},
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

export type ToolActivity = { kind: "tool"; result?: ToolOutcome } & ToolCall;
/** One entry of an agent's live output: a line it printed, or a tool it used. */
export type Activity = { kind: "line"; text: string } | ToolActivity;

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
          const before = state.activity[event.agentId] ?? [];
          const result = event.result;
          const activity: Activity[] = event.tool
            ? [...before, { kind: "tool", ...event.tool }]
            : result
              ? before.map((entry) => (entry.kind === "tool" && entry.id === result.id ? { ...entry, result } : entry))
              : [...before, ...event.chunk.split("\n").filter(Boolean).map((text): Activity => ({ kind: "line", text }))];
          return {
            ...state,
            output: { ...state.output, [event.agentId]: lines.slice(-MAX_OUTPUT_LINES) },
            activity: { ...state.activity, [event.agentId]: activity.slice(-MAX_OUTPUT_LINES) },
          };
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
  openWorkspace(path: string, kind?: WorkspaceKind): Promise<Workspace>;
  updateWorkspace(
    workspaceId: string,
    patch: Partial<Pick<Workspace, "dailyBudgetUsd" | "trustMode" | "kind" | "dispatchPaused">>,
  ): Promise<void>;
  createTask(workspaceId: string, task: NewTask): Promise<void>;
  updateTask(taskId: string, patch: Partial<NewTask> & { status?: "draft" | "queued" | "cancelled" }): Promise<void>;
  /** Open issues of the bureau's GitHub repository. */
  listIssues(workspaceId: string): Promise<Issue[]>;
  send(workspaceId: string, body: string, toAgentId?: string | null, attachments?: string[]): Promise<void>;
  /** Store a file for the next message; resolves to the name to attach. */
  upload(workspaceId: string, name: string, base64: string): Promise<string>;
  /** `remember` also files the answer as a standing lesson, so peritos stop asking. */
  answer(messageId: string, answer: string, remember?: boolean): Promise<void>;
  decideApproval(approvalId: string, decision: "approved" | "rejected", remember?: boolean): Promise<void>;
  decideLesson(lessonId: string, decision: "accepted" | "rejected"): Promise<void>;
  stopAgent(agentId: string): Promise<void>;
  /** Give a perito a name of your own; null goes back to the default. */
  renameAgent(agentId: string, nickname: string | null): Promise<void>;
  checkTools(): Promise<ToolCheck[]>;
  taskDiff(taskId: string): Promise<string>;
  /** What a new file is likely to cost, by effort. */
  estimate(workspaceId: string): Promise<Estimate>;
  taskFile(taskId: string, path: string): Promise<TaskFile>;
  /** The bytes of a video, sound or PDF a task handed in. */
  taskMedia(taskId: string, path: string): Promise<Blob>;
  /** `repo` names a subfolder repository where the folder holds several. */
  repo(workspaceId: string, repo?: string | null): Promise<RepoState>;
  /** The patch of one commit, or of the uncommitted changes when `commit` is null. */
  repoDiff(workspaceId: string, commit: string | null, repo?: string | null): Promise<string>;
  repoFiles(workspaceId: string, repo?: string | null): Promise<{ files: string[]; more: boolean }>;
  repoFile(workspaceId: string, path: string, repo?: string | null): Promise<TaskFile>;
  repoSearch(workspaceId: string, query: string, repo?: string | null): Promise<Array<{ path: string; line: number; text: string }>>;
  /** The bureau's notebook, newest first. */
  pages(workspaceId: string): Promise<Page[]>;
  /** Write a new page, or with `id` rewrite one. */
  savePage(workspaceId: string, page: { id?: string; title: string; body: string }): Promise<Page[]>;
  removePage(pageId: string): Promise<Page[]>;
  /** Markdown files of the project folder. */
  docs(workspaceId: string): Promise<string[]>;
  connectors(workspaceId: string): Promise<Connector[]>;
  connectorTools(workspaceId: string, connectorId: string): Promise<ConnectorTool[]>;
  /** The provider's page to open in the browser to sign in to a connector. */
  connectorSignIn(workspaceId: string, connectorId: string): Promise<string>;
  saveConnector(workspaceId: string, request: SaveConnectorRequest): Promise<Connector[]>;
  removeConnector(workspaceId: string, connectorId: string): Promise<Connector[]>;
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
    async openWorkspace(path, kind) {
      const workspace = await post<Workspace>("/workspaces", { path, kind });
      dispatch({ type: "workspace", data: await loadWorkspaces([workspace]) });
      return workspace;
    },
    updateWorkspace: async (workspaceId, patch) => void (await post(`/workspaces/${workspaceId}`, patch, "PATCH")),
    createTask: async (workspaceId, task) => void (await post(`/workspaces/${workspaceId}/tasks`, task)),
    updateTask: async (taskId, patch) => void (await post(`/tasks/${taskId}`, patch, "PATCH")),
    listIssues: (workspaceId) => post<Issue[]>(`/workspaces/${workspaceId}/issues`, undefined, "GET"),
    send: async (workspaceId, body, toAgentId = null, attachments = []) =>
      void (await post(`/workspaces/${workspaceId}/messages`, { body, toAgentId, attachments })),
    upload: async (workspaceId, name, data) =>
      (await post<{ name: string }>(`/workspaces/${workspaceId}/attachments`, { name, data })).name,
    answer: async (messageId, answer, remember = false) =>
      void (await post(`/messages/${messageId}/answer`, { answer, remember })),
    decideApproval: async (approvalId, decision, remember = false) =>
      void (await post(`/approvals/${approvalId}/decision`, { decision, remember })),
    decideLesson: async (lessonId, decision) => void (await post(`/lessons/${lessonId}/decision`, { decision })),
    stopAgent: async (agentId) => void (await post(`/agents/${agentId}/stop`)),
    renameAgent: async (agentId, nickname) => void (await post(`/agents/${agentId}`, { nickname }, "PATCH")),
    checkTools: () => post<ToolCheck[]>("/setup", undefined, "GET"),
    taskFile: (taskId, path) => post<TaskFile>(`/tasks/${taskId}/file?path=${encodeURIComponent(path)}`, undefined, "GET"),
    taskMedia: async (taskId, path) => {
      const response = await fetch(`${CORE_URL}/tasks/${taskId}/raw?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token.current}` },
      }).catch(() => {
        throw new ApiError("offline", "Cannot reach the local service.");
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new ApiError(json.error?.code ?? "internal", json.error?.message ?? "Request failed");
      }
      return response.blob();
    },
    repo: (workspaceId, repo) => post<RepoState>(`/workspaces/${workspaceId}/repo${query({ repo })}`, undefined, "GET"),
    repoDiff: async (workspaceId, commit, repo) =>
      (await post<{ diff: string }>(`/workspaces/${workspaceId}/repo/diff${query({ commit, repo })}`, undefined, "GET")).diff,
    repoFiles: (workspaceId, repo) => post(`/workspaces/${workspaceId}/repo/files${query({ repo })}`, undefined, "GET"),
    repoFile: (workspaceId, path, repo) => post<TaskFile>(`/workspaces/${workspaceId}/repo/file${query({ path, repo })}`, undefined, "GET"),
    repoSearch: async (workspaceId, words, repo) =>
      (await post<{ hits: Array<{ path: string; line: number; text: string }> }>(`/workspaces/${workspaceId}/repo/search${query({ q: words, repo })}`, undefined, "GET")).hits,
    pages: (workspaceId) => post<Page[]>(`/workspaces/${workspaceId}/pages`, undefined, "GET"),
    savePage: (workspaceId, page) => post<Page[]>(`/workspaces/${workspaceId}/pages`, page),
    removePage: (pageId) => post<Page[]>(`/pages/${pageId}/remove`, {}),
    docs: async (workspaceId) => (await post<{ files: string[] }>(`/workspaces/${workspaceId}/docs`, undefined, "GET")).files,
    connectors: (workspaceId) => post<Connector[]>(`/workspaces/${workspaceId}/connectors`, undefined, "GET"),
    connectorTools: async (workspaceId, connectorId) =>
      (await post<{ tools: ConnectorTool[] }>(`/workspaces/${workspaceId}/connectors/${connectorId}/tools`, undefined, "GET")).tools,
    connectorSignIn: async (workspaceId, connectorId) =>
      (await post<{ url: string }>(`/workspaces/${workspaceId}/connectors/${connectorId}/signin`, {})).url,
    saveConnector: (workspaceId, request) => post<Connector[]>(`/workspaces/${workspaceId}/connectors`, request),
    removeConnector: (workspaceId, connectorId) => post<Connector[]>(`/workspaces/${workspaceId}/connectors/${connectorId}/remove`, {}),
    estimate: (workspaceId) => post<Estimate>(`/workspaces/${workspaceId}/estimate`, undefined, "GET"),
    taskDiff: async (taskId) => (await post<{ diff: string }>(`/tasks/${taskId}/diff`, undefined, "GET")).diff,
    flightDone: (id) => dispatch({ type: "flight_done", id }),
    stampDone: (id) => dispatch({ type: "stamp_done", id }),
  };
  return [state, actions];
}
