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
/** What the team in this workspace is for; decides its roles, its briefing and the UI's wording. */
export const WorkspaceKind = z.enum(["software", "marketing", "content"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKind>;

/**
 * What a bureau is for, in the user's own words: the job, who is on the team,
 * what handed-in work looks like, what has to hold before it is handed in, and
 * what always waits for the user. A bureau without one is one of the three
 * built-in kinds; with one, the team is told this instead.
 */
export const Charter = z.object({
  /** The ready-made type it started from ("research", "design", …) or "custom". */
  template: z.string().trim().min(1).max(40),
  /** What the bureau is called as a type: "Research bureau". */
  title: z.string().trim().min(2).max(80),
  /** The job: what this bureau does and for whom. */
  job: z.string().trim().min(30).max(4000),
  /** The roles on the team, as the lead will name them when handing out work. */
  specialties: z.array(z.string().trim().min(2).max(40)).min(1).max(12),
  /** What a piece of work looks like when it is handed in. */
  deliverable: z.string().trim().min(10).max(2000),
  /** What every teammate checks before handing in. */
  done: z.array(z.string().trim().min(3).max(300)).max(12).default([]),
  /** What nobody on the team does without asking the user first. */
  seal: z.array(z.string().trim().min(3).max(300)).max(12).default([]),
});
export type Charter = z.infer<typeof Charter>;

export const Workspace = z.object({
  id,
  name: z.string(),
  path: z.string(),
  repos: z.array(z.object({ path: z.string(), branch: z.string() })),
  trustMode: TrustMode,
  /** Absent on workspaces made before kinds existed: those are software. */
  kind: WorkspaceKind.optional(),
  /** Daily budget in USD; null means no limit. */
  dailyBudgetUsd: z.number().nonnegative().nullable(),
  /** While set, queued tasks are not handed out; work already started carries on. */
  dispatchPaused: z.boolean().optional(),
  /**
   * Tools of servers that come with the user's own account (not connectors of
   * this bureau) that may go ahead unasked, by their full name.
   */
  freeTools: z.array(z.string()).optional(),
  /** What the bureau is for, when it is not simply one of the built-in kinds. */
  charter: Charter.optional(),
  /**
   * How much the user leaves to the lead. "routine": the lead seals teammates'
   * work that can be undone, look-ups go ahead unasked, and the lead settles
   * small reversible choices itself. Anything that publishes, spends, deletes
   * or cannot be undone still waits for the user.
   */
  delegation: z.enum(["none", "routine"]).optional(),
  /** The language the user reads, as the app is set to ("tr", "en"): the team writes in it. */
  language: z.string().regex(/^[a-z]{2}$/).optional(),
  /** Set on the one bureau that does no work of its own: its lead hands jobs to the other bureaus. */
  coordinator: z.boolean().optional(),
  /** The agent tool this bureau's team runs on; Claude Code when absent. */
  agentTool: z.enum(["claude-code", "codex"]).optional(),
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
  /** The account's usage limit is spent; the agent resumes by itself when it resets. */
  "limited",
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
  /** The agent tool's own conversation id, so the conversation survives a restart. */
  sessionId: z.string().nullable().optional(),
  /** When a limited agent will try again. */
  resumeAt: timestamp.nullable().optional(),
  /** Coffees and doughnuts the user has brought to this perito's desk. */
  treats: z.object({ coffee: z.number().int().nonnegative(), donut: z.number().int().nonnegative() }).optional(),
  /** Set when the app closed while the agent was in the middle of a turn: it carries on at the next start. */
  interrupted: z.boolean().optional(),
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

/** How demanding a task is; decides which model the team member runs on. */
export const TaskEffort = z.enum(["small", "normal", "large"]);
export type TaskEffort = z.infer<typeof TaskEffort>;

export const TaskPriority = z.enum(["low", "normal", "high"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const TaskLabels = z.array(z.string().trim().toLowerCase().min(1).max(24)).max(8);

/** What a task of each effort is likely to cost, from this workspace's own closed tasks. */
export const Estimate = z.record(
  TaskEffort,
  z.object({
    usd: z.number().nonnegative(),
    /** Closed tasks the figure is the median of; 0 means it is a built-in guess. */
    tasks: z.number().int().nonnegative(),
  }),
);

export const TaskReport = z.object({
  done: z.array(z.string()),
  tested: z.array(z.string()),
  notVerified: z.array(z.string()),
  /** Files the task created or changed, relative to the workspace folder. */
  files: z.array(z.string()).optional(),
});

/** One file of a task, for previewing it in the UI. */
export const TaskFile = z.object({
  path: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  /** Base64. */
  data: z.string(),
});
export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
/** Video, sound and PDF are sent as they are rather than inside JSON, so they may be larger. */
export const MAX_MEDIA_BYTES = 256 * 1024 * 1024;

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
  effort: TaskEffort.optional(),
  priority: TaskPriority.optional(),
  /** Tasks that must be closed before this one is handed out. */
  dependsOn: z.array(id).optional(),
  /** Free-form tags for grouping and filtering, e.g. "launch", "blog". */
  labels: TaskLabels.optional(),
  branch: z.string().nullable(),
  /** Branch the task branch forked from and merges back into. */
  baseBranch: z.string().nullable(),
  /**
   * Absolute path of the folder the task works in: its git worktree, or with no
   * `branch` a draft folder whose files are copied in on approval. Null when it
   * works in the workspace folder itself.
   */
  worktree: z.string().nullable(),
  /**
   * In a folder that holds several repositories: the one this task works in,
   * by the name of its subfolder. Absent when the folder itself is the repository.
   */
  repo: z.string().optional(),
  report: TaskReport.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

// ── Message ─────────────────────────────────────────────────────────────────

export const MessageAuthor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("agent"), agentId: id }),
  z.object({ kind: z.literal("system") }),
  /** The lead of another bureau, handing work across. */
  z.object({ kind: z.literal("bureau"), workspaceId: id, name: z.string() }),
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
      /** The option the agent would pick itself, if it said so. */
      recommended: z.string().nullable().optional(),
      answer: z.string().nullable(),
    })
    .nullable(),
  /** Files that go with the message (the user's, or an agent's to show the user), as names inside the workspace's attachments folder. */
  attachments: z.array(z.string()).optional(),
  createdAt: timestamp,
});

// ── Approval ────────────────────────────────────────────────────────────────

/** `connector`: a call to an outside service that the user has not said may go ahead unasked. */
export const ApprovalKind = z.enum(["merge", "deploy", "command", "connector", "other"]);
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
  /** Waiting on the lead, to whom the user has left routine seals; the user can still decide it. */
  delegated: z.boolean().optional(),
  /** Who decided: absent means the user. */
  decidedBy: z.enum(["user", "lead"]).optional(),
  /** What the lead wrote with its decision, or why it passed the seal back to the user. */
  note: z.string().optional(),
  /** For a held tool call: what the agent wrote just before making it, as the nearest thing to its reason. */
  why: z.string().optional(),
  /** For a held tool call: the tool by its own name ("WebSearch", "Bash"), so the app can say what such a call does. */
  tool: z.string().optional(),
  /** The call only looks something up: it changes nothing, here or elsewhere. */
  reads: z.boolean().optional(),
  /** Closed because the agent that asked went away (the app closed, the task was stopped), not by the user's word. */
  lapsed: z.boolean().optional(),
  /** For a `connector` approval: which tool of which connector is being called. */
  call: z.object({ connectorId: z.string(), tool: z.string() }).optional(),
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

// ── Routine ─────────────────────────────────────────────────────────────────

/**
 * A job that comes round again: every day, every week on a weekday, or every
 * month on a day, at an hour. When it is due the lead is given its brief as
 * if the user had just written it. It runs while the app is open; one missed
 * while it was closed runs once when it opens.
 */
export const Routine = z.object({
  id,
  workspaceId: id,
  title: z.string(),
  /** What the lead is told to do each time. */
  brief: z.string(),
  every: z.enum(["day", "week", "month"]),
  /** For "week": 0 is Sunday. */
  weekday: z.number().int().min(0).max(6),
  /** For "month": 1 to 28, so that every month has it. */
  day: z.number().int().min(1).max(28),
  /** The hour of the day, by this machine's clock. */
  hour: z.number().int().min(0).max(23),
  enabled: z.boolean(),
  lastRunAt: timestamp.nullable(),
  nextRunAt: timestamp,
  createdAt: timestamp,
});
export const SaveRoutineRequest = z.object({
  id: id.optional(),
  title: z.string().trim().min(2).max(120),
  brief: z.string().trim().min(10).max(4000),
  every: z.enum(["day", "week", "month"]),
  weekday: z.number().int().min(0).max(6).default(1),
  day: z.number().int().min(1).max(28).default(1),
  hour: z.number().int().min(0).max(23).default(9),
  enabled: z.boolean().default(true),
});
export type Routine = z.infer<typeof Routine>;
export type SaveRoutineRequest = z.infer<typeof SaveRoutineRequest>;

// ── Page ────────────────────────────────────────────────────────────────────

/**
 * A page in the bureau's notebook: a plan, a decision, findings worth
 * keeping. Written by the team for the user to read; it is the bureau's own
 * and not a file of the project.
 */
export const Page = z.object({
  id,
  workspaceId: id,
  title: z.string(),
  /** Markdown. */
  body: z.string(),
  authorAgentId: id.nullable(),
  /** The task it was written for, if any. */
  taskId: id.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const MAX_PAGE_CHARS = 200_000;

// ── Terminal ────────────────────────────────────────────────────────────────

/** A shell the user opened in a bureau's folder. It lives in the core, not in the window. */
export const Terminal = z.object({
  id,
  workspaceId: id,
  title: z.string(),
  cwd: z.string(),
  alive: z.boolean(),
  exitCode: z.number().nullable(),
  createdAt: timestamp,
});
export const OpenTerminalRequest = z.object({
  /** Open it in this task's working folder rather than the bureau's. */
  taskId: id.optional(),
  cols: z.number().int().min(2).max(500).default(100),
  rows: z.number().int().min(1).max(300).default(30),
});
/** What travels over a terminal's socket, each way. */
export const TerminalInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), data: z.string().max(1_000_000) }),
  z.object({ type: z.literal("resize"), cols: z.number(), rows: z.number() }),
]);

// ── Phone ───────────────────────────────────────────────────────────────────

/** Whether the bureau can be reached from a phone on the same network, and at which addresses. */
export const PhoneAccess = z.object({
  enabled: z.boolean(),
  urls: z.array(z.string()),
  /** Whether the page is served encrypted, under the app's own certificate. */
  secure: z.boolean(),
  /** That certificate's SHA-256 fingerprint, to compare with what the phone shows. */
  fingerprint: z.string().nullable(),
});
export const SignInToolRequest = z.object({ tool: z.enum(["claude", "codex"]) });
export const TreatRequest = z.object({ kind: z.enum(["coffee", "donut"]) });
export const SetPhoneRequest = z.object({
  enabled: z.boolean(),
  /** Make a new key: every address handed out before stops working. */
  renew: z.boolean().optional(),
});

/** Nudges to the phone through an ntfy server. `topic` is what the phone subscribes to; null while off. */
export const NotifySettings = z.object({ enabled: z.boolean(), server: z.string(), topic: z.string().nullable() });
export const SetNotifyRequest = z.object({
  enabled: z.boolean(),
  server: z.string().max(200).optional(),
  /** Make a new topic: phones subscribed to the old one hear nothing more. */
  renew: z.boolean().optional(),
  lang: z.enum(["en", "tr"]).optional(),
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

/** The account's own allowance with the tool's maker, as far as the tool lets on. */
export const Allowance = z.object({
  status: z.enum(["ok", "warning", "spent"]),
  /** Which allowance this is about, in the tool's own word (`five_hour`, `seven_day`, …). */
  window: z.string().nullable(),
  /** The share already used, 0–1. Null when the tool gives no figure, which is most of the time. */
  used: z.number().min(0).max(1).nullable(),
  resetAt: timestamp.nullable(),
  /** When the tool last said so. */
  seenAt: timestamp,
});
export type Allowance = z.infer<typeof Allowance>;

export const BudgetState = z.object({
  workspaceId: id,
  date: z.string().date(),
  limitUsd: z.number().nonnegative().nullable(),
  spentUsd: z.number().nonnegative(),
  /** Tokens read and written today, cached ones included. */
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Null until the team's tool has said something about it. */
  allowance: Allowance.nullable(),
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
  /** Whether the tool says it is signed in, as this app would run it; absent when it cannot say. */
  signedIn: z.boolean().optional(),
});

// ── Requests ────────────────────────────────────────────────────────────────

// ── Repository ──────────────────────────────────────────────────────────────

/** Where a software bureau's repository stands, for the code panel. */
export const RepoState = z.object({
  branch: z.string(),
  /** Local branches; `ahead` counts commits the checked-out branch lacks. */
  branches: z.array(z.object({ name: z.string(), ahead: z.number().int().nonnegative(), taskId: id.nullable() })),
  commits: z.array(z.object({ hash: z.string(), subject: z.string(), author: z.string(), date: z.string() })),
  /** Files that differ from the last commit, with git's two-letter status. */
  changes: z.array(z.object({ path: z.string(), status: z.string() })),
});

// ── Connector ───────────────────────────────────────────────────────────────

/**
 * An outside service the team may use, reached over MCP. Its tools reach the
 * agents as `mcp__<id>__<tool>`. A call to a tool not listed in `free` waits
 * for the user's seal.
 */
export const Connector = z.object({
  /** Lower-case letters, digits and hyphens; `peritos` is the core's own. */
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).refine((value) => value !== "peritos", "That name is taken"),
  name: z.string().trim().min(1).max(60),
  /** A local program that speaks MCP over stdio. Either this or `url`. */
  command: z.string().trim().min(1).optional(),
  args: z.array(z.string()).default([]),
  /** A server reached over HTTP. */
  url: z.string().url().optional(),
  /**
   * Names of the secrets it has been given: environment variables for a
   * command, request headers for a URL. The values never leave the core.
   */
  secretNames: z.array(z.string()),
  /** For a URL that asks for a sign-in in the browser: whether the user has signed in and it still holds. */
  signedIn: z.boolean().default(false),
  /** Tools that may be called without asking. `*` stands for any run of characters. */
  free: z.array(z.string().trim().min(1)).default([]),
});

/** One tool of a connector, as its server describes it. `readOnly` is the server's own word, when it gives one. */
export const ConnectorTool = z.object({
  name: z.string(),
  description: z.string(),
  readOnly: z.boolean().nullable(),
});

/**
 * Add a connector, or replace the one with the same id. `secrets` sets the
 * named values and leaves the others as they are; an empty value removes one.
 */
export const SaveConnectorRequest = Connector.omit({ secretNames: true, signedIn: true })
  .extend({ secrets: z.record(z.string()).default({}) })
  .refine((value) => !!value.command !== !!value.url, "Give either a command or a URL");

/** `kind` applies only when the folder has not been opened before. */
export const OpenWorkspaceRequest = z.object({ path: z.string(), kind: WorkspaceKind.optional(), charter: Charter.optional() });
export const UpdateWorkspaceRequest = Workspace.pick({
  name: true,
  trustMode: true,
  kind: true,
  dailyBudgetUsd: true,
  dispatchPaused: true,
  agentTool: true,
  freeTools: true,
  language: true,
  delegation: true,
  charter: true,
}).partial();

/** A task the user writes themselves, rather than the lead. */
export const CreateTaskRequest = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().default(""),
  specialty: z.string().trim().min(1).default("developer"),
  effort: TaskEffort.default("normal"),
  priority: TaskPriority.default("normal"),
  dependsOn: z.array(id).default([]),
  labels: TaskLabels.default([]),
  /** The subfolder repository the task works in, where the folder holds several. */
  repo: z.string().optional(),
  /** Queue it for the team straight away; otherwise it is kept as a draft. */
  start: z.boolean().default(true),
});
/** Details can change until a task has been handed out; `status` queues, shelves or cancels it. */
export const UpdateTaskRequest = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().optional(),
  specialty: z.string().trim().min(1).optional(),
  effort: TaskEffort.optional(),
  priority: TaskPriority.optional(),
  dependsOn: z.array(id).optional(),
  labels: TaskLabels.optional(),
  status: z.enum(["draft", "queued", "cancelled"]).optional(),
});

/** An issue in the workspace's GitHub repository, offered for import. */
export const Issue = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  labels: z.array(z.string()),
});
export type Issue = z.infer<typeof Issue>;
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
export const AnswerQuestionRequest = z.object({
  answer: z.string().min(1),
  /** Keep the answer as a standing lesson, so agents stop asking. */
  remember: z.boolean().default(false),
});
export const DecideApprovalRequest = z.object({
  decision: z.enum(["approved", "rejected"]),
  /** With an approved connector call: let this tool go ahead unasked from now on. */
  remember: z.boolean().optional(),
});
/** The user writes or rewrites a page; with no `id` it is a new one. */
export const SavePageRequest = z.object({
  id: id.optional(),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(MAX_PAGE_CHARS),
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
  createTask: "POST /workspaces/:workspaceId/tasks",
  updateTask: "PATCH /tasks/:taskId",
  /** Open issues of the workspace's GitHub repository, read with the `gh` CLI. */
  issues: "GET /workspaces/:workspaceId/issues",
  task: "GET /tasks/:taskId",
  /** `{ diff: string }`: the task branch against the branch it started from. */
  taskDiff: "GET /tasks/:taskId/diff",
  /** `?path=<relative path>`: a TaskFile read from the task's worktree, or the folder once merged. */
  taskFile: "GET /tasks/:taskId/file",
  /** `?path=<relative path>`: the bytes of the same file, for video, sound and PDF. */
  taskRaw: "GET /tasks/:taskId/raw",
  messages: "GET /workspaces/:workspaceId/messages",
  sendMessage: "POST /workspaces/:workspaceId/messages",
  /** Store a file so the next message can attach it. */
  uploadAttachment: "POST /workspaces/:workspaceId/attachments",
  routines: "GET /workspaces/:workspaceId/routines",
  /** SaveRoutineRequest; answers with the bureau's routines. */
  saveRoutine: "POST /workspaces/:workspaceId/routines",
  removeRoutine: "POST /routines/:routineId/remove",
  /** Run it now, whatever its hour; answers with the routine. */
  runRoutine: "POST /routines/:routineId/run",
  /** `{ tool: "claude" | "codex" }`: open a terminal that runs the tool's own sign-in; a Terminal. */
  signInTool: "POST /setup/sign-in",
  /** `{ files: [{ path, size, modifiedAt }], more }`: everything in the bureau's folder, git or not. */
  folder: "GET /workspaces/:workspaceId/folder",
  /** `?path=`: the bytes of one file of the bureau's folder, for showing it. */
  folderRaw: "GET /workspaces/:workspaceId/folder/raw",
  /** `{ files }`: pictures of the bureau's folder that a message's text points at, by file or by folder. */
  messagePictures: "GET /messages/:messageId/pictures",
  /** `{ kind: "coffee" | "donut" }`: bring something to a perito's desk; an Agent. */
  treatAgent: "POST /agents/:agentId/treat",
  /** The bytes of one attachment, for showing it. */
  attachment: "GET /workspaces/:workspaceId/attachments/:name",
  answerQuestion: "POST /messages/:messageId/answer",
  approvals: "GET /workspaces/:workspaceId/approvals",
  decideApproval: "POST /approvals/:approvalId/decision",
  lessons: "GET /workspaces/:workspaceId/lessons",
  decideLesson: "POST /lessons/:lessonId/decision",
  budget: "GET /workspaces/:workspaceId/budget",
  /** An Estimate: the likely cost of a new task, by effort. */
  estimate: "GET /workspaces/:workspaceId/estimate",
  /** Today's finished agent turns, for per-agent spend. */
  runs: "GET /workspaces/:workspaceId/runs",
  /** Everything waiting on the user, across all workspaces. */
  waiting: "GET /waiting",
  /** A RepoState; 409 when the folder is not a git repository. */
  /** Every repo route takes `?repo=<subfolder>` where the folder holds several repositories. */
  repo: "GET /workspaces/:workspaceId/repo",
  /** `{ diff }`: `?commit=<hash>` for one commit, without it the uncommitted changes. */
  repoDiff: "GET /workspaces/:workspaceId/repo/diff",
  /** `{ files: string[], more: boolean }`: the repository's files, ignored ones left out. */
  repoFiles: "GET /workspaces/:workspaceId/repo/files",
  /** `?path=`: one file of the project as a TaskFile. */
  repoFile: "GET /workspaces/:workspaceId/repo/file",
  /** `?q=`: `{ hits: [{ path, line, text }] }`, lines of text files containing the words, any case. */
  repoSearch: "GET /workspaces/:workspaceId/repo/search",
  /** The bureau's notebook, newest first. */
  pages: "GET /workspaces/:workspaceId/pages",
  /** SavePageRequest; answers with the notebook. */
  savePage: "POST /workspaces/:workspaceId/pages",
  removePage: "POST /pages/:pageId/remove",
  /** `{ files: string[] }`: Markdown files of the project folder, to read beside the notebook. */
  docs: "GET /workspaces/:workspaceId/docs",
  /** `{ available, terminals }`: the shells open in this bureau. */
  terminals: "GET /workspaces/:workspaceId/terminals",
  openTerminal: "POST /workspaces/:workspaceId/terminals",
  closeTerminal: "POST /terminals/:terminalId/close",
  /** WebSocket, `?token=`: `{type:"data"|"exit"}` out, TerminalInput in. */
  terminalSocket: "GET /terminals/:terminalId/socket",
  notify: "GET /notify",
  setNotify: "POST /notify",
  /** Send one nudge now; `{ sent }`. */
  testNotify: "POST /notify/test",
  /** `{ name? }`: open the coordinator's bureau, or return it if it is open; a Workspace. */
  openCoordinator: "POST /coordinator",
  phone: "GET /phone",
  setPhone: "POST /phone",
  connectors: "GET /workspaces/:workspaceId/connectors",
  saveConnector: "POST /workspaces/:workspaceId/connectors",
  removeConnector: "POST /workspaces/:workspaceId/connectors/:connectorId/remove",
  /** `{ url }`: the page to open in the browser to sign in to a connector's server. */
  connectorSignIn: "POST /workspaces/:workspaceId/connectors/:connectorId/signin",
  /** Where the browser comes back after a sign-in. Not called by the UI; it carries no token, only the one-time state. */
  oauthCallback: "GET /oauth/callback",
  /** `{ tools: ConnectorTool[] }`, asked of the server itself; may take a while the first time. */
  connectorTools: "GET /workspaces/:workspaceId/connectors/:connectorId/tools",
  events: "WS /events",
  /** Agent bridge, used by the `peritos` CLI with a per-agent token. */
  agentCommand: "POST /agent",
  /** Held open until the user decides; answers with a PermissionResult. */
  agentPermission: "POST /agent/permission",
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
    effort: TaskEffort.default("normal"),
    priority: TaskPriority.default("normal"),
    /** Numbers of tasks that must be closed first. */
    after: z.array(z.number().int().positive()).default([]),
    labels: TaskLabels.default([]),
    /** The subfolder repository the task works in, where the folder holds several. */
    repo: z.string().optional(),
  }),
  z.object({ command: z.literal("task.list") }),
  /** Member only: hand the task in for review and merge. */
  z.object({ command: z.literal("task.done"), report: TaskReport }),
  /** `to` is an agent name, "lead" or "user". */
  /** `to` is a teammate, `lead`, `user`, or for a lead `bureau:<name>`: the lead of another bureau. */
  z.object({ command: z.literal("send"), to: z.string().min(1), body: z.string().min(1), files: z.array(z.string()).max(12).default([]) }),
  /** The lead's word on a seal the user has left to it: approve, send back, or pass it up to the user. */
  z.object({ command: z.literal("seal"), task: z.number().int().positive(), decision: z.enum(["approve", "reject", "escalate"]), reason: z.string().trim().min(1).max(2000) }),
  /** The user's other bureaus and what each is busy with. */
  z.object({ command: z.literal("bureaus") }),
  z.object({
    command: z.literal("ask"),
    body: z.string().min(1),
    options: z.array(z.string()).default([]),
    /** One of the options: the agent's own suggestion. */
    recommended: z.string().optional(),
    /** Files to show the user with the question (pictures to choose between, a draft to judge), as paths in the agent's folder. */
    files: z.array(z.string()).max(12).default([]),
  }),
  z.object({
    command: z.literal("approval"),
    kind: ApprovalKind.exclude(["merge", "connector"]).default("other"),
    title: z.string().min(1),
    detail: z.string().default(""),
    steps: z.array(z.string()).default([]),
    reversible: z.boolean().default(true),
  }),
  z.object({ command: z.literal("lesson"), text: z.string().min(1) }),
  /** Keep a page in the bureau's notebook; a page with the same title is replaced. */
  z.object({ command: z.literal("page"), title: z.string().trim().min(1).max(120), body: z.string().min(1).max(MAX_PAGE_CHARS) }),
  /** Read the notebook: the titles, or with a title that page's text. */
  z.object({ command: z.literal("pages"), title: z.string().trim().optional() }),
]);
export type AgentCommand = z.infer<typeof AgentCommand>;
/** What the CLI sends: defaults not yet applied. */
export type AgentCommandInput = z.input<typeof AgentCommand>;

/**
 * A tool call the agent's CLI will not run without the user's say-so. Sent by
 * the permission bridge; the reply comes only once the user has decided.
 */
export const PermissionRequest = z.object({
  tool: z.string().min(1),
  /** The tool's arguments, as the CLI passed them. */
  input: z.record(z.unknown()).default({}),
});
export const PermissionResult = z.object({ decision: z.enum(["approved", "rejected"]) });
export type PermissionResult = z.infer<typeof PermissionResult>;

/** Every agent command answers with a line of text for the agent to read. */
export const AgentCommandResult = z.object({ message: z.string() });
export type AgentCommandResult = z.infer<typeof AgentCommandResult>;

// ── Events (WebSocket) ──────────────────────────────────────────────────────

/** A tool the agent called: a command it ran, a file it read or changed. Long values are clipped. */
export const ToolCall = z.object({ id: z.string(), name: z.string(), input: z.record(z.unknown()) });
export type ToolCall = z.infer<typeof ToolCall>;
/** How a tool call ended; `id` is the ToolCall's. */
export const ToolOutcome = z.object({ id: z.string(), ok: z.boolean(), text: z.string() });
export type ToolOutcome = z.infer<typeof ToolOutcome>;

export const Event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workspace.updated"), workspace: Workspace }),
  z.object({ type: z.literal("agent.updated"), agent: Agent }),
  z.object({
    type: z.literal("agent.output"),
    agentId: id,
    stream: z.enum(["stdout", "stderr"]),
    /** Plain text for a line-by-line view; empty when the event only carries a `result`. */
    chunk: z.string(),
    tool: ToolCall.optional(),
    result: ToolOutcome.optional(),
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
export type TaskFile = z.infer<typeof TaskFile>;
export type Estimate = z.infer<typeof Estimate>;
export type MessageAuthor = z.infer<typeof MessageAuthor>;
export type Message = z.infer<typeof Message>;
export type ApprovalKind = z.infer<typeof ApprovalKind>;
export type RepoState = z.infer<typeof RepoState>;
export type Connector = z.infer<typeof Connector>;
export type ConnectorTool = z.infer<typeof ConnectorTool>;
export type Terminal = z.infer<typeof Terminal>;
export type OpenTerminalRequest = z.infer<typeof OpenTerminalRequest>;
export type NotifySettings = z.infer<typeof NotifySettings>;
/** One file of a bureau's folder, as the Folder screen lists it. */
export interface FolderFile {
  path: string;
  size: number;
  modifiedAt: string;
}
export type PhoneAccess = z.infer<typeof PhoneAccess>;
export type SavePageRequest = z.infer<typeof SavePageRequest>;
export type SaveConnectorRequest = z.infer<typeof SaveConnectorRequest>;
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;
export type Approval = z.infer<typeof Approval>;
export type LessonStatus = z.infer<typeof LessonStatus>;
export type Page = z.infer<typeof Page>;
export type Lesson = z.infer<typeof Lesson>;
export type Run = z.infer<typeof Run>;
export type BudgetState = z.infer<typeof BudgetState>;
export type ToolCheck = z.infer<typeof ToolCheck>;
export type Waiting = z.infer<typeof Waiting>;
export type Event = z.infer<typeof Event>;
export type EventEnvelope = z.infer<typeof EventEnvelope>;
