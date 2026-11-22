/**
 * The contract between the core daemon and any UI.
 * Names here are neutral (lead, agent, task, approval); themed wording
 * ("Perito", "Dosya", "Mühür") lives only in the UI.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const MAX_AGENTS_PER_WORKSPACE = 8;

const id = z.string().min(1);
const timestamp = z.string().datetime();

// ── Workspace ───────────────────────────────────────────────────────────────

export const TrustMode = z.enum(["full", "restricted"]);

export const Workspace = z.object({
  id,
  name: z.string(),
  path: z.string(),
  repos: z.array(z.object({ path: z.string(), branch: z.string() })),
  trustMode: TrustMode,
  /** Daily budget in USD; null means no limit. */
  dailyBudgetUsd: z.number().nonnegative().nullable(),
  createdAt: timestamp,
});

// ── Agent ───────────────────────────────────────────────────────────────────

export const AgentRole = z.enum(["lead", "member"]);
export const AgentAdapter = z.enum(["claude-code", "codex", "fake"]);
export const AgentStatus = z.enum([
  "idle",
  "working",
  "asking",
  "awaiting_approval",
  "error",
  "stopped",
]);

export const Agent = z.object({
  id,
  workspaceId: id,
  name: z.string(),
  /** A name the user gave this agent; shown instead of its speciality and seat number. */
  nickname: z.string().nullable().optional(),
  role: AgentRole,
  /** Free-form specialty, e.g. "architect", "tester". */
  specialty: z.string().nullable(),
  adapter: AgentAdapter,
  status: AgentStatus,
  taskId: id.nullable(),
  lastOutput: z.string().nullable(),
  error: z.string().nullable(),
});

// ── Task ────────────────────────────────────────────────────────────────────

export const TaskStatus = z.enum([
  "draft",
  "queued",
  "in_progress",
  "in_review",
  "awaiting_approval",
  "done",
  "cancelled",
]);

export const TaskReport = z.object({
  done: z.array(z.string()),
  tested: z.array(z.string()),
  notVerified: z.array(z.string()),
});

export const Task = z.object({
  id,
  workspaceId: id,
  /** Short human-readable number, unique within the workspace. */
  number: z.number().int().positive(),
  parentId: id.nullable(),
  title: z.string(),
  description: z.string(),
  status: TaskStatus,
  assigneeId: id.nullable(),
  /** What kind of team member should take it, e.g. "tester". */
  specialty: z.string().nullable(),
  branch: z.string().nullable(),
  /** Branch the task branch forked from and merges back into. */
  baseBranch: z.string().nullable(),
  /** Absolute path of the task's git worktree; null when it works in the folder itself. */
  worktree: z.string().nullable(),
  report: TaskReport.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

// ── Message ─────────────────────────────────────────────────────────────────

export const MessageAuthor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("agent"), agentId: id }),
  z.object({ kind: z.literal("system") }),
]);

export const Message = z.object({
  id,
  workspaceId: id,
  author: MessageAuthor,
  /** Agent the message is addressed to; null means the whole team. */
  toAgentId: id.nullable(),
  taskId: id.nullable(),
  body: z.string(),
  /** Present when an agent asks the user a question. */
  question: z
    .object({
      options: z.array(z.string()),
      answer: z.string().nullable(),
    })
    .nullable(),
  /** Files the user attached, as names inside the workspace's attachments folder. */
  attachments: z.array(z.string()).optional(),
  createdAt: timestamp,
});

// ── Approval ────────────────────────────────────────────────────────────────

export const ApprovalKind = z.enum(["merge", "deploy", "command", "other"]);
export const ApprovalStatus = z.enum(["pending", "approved", "rejected"]);

export const Approval = z.object({
  id,
  workspaceId: id,
  agentId: id,
  taskId: id.nullable(),
  kind: ApprovalKind,
  title: z.string(),
  detail: z.string(),
  steps: z.array(z.string()),
  reversible: z.boolean(),
  status: ApprovalStatus,
  createdAt: timestamp,
  decidedAt: timestamp.nullable(),
});

// ── Lesson ──────────────────────────────────────────────────────────────────

export const LessonStatus = z.enum(["proposed", "accepted", "rejected"]);

export const Lesson = z.object({
  id,
  workspaceId: id,
  proposedByAgentId: id.nullable(),
  text: z.string(),
  status: LessonStatus,
  createdAt: timestamp,
});

// ── Run & budget ────────────────────────────────────────────────────────────

export const Run = z.object({
  id,
  workspaceId: id,
  agentId: id,
  taskId: id.nullable(),
  startedAt: timestamp,
  endedAt: timestamp.nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Estimate at API list prices, not an invoice. */
  costUsd: z.number().nonnegative(),
});

export const BudgetState = z.object({
  workspaceId: id,
  date: z.string().date(),
  limitUsd: z.number().nonnegative().nullable(),
  spentUsd: z.number().nonnegative(),
  /** ok < 80% ≤ warning < 100% ≤ exhausted */
  level: z.enum(["ok", "warning", "exhausted"]),
});

// ── Setup ───────────────────────────────────────────────────────────────────

export const ToolCheck = z.object({
  tool: z.enum(["git", "claude", "codex"]),
  required: z.boolean(),
  found: z.boolean(),
  version: z.string().nullable(),
  installHint: z.string().nullable(),
});

// ── Requests ────────────────────────────────────────────────────────────────

export const OpenWorkspaceRequest = z.object({ path: z.string() });
export const UpdateWorkspaceRequest = Workspace.pick({
  name: true,
  trustMode: true,
  dailyBudgetUsd: true,
}).partial();
/** Give the lead a job, or message a specific agent. */
export const SendMessageRequest = z.object({
  body: z.string().min(1),
  toAgentId: id.nullable().default(null),
  taskId: id.nullable().default(null),
  /** Names returned by earlier attachment uploads. */
  attachments: z.array(z.string()).default([]),
});
/** One file for the user to attach to a message; the reply is `{ name }`. */
export const UploadAttachmentRequest = z.object({
  name: z.string().min(1).max(200),
  /** The file's bytes, base64-encoded. */
  data: z.string().min(1),
});
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const UpdateAgentRequest = z.object({
  /** Empty or null removes the nickname. */
  nickname: z.string().trim().max(24).nullable(),
});
export const AnswerQuestionRequest = z.object({ answer: z.string().min(1) });
export const DecideApprovalRequest = z.object({
  decision: z.enum(["approved", "rejected"]),
});
export const DecideLessonRequest = z.object({
  decision: z.enum(["accepted", "rejected"]),
});

/**
 * REST routes served by the core on 127.0.0.1. Every request carries
 * `Authorization: Bearer <token>`.
 */
export const routes = {
  setup: "GET /setup",
  workspaces: "GET /workspaces",
  openWorkspace: "POST /workspaces",
  updateWorkspace: "PATCH /workspaces/:workspaceId",
  agents: "GET /workspaces/:workspaceId/agents",
  stopAgent: "POST /agents/:agentId/stop",
  updateAgent: "PATCH /agents/:agentId",
  tasks: "GET /workspaces/:workspaceId/tasks",
  task: "GET /tasks/:taskId",
  /** `{ diff: string }`: the task branch against the branch it started from. */
  taskDiff: "GET /tasks/:taskId/diff",
  messages: "GET /workspaces/:workspaceId/messages",
  sendMessage: "POST /workspaces/:workspaceId/messages",
  /** Store a file so the next message can attach it. */
  uploadAttachment: "POST /workspaces/:workspaceId/attachments",
  answerQuestion: "POST /messages/:messageId/answer",
  approvals: "GET /workspaces/:workspaceId/approvals",
  decideApproval: "POST /approvals/:approvalId/decision",
  lessons: "GET /workspaces/:workspaceId/lessons",
  decideLesson: "POST /lessons/:lessonId/decision",
  budget: "GET /workspaces/:workspaceId/budget",
  /** Today's finished agent turns, for per-agent spend. */
  runs: "GET /workspaces/:workspaceId/runs",
  /** Everything waiting on the user, across all workspaces. */
  waiting: "GET /waiting",
  events: "WS /events",
  /** Agent bridge, used by the `peritos` CLI with a per-agent token. */
  agentCommand: "POST /agent",
} as const;

export const ApiError = z.object({
  error: z.object({
    code: z.enum([
      "unauthorized",
      "not_found",
      "bad_request",
      "budget_exhausted",
      "conflict",
      "internal",
    ]),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const Waiting = z.object({
  approvals: z.array(Approval),
  questions: z.array(Message),
});

// ── Agent bridge ────────────────────────────────────────────────────────────

/**
 * What an agent can ask the core to do, through the `peritos` CLI.
 * The core knows which agent is calling from its token.
 */
export const AgentCommand = z.discriminatedUnion("command", [
  /** Lead only: open a task and hand it to a team member with this specialty. */
  z.object({
    command: z.literal("task.create"),
    title: z.string().min(1),
    description: z.string().default(""),
    specialty: z.string().min(1).default("developer"),
  }),
  z.object({ command: z.literal("task.list") }),
  /** Member only: hand the task in for review and merge. */
  z.object({ command: z.literal("task.done"), report: TaskReport }),
  /** `to` is an agent name, "lead" or "user". */
  z.object({ command: z.literal("send"), to: z.string().min(1), body: z.string().min(1) }),
  z.object({
    command: z.literal("ask"),
    body: z.string().min(1),
    options: z.array(z.string()).default([]),
  }),
  z.object({
    command: z.literal("approval"),
    kind: ApprovalKind.exclude(["merge"]).default("other"),
    title: z.string().min(1),
    detail: z.string().default(""),
    steps: z.array(z.string()).default([]),
    reversible: z.boolean().default(true),
  }),
  z.object({ command: z.literal("lesson"), text: z.string().min(1) }),
]);
export type AgentCommand = z.infer<typeof AgentCommand>;
/** What the CLI sends: defaults not yet applied. */
export type AgentCommandInput = z.input<typeof AgentCommand>;

/** Every agent command answers with a line of text for the agent to read. */
export const AgentCommandResult = z.object({ message: z.string() });
export type AgentCommandResult = z.infer<typeof AgentCommandResult>;

// ── Events (WebSocket) ──────────────────────────────────────────────────────

export const Event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workspace.updated"), workspace: Workspace }),
  z.object({ type: z.literal("agent.updated"), agent: Agent }),
  z.object({
    type: z.literal("agent.output"),
    agentId: id,
    stream: z.enum(["stdout", "stderr"]),
    chunk: z.string(),
  }),
  z.object({ type: z.literal("task.updated"), task: Task }),
  z.object({ type: z.literal("message.created"), message: Message }),
  z.object({ type: z.literal("message.updated"), message: Message }),
  z.object({ type: z.literal("approval.requested"), approval: Approval }),
  z.object({ type: z.literal("approval.decided"), approval: Approval }),
  z.object({ type: z.literal("lesson.updated"), lesson: Lesson }),
  z.object({ type: z.literal("budget.updated"), budget: BudgetState }),
]);

/** Envelope for every WebSocket frame; `seq` lets a client detect gaps. */
export const EventEnvelope = z.object({
  v: z.literal(PROTOCOL_VERSION),
  seq: z.number().int().nonnegative(),
  at: timestamp,
  event: Event,
});

// ── Types ───────────────────────────────────────────────────────────────────

export type TrustMode = z.infer<typeof TrustMode>;
export type Workspace = z.infer<typeof Workspace>;
export type AgentRole = z.infer<typeof AgentRole>;
export type AgentAdapter = z.infer<typeof AgentAdapter>;
export type AgentStatus = z.infer<typeof AgentStatus>;
export type Agent = z.infer<typeof Agent>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type TaskReport = z.infer<typeof TaskReport>;
export type Task = z.infer<typeof Task>;
export type MessageAuthor = z.infer<typeof MessageAuthor>;
export type Message = z.infer<typeof Message>;
export type ApprovalKind = z.infer<typeof ApprovalKind>;
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;
export type Approval = z.infer<typeof Approval>;
export type LessonStatus = z.infer<typeof LessonStatus>;
export type Lesson = z.infer<typeof Lesson>;
export type Run = z.infer<typeof Run>;
export type BudgetState = z.infer<typeof BudgetState>;
export type ToolCheck = z.infer<typeof ToolCheck>;
export type Waiting = z.infer<typeof Waiting>;
export type Event = z.infer<typeof Event>;
export type EventEnvelope = z.infer<typeof EventEnvelope>;
