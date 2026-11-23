import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, extname, join, relative, resolve, sep } from "node:path";
import type {
  Agent,
  AgentAdapter,
  AgentCommand,
  AgentCommandResult,
  ApiError,
  Approval,
  BudgetState,
  Connector,
  ConnectorTool,
  Estimate,
  Event,
  EventEnvelope,
  Lesson,
  Message,
  OpenTerminalRequest,
  Page,
  SavePageRequest,
  Terminal,
  RepoState,
  Run,
  SaveConnectorRequest,
  Task,
  TaskFile,
  ToolCheck,
  Waiting,
  Workspace,
  WorkspaceKind,
} from "@losperitos/protocol";
import { MAX_AGENTS_PER_WORKSPACE, MAX_ATTACHMENT_BYTES, MAX_PREVIEW_BYTES, PROTOCOL_VERSION } from "@losperitos/protocol";
import * as git from "@losperitos/git";
import { listTools } from "./mcp-client.js";
import { Terminals } from "./terminal.js";
import { Phone, type PhoneConfig } from "./phone.js";
import { Notifier, type NotifyConfig } from "./notify.js";
import { beginSignIn, finishSignIn, refresh, type OAuthGrant, type PendingSignIn } from "./oauth.js";
import { AppStore, WorkspaceStore, type Collection } from "@losperitos/storage";
import type { Adapter, AgentSession, McpServer, SessionEvent } from "@losperitos/adapters";

export class CoreError extends Error {
  constructor(
    readonly code: ApiError["error"]["code"],
    message: string,
  ) {
    super(message);
  }
}

export interface CoreOptions {
  dataDir: string;
  adapters: Adapter[];
  /** Adapter the lead agent of every workspace runs on. */
  leadAdapter: AgentAdapter;
  now?: () => Date;
  /**
   * How long a team member may sit idle on an open task before it is asked
   * what happened. Twenty seconds unless set.
   */
  stallMs?: number;
}

interface WorkspaceState {
  workspace: Workspace;
  store: WorkspaceStore;
  agents: Collection<Agent>;
  tasks: Collection<Task>;
  messages: Collection<Message>;
  approvals: Collection<Approval>;
  lessons: Collection<Lesson>;
  pages: Collection<Page>;
  runs: Collection<Run>;
  /** Tail of the chain that serialises task starts in this workspace. */
  queue: Promise<void>;
}

const BRIDGE_PROMPT =
  "You talk to the team and the user through the `peritos` command in your shell:\n" +
  "- `peritos ask \"<question>\" --option A --option B --recommend A\` asks the user, naming the option you would pick; then stop and wait for the answer.\n" +
  "- `peritos approval --title \"<what>\" --kind deploy|command|other --detail \"<why>\" --step \"<step>\"` " +
  "requests the user's approval before anything that deploys, publishes, deletes data or cannot be undone; then stop and wait.\n" +
  "- `peritos send --to <agent name|lead|user> \"<message>\"` messages a teammate.\n" +
  "- `peritos lesson \"<rule>\"` proposes a lasting rule for this project.\n" +
  "- `peritos page --title \"<title>\" --file <markdown file>` keeps a page in the bureau's notebook for the user to read: " +
  "a plan, a decision and its reasons, findings worth keeping. A page with the same title is replaced. It is not a file of the project. " +
  "Where a drawing says it better (a flow, a sequence, how parts connect, a timeline), put a ```mermaid block in the page: it is drawn for the user.\n" +
  "- `peritos pages` lists the notebook and `peritos pages \"<title>\"` prints a page. The user writes there too: read what bears on your task.\n" +
  "- `peritos task list` shows all tasks.\n" +
  "- `peritos bureaus` lists the user's other bureaus (other projects, each with its own team) and what they are busy with. " +
  "A lead may hand work that belongs elsewhere to that bureau's lead with `peritos send --to \"bureau:<name>\" \"<what you need and what done looks like>\"`: " +
  "copy for a feature goes to a marketing bureau, a fix in another project to that project's bureau. Do it sparingly and never to pass on work that is yours.\n" +
  "If something you cannot fix stops you (a missing key or access, an account without credit, a call that was refused), " +
  "do not end with a message about it: ask the user for what you need with `peritos ask`, then stop and wait.\n";

/** What sets one kind of workspace apart: who is on the team and what it hands in. */
const KINDS: Record<WorkspaceKind, { team: string; specialties: string; lead: string; member: string; checked: string }> = {
  software: {
    team: "coding agents",
    specialties: "developer|tester|designer|...",
    lead: "",
    member: "",
    checked: "what you tested",
  },
  marketing: {
    team: "marketing specialists (SEO, advertising, copywriting, social media, email)",
    specialties: "seo|copywriter|ads|social|analyst|...",
    lead:
      "The team's work is files in this folder: audits, keyword plans, ad copy, campaign plans, content calendars. " +
      "Nobody on the team can publish, spend an advertising budget or log in to an ad platform; the user does that with the files you hand over. " +
      "Anything written to be read by customers is at least --effort normal; small is for collecting, reformatting and other mechanical work. ",
    member:
      "Your deliverable is one or more files: Markdown for text, CSV for tables, in a subfolder that fits the work. " +
      "Write them ready to use (final copy, exact character limits, concrete numbers) and in the language the task is written in. " +
      "Where a length limit applies, count with a command (for example `printf %s \"<text>\" | wc -m`), never by eye, and shorten whatever is over. " +
            "You cannot publish or reach an ad platform, so never report that something is live. ",
    checked: "what you checked (facts, links, length limits)",
  },
  content: {
    team: "writers and editors (articles, newsletters, video scripts, storyboards, translations)",
    specialties: "writer|editor|researcher|scriptwriter|translator|...",
    lead:
      "The team's work is files in this folder: drafts, outlines, scripts, shot lists, edited copy. " +
      "Nobody on the team can publish or produce video or audio; they write what the user will publish or shoot. " +
      "Anything written to be read by customers is at least --effort normal; small is for collecting, reformatting and other mechanical work. ",
    member:
      "Your deliverable is one or more files: Markdown for text, CSV for tables, in a subfolder that fits the work. " +
      "Write finished copy, not notes about copy, in the language the task is written in. " +
      "Where a length limit applies, count with a command (for example `printf %s \"<text>\" | wc -m`), never by eye, and shorten whatever is over. " +
            "You cannot publish, so never report that something is live. ",
    checked: "what you checked (facts, sources, length)",
  },
};

function leadPrompt(kind: WorkspaceKind): string {
  const k = KINDS[kind];
  return (
    `You are the lead of a small team of ${k.team} working in this folder. ` +
    k.lead +
    "Small jobs you do yourself. Larger jobs you split into independent tasks and hand out with " +
    `\`peritos task create --title "<title>" --description "<everything the teammate needs>" --specialty <${k.specialties}> --effort <small|normal|large> [--priority high] [--after <task number>] [--label <tag>]\`. ` +
    "Use --after N (repeatable) when a task must wait until task #N is closed. " +
    "Use --effort small for mechanical work and large for work that needs hard thinking; it decides which model the teammate runs on. " +
    "Each task goes to a teammate who works apart from you, on a separate git branch when the folder is a repository, and cannot see this conversation, " +
    "so make every description self-contained and keep tasks from touching the same files. " +
    "After handing out tasks, stop; you are told when each one is closed. " +
    "Never merge or push branches yourself.\n" +
    BRIDGE_PROMPT
  );
}

/**
 * Where a member's work goes until the user accepts it: a git branch, a draft
 * folder of its own (`project` is then the real folder), or straight into the folder.
 */
type Workplace = { on: "branch" } | { on: "draft"; project: string } | { on: "folder" };

function memberPrompt(kind: WorkspaceKind, place: Workplace): string {
  const k = KINDS[kind];
  const ownBranch = place.on === "branch";
  return (
    `You are a member of a small team of ${k.team}. You work on one task` +
    (ownBranch ? ", in your own git worktree and branch" : "") +
    (place.on === "draft"
      ? `, in a draft folder of your own (your working directory). The project folder is ${place.project}: read it freely, never write to it. ` +
        "Write every file inside your draft folder, at the path it should have in the project; to change an existing project file, copy it into the draft first and edit the copy. " +
        "The user reviews the draft, and only what they accept is copied into the project. "
      : "; stay inside this folder. ") +
    k.member +
    `When the task is finished, ${ownBranch ? "commit your changes and " : ""}run ` +
    `\`peritos task done --done "<what you did>" --tested "<${k.checked}>" --not-verified "<what you could not verify>" --file "<path of a file you created or changed>"\` ` +
    "(repeat a flag for several items), then stop." +
    (ownBranch ? " Never merge, push or switch branches.\n" : "\n") +
    BRIDGE_PROMPT
  );
}

const MIME: Record<string, string> = {
  md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json", html: "text/html",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
};

/** A connector as kept on this machine: with the values of its secrets. */
type StoredConnector = Omit<Connector, "secretNames" | "signedIn"> & { secrets: Record<string, string>; oauth?: OAuthGrant };

/** How long before a token runs out it is renewed, and how long a sign-in may take in the browser. */
const RENEW_EARLY_MS = 5 * 60_000;
const SIGN_IN_WINDOW_MS = 10 * 60_000;

/** Whether a tool name fits a pattern in which `*` stands for any run of characters. */
function matchesTool(pattern: string, tool: string): boolean {
  const escaped = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("^" + escaped.join(".*") + "$").test(tool);
}

/** A starting guess at what a task costs, used until the workspace has closed tasks of its own. */
const GUESS_USD = { small: 0.1, normal: 0.4, large: 1.5 };

/** Small tasks run on a cheap model, large ones on the biggest; the rest on the tool's default. */
/**
 * Codex never stops to ask before a command, so the rule that Claude Code
 * enforces with a seal is, for a Codex team, only an instruction.
 */
const CODEX_PROMPT =
  "\n\nNothing stops you before a command, so hold yourself to this: never push, merge, deploy, publish, delete outside your working folder " +
  "or reach another machine on your own. When the work needs one of those, request it with `peritos approval` and stop.";

/** How many messages from other bureaus a bureau takes before the user has to write there again, and how far back to look. */
const CROSS_BUREAU_LIMIT = 6;
const CROSS_BUREAU_WINDOW = 200;

const MODEL_FOR: Record<"small" | "normal" | "large", string | undefined> = {
  small: "haiku",
  normal: undefined,
  large: "opus",
};

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "task";
}

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(dir, full));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

const MAX_TREE_FILES = 5000;

/** A file under `root` by its relative path, refusing anything that leads out of the folder. */
function fileAt(root: string, path: string): { full: string; mime: string; size: number } {
  let full: string;
  try {
    full = realpathSync(resolve(root, path));
  } catch {
    throw new CoreError("not_found", `No file ${path}`);
  }
  // Symlinks and ".." must not lead out of the folder.
  if (!path || !full.startsWith(realpathSync(root) + sep) || !statSync(full).isFile()) {
    throw new CoreError("not_found", `No file ${path}`);
  }
  return {
    full,
    mime: MIME[extname(full).slice(1).toLowerCase()] ?? "application/octet-stream",
    size: statSync(full).size,
  };
}

/** Where the picture of the project taken when a draft was started is kept. */
const snapshotOf = (draft: string) => `${draft}.snapshot.json`;

/** Remove a task's worktree, or its draft folder when it has no branch. */
async function dropWorkplace(repo: string, task: Task): Promise<void> {
  if (!task.worktree) return;
  if (task.branch) await git.removeWorktree(repo, task.worktree).catch(() => undefined);
  else {
    rmSync(task.worktree, { recursive: true, force: true });
    rmSync(snapshotOf(task.worktree), { force: true });
  }
}

const MAX_SNAPSHOT_FILES = 5000;

/**
 * Size and time of every file in a project folder, to tell later what
 * changed. Null when the folder is too large to keep watch over this way.
 */
function fingerprint(root: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let count = 0;
  const walk = (at: string): boolean => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === ".losperitos" || entry.name === ".git" || entry.name === "node_modules") continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        if (!walk(full)) return false;
      } else if (entry.isFile()) {
        if (++count > MAX_SNAPSHOT_FILES) return false;
        const stat = statSync(full);
        out[relative(root, full)] = `${stat.size}:${Math.round(stat.mtimeMs)}`;
      }
    }
    return true;
  };
  try {
    return walk(root) ? out : null;
  } catch {
    return null;
  }
}

/** Files of the project that were added, changed or removed since the picture was taken. */
function strayed(root: string, draft: string): string[] {
  let before: Record<string, string>;
  try {
    before = JSON.parse(readFileSync(snapshotOf(draft), "utf8"));
  } catch {
    return [];
  }
  const now = fingerprint(root);
  if (!now) return [];
  return [...new Set([...Object.keys(before), ...Object.keys(now)])].filter((file) => before[file] !== now[file]).sort();
}

/** Git repos at the folder itself and one level below it. */
function findRepos(root: string): Workspace["repos"] {
  const repos: Workspace["repos"] = [];
  const candidates = [root];
  try {
    for (const name of readdirSync(root)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const dir = join(root, name);
      if (statSync(dir).isDirectory()) candidates.push(dir);
    }
  } catch {
    // Unreadable folder: report no repos rather than fail the open.
  }
  for (const dir of candidates) {
    const head = join(dir, ".git", "HEAD");
    if (!existsSync(head)) continue;
    const content = readFileSync(head, "utf8").trim();
    const branch = content.startsWith("ref: refs/heads/")
      ? content.slice("ref: refs/heads/".length)
      : content.slice(0, 7);
    repos.push({ path: dir === root ? "." : basename(dir), branch });
  }
  return repos;
}

export class Core {
  private readonly app: AppStore;
  private readonly adapters: Map<string, Adapter>;
  private readonly now: () => Date;
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly sessions = new Map<string, AgentSession>();
  /** The run in progress for each agent, if any. */
  private readonly activeRuns = new Map<string, Run>();
  private readonly listeners = new Set<(envelope: EventEnvelope) => void>();
  /** Bridge token of each agent with a live session. */
  private readonly agentTokens = new Map<string, string>();
  private bridge: { url: string; binDir: string; cliEntry: string } | null = null;
  /** Tool calls held until the user decides, by approval id. */
  private readonly heldCalls = new Map<string, (decision: "approved" | "rejected") => void>();
  /** Timers that wake agents whose usage limit is due to reset. */
  private readonly limitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Sign-ins the user has been sent to the browser for, by their one-time state. */
  private readonly signIns = new Map<string, { workspaceId: string; connectorId: string; pending: PendingSignIn; until: number }>();
  /** Timers that renew connector sign-ins before they run out. */
  private readonly renewTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Timers that look in on a team member who went idle with its task still open. */
  private readonly stallTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Tasks whose member has already been reminded once to report or ask. */
  private readonly reminded = new Set<string>();
  /** Sessions that have been started on a resumed conversation and not yet said anything. */
  private readonly resuming = new Set<string>();
  /** Agents whose process should end once their current turn has been accounted for. */
  private readonly stopAfterTurn = new Set<string>();
  private seq = 0;

  constructor(private readonly options: CoreOptions) {
    this.app = new AppStore(options.dataDir);
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.id, adapter]));
    this.now = options.now ?? (() => new Date());
    if (!this.adapters.has(options.leadAdapter)) {
      throw new Error(`No adapter registered for "${options.leadAdapter}"`);
    }
    for (const path of this.app.workspacePaths()) {
      if (existsSync(path)) this.load(path);
    }
    for (const workspaceId of this.workspaces.keys()) {
      for (const connector of this.storedConnectors(workspaceId)) if (connector.oauth) this.planRenewal(workspaceId, connector.id);
    }
  }

  /**
   * Tell the core where its HTTP server listens and where the `peritos` CLI
   * entry point is, so agents it starts can call back.
   */
  setBridge(url: string, cliEntry: string): void {
    const binDir = join(this.options.dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const script = join(binDir, "peritos");
    // Inside the desktop app the runtime is Electron, which must be told to act as plain Node.
    const asNode = process.versions.electron ? "ELECTRON_RUN_AS_NODE=1 " : "";
    writeFileSync(script, `#!/bin/sh\n${asNode}exec "${process.execPath}" "${cliEntry}" "$@"\n`);
    chmodSync(script, 0o755);
    this.bridge = { url, binDir, cliEntry };
  }

  // ── Events ────────────────────────────────────────────────────────────────

  subscribe(listener: (envelope: EventEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: Event): void {
    const envelope: EventEnvelope = {
      v: PROTOCOL_VERSION,
      seq: this.seq++,
      at: this.now().toISOString(),
      event,
    };
    for (const listener of this.listeners) listener(envelope);
  }

  /** The agent tool a bureau's team runs on. A demo core runs everything on the scripted one. */
  private toolOf(workspace: Workspace): AgentAdapter {
    return this.options.leadAdapter === "fake" ? "fake" : (workspace.agentTool ?? this.options.leadAdapter);
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  async setup(): Promise<ToolCheck[]> {
    const git = new Promise<ToolCheck>((done) => {
      execFile("git", ["--version"], { timeout: 10_000 }, (err, stdout) =>
        done({
          tool: "git",
          required: true,
          found: !err,
          version: err ? null : stdout.trim(),
          installHint: err ? "Install Git: https://git-scm.com/downloads" : null,
        }),
      );
    });
    const lead = this.adapters.get(this.options.leadAdapter)!;
    // A second tool is offered when it is there to be chosen; it is never required.
    const others = [...this.adapters.values()].filter((adapter) => adapter !== lead && adapter.id !== "fake" && this.options.leadAdapter !== "fake");
    return Promise.all([git, lead.check(), ...others.map((adapter) => adapter.check())]);
  }

  // ── Workspaces ────────────────────────────────────────────────────────────

  listWorkspaces(): Workspace[] {
    return [...this.workspaces.values()].map((state) => state.workspace);
  }

  openWorkspace(path: string, kind?: WorkspaceKind): Workspace {
    const full = resolve(path);
    if (!existsSync(full) || !statSync(full).isDirectory()) {
      throw new CoreError("bad_request", `Not a folder: ${full}`);
    }
    const existing = [...this.workspaces.values()].find((s) => s.workspace.path === full);
    if (existing) return existing.workspace;
    const state = this.load(full);
    // The kind is chosen once, when a folder first becomes a workspace; later it changes from settings.
    if (kind && !state.workspace.kind) {
      state.workspace = { ...state.workspace, kind };
      state.store.writeDoc("workspace", state.workspace);
    }
    this.app.addWorkspacePath(full);
    this.emit({ type: "workspace.updated", workspace: state.workspace });
    return state.workspace;
  }

  updateWorkspace(
    workspaceId: string,
    patch: Partial<Pick<Workspace, "name" | "trustMode" | "kind" | "dailyBudgetUsd" | "dispatchPaused" | "agentTool">>,
  ): Workspace {
    const state = this.state(workspaceId);
    if (patch.agentTool && !this.adapters.has(patch.agentTool)) throw new CoreError("bad_request", `No agent tool "${patch.agentTool}" here.`);
    const before = this.toolOf(state.workspace);
    state.workspace = { ...state.workspace, ...patch };
    state.store.writeDoc("workspace", state.workspace);
    const tool = this.toolOf(state.workspace);
    if (tool !== before) {
      // Another tool cannot pick up this one's conversations: the team starts afresh on it, tasks and notebook intact.
      for (const agent of state.agents.all()) {
        const session = this.sessions.get(agent.id);
        if (session) void session.stop();
        this.setAgent(state, agent.id, { adapter: tool, sessionId: null });
      }
    }
    this.emit({ type: "workspace.updated", workspace: state.workspace });
    this.emit({ type: "budget.updated", budget: this.budget(workspaceId) });
    // Lifting a pause, or raising the budget, may let waiting tasks start.
    void this.startQueued(state).catch(() => undefined);
    return state.workspace;
  }

  // ── Tasks the user manages ────────────────────────────────────────────────

  /** A task written by the user. Queued tasks go to the team as seats allow. */
  async createTask(
    workspaceId: string,
    fields: {
      title: string;
      description: string;
      specialty: string;
      effort: Task["effort"];
      priority: Task["priority"];
      dependsOn: string[];
      labels?: string[];
      repo?: string;
      start: boolean;
    },
  ): Promise<Task> {
    const state = this.state(workspaceId);
    const task = this.addTask(state, { ...fields, status: fields.start ? "queued" : "draft" });
    if (fields.start) await this.startQueued(state);
    return state.tasks.get(task.id)!;
  }

  /** What the lead is told when the folder holds several repositories rather than being one. */
  private reposPrompt(state: WorkspaceState): string {
    const names = this.refreshRepos(state).filter((repo) => repo.path !== ".").map((repo) => repo.path);
    if (names.length === 0) return "";
    return (
      `\nThis folder holds several git repositories: ${names.join(", ")}. ` +
      "Add `--repo <name>` to `peritos task create` to say which one a task works in; it then gets its own branch there. " +
      "A job that touches two repositories becomes two tasks, one for each. " +
      "A task without --repo works in the folder itself, with no branch and nothing to merge.\n"
    );
  }

  /** Look again for repositories in the folder and remember what is there. */
  private refreshRepos(state: WorkspaceState): Workspace["repos"] {
    const repos = findRepos(state.workspace.path);
    if (JSON.stringify(repos) !== JSON.stringify(state.workspace.repos)) {
      state.workspace = { ...state.workspace, repos };
      state.store.writeDoc("workspace", state.workspace);
      this.emit({ type: "workspace.updated", workspace: state.workspace });
    }
    return repos;
  }

  /** The folder git works in for a task, or for a repository named in a request. */
  private repoDir(state: WorkspaceState, repo: string | null | undefined): string {
    if (!repo) return state.workspace.path;
    if (!this.refreshRepos(state).some((known) => known.path === repo && known.path !== ".")) {
      throw new CoreError("not_found", `No repository "${repo}" in this folder.`);
    }
    return join(state.workspace.path, repo);
  }

  private addTask(
    state: WorkspaceState,
    fields: Pick<Task, "title" | "description" | "specialty" | "effort" | "priority" | "dependsOn" | "labels" | "status" | "repo">,
  ): Task {
    if (fields.repo !== undefined) {
      // Repositories may have been added since the folder was opened.
      const repos = this.refreshRepos(state);
      if (!repos.some((repo) => repo.path === fields.repo && repo.path !== ".")) {
        const names = repos.filter((repo) => repo.path !== ".").map((repo) => repo.path);
        throw new CoreError("bad_request", names.length ? `No repository "${fields.repo}" here. There are: ${names.join(", ")}` : "This folder does not hold several repositories; leave --repo out.");
      }
    } else delete (fields as { repo?: string }).repo;
    for (const dependency of fields.dependsOn ?? []) {
      if (!state.tasks.get(dependency)) throw new CoreError("bad_request", `No task ${dependency} to wait for.`);
    }
    const now = this.now().toISOString();
    const task = state.tasks.put({
      id: randomUUID(),
      workspaceId: state.workspace.id,
      number: Math.max(0, ...state.tasks.all().map((t) => t.number)) + 1,
      parentId: null,
      assigneeId: null,
      branch: null,
      baseBranch: null,
      worktree: null,
      report: null,
      createdAt: now,
      updatedAt: now,
      ...fields,
    });
    this.emit({ type: "task.updated", task });
    return task;
  }

  /**
   * Change a task. Its details can be edited until it is handed out; after
   * that the only change allowed is cancelling it.
   */
  async updateTask(
    taskId: string,
    patch: Partial<Pick<Task, "title" | "description" | "specialty" | "effort" | "priority" | "dependsOn" | "labels">> & {
      status?: "draft" | "queued" | "cancelled";
    },
  ): Promise<Task> {
    const { state, item } = this.find((s) => s.tasks, taskId, "task");
    const waiting = item.status === "draft" || item.status === "queued";
    const { status, ...details } = patch;
    if (item.status === "done" || item.status === "cancelled") {
      throw new CoreError("conflict", "This task is already closed.");
    }
    if (!waiting && (Object.keys(details).length > 0 || (status && status !== "cancelled"))) {
      throw new CoreError("conflict", "This task has been handed out; it can only be cancelled now.");
    }
    if (details.dependsOn?.includes(taskId)) throw new CoreError("bad_request", "A task cannot wait for itself.");
    for (const dependency of details.dependsOn ?? []) {
      if (!state.tasks.get(dependency)) throw new CoreError("bad_request", `No task ${dependency} to wait for.`);
    }

    if (status === "cancelled" && !waiting) {
      // Under way: stop the perito, drop the worktree (the branch is kept), refuse its open requests.
      if (item.assigneeId) {
        await this.sessions.get(item.assigneeId)?.stop();
        this.setAgent(state, item.assigneeId, { taskId: null, status: "stopped", sessionId: null });
      }
      await dropWorkplace(this.repoDir(state, item.repo), item);
      for (const approval of state.approvals.all()) {
        if (approval.taskId !== taskId || approval.status !== "pending") continue;
        const closed = state.approvals.put({ ...approval, status: "rejected", decidedAt: this.now().toISOString() });
        this.emit({ type: "approval.decided", approval: closed });
        this.heldCalls.get(approval.id)?.("rejected");
        this.heldCalls.delete(approval.id);
      }
    }
    const updated = state.tasks.put({
      ...item,
      ...details,
      ...(status && { status }),
      ...(status === "cancelled" && { worktree: null }),
      updatedAt: this.now().toISOString(),
    });
    this.emit({ type: "task.updated", task: updated });
    await this.startQueued(state);
    return state.tasks.get(taskId)!;
  }

  /** Open issues of the workspace's GitHub repository, for import as tasks. */
  listIssues(workspaceId: string): Promise<Array<{ number: number; title: string; body: string; url: string; labels: string[] }>> {
    const state = this.state(workspaceId);
    return new Promise((resolve, reject) => {
      execFile(
        "gh",
        ["issue", "list", "--state", "open", "--limit", "50", "--json", "number,title,body,url,labels"],
        { cwd: state.workspace.path, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
            return reject(
              new CoreError(
                "conflict",
                missing
                  ? "The GitHub CLI (gh) is not installed. Install it from https://cli.github.com and run `gh auth login`."
                  : `GitHub could not list issues: ${(stderr || err.message).trim().split("\n")[0]}`,
              ),
            );
          }
          try {
            const issues = JSON.parse(stdout) as Array<{ number: number; title: string; body: string; url: string; labels: Array<{ name: string }> }>;
            resolve(issues.map((issue) => ({ ...issue, body: issue.body ?? "", labels: issue.labels.map((label) => label.name) })));
          } catch {
            reject(new CoreError("internal", "GitHub gave an unreadable answer."));
          }
        },
      );
    });
  }

  private load(path: string): WorkspaceState {
    const store = new WorkspaceStore(path);
    const saved = store.readDoc<Workspace>("workspace");
    const workspace: Workspace = {
      ...(saved ?? {
        id: randomUUID(),
        name: basename(path),
        trustMode: "full",
        dailyBudgetUsd: null,
        createdAt: this.now().toISOString(),
      }),
      path,
      repos: findRepos(path),
    };
    store.writeDoc("workspace", workspace);
    const state: WorkspaceState = {
      workspace,
      store,
      agents: store.collection("agents"),
      tasks: store.collection("tasks"),
      messages: store.collection("messages"),
      approvals: store.collection("approvals"),
      lessons: store.collection("lessons"),
      pages: store.collection("pages"),
      runs: store.collection("runs"),
      queue: Promise.resolve(),
    };
    // No process survives a restart, so nobody can still be mid-turn.
    for (const agent of state.agents.all()) {
      const adapter = this.toolOf(workspace);
      const status = agent.status === "working" ? "idle" : agent.status;
      if (adapter !== agent.adapter || status !== agent.status) {
        state.agents.put({ ...agent, adapter, status });
      }
    }
    // Agents that were waiting out a usage limit keep waiting.
    queueMicrotask(() => {
      for (const agent of state.agents.all()) if (agent.status === "limited") this.scheduleResume(state, agent.id, agent.resumeAt ?? null);
    });
    if (!state.agents.all().some((agent) => agent.role === "lead")) {
      state.agents.put({
        id: randomUUID(),
        workspaceId: workspace.id,
        name: "Lead",
        role: "lead",
        specialty: null,
        adapter: this.toolOf(workspace),
        status: "idle",
        taskId: null,
        lastOutput: null,
        error: null,
      });
    }
    this.workspaces.set(workspace.id, state);
    return state;
  }

  private state(workspaceId: string): WorkspaceState {
    const state = this.workspaces.get(workspaceId);
    if (!state) throw new CoreError("not_found", `No workspace ${workspaceId}`);
    return state;
  }

  /** Find the record with this id in whichever workspace holds it. */
  private find<T extends { id: string }>(
    pick: (state: WorkspaceState) => Collection<T>,
    id: string,
    what: string,
  ): { state: WorkspaceState; item: T } {
    for (const state of this.workspaces.values()) {
      const item = pick(state).get(id);
      if (item) return { state, item };
    }
    throw new CoreError("not_found", `No ${what} ${id}`);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  listAgents(workspaceId: string): Agent[] {
    return this.state(workspaceId).agents.all();
  }

  listTasks(workspaceId: string): Task[] {
    return this.state(workspaceId).tasks.all();
  }

  getTask(taskId: string): Task {
    return this.find((s) => s.tasks, taskId, "task").item;
  }

  /** The task branch against the branch it started from; empty without a branch. */
  async taskDiff(taskId: string): Promise<string> {
    const { state, item } = this.find((s) => s.tasks, taskId, "task");
    if (!item.branch || !item.baseBranch) return "";
    try {
      return await git.diff(this.repoDir(state, item.repo), item.baseBranch, item.branch);
    } catch (err) {
      throw new CoreError("conflict", (err as Error).message);
    }
  }

  /** Branch, recent commits, other branches and uncommitted changes of the workspace's repository. */
  async repo(workspaceId: string, repo: string | null = null): Promise<RepoState> {
    const state = this.state(workspaceId);
    const root = this.repoDir(state, repo);
    const branch = await git.currentBranch(root);
    if (!branch) throw new CoreError("conflict", "This folder is not a git repository.");
    try {
      const [commits, changes, branches] = await Promise.all([git.log(root, 40), git.status(root), git.branches(root, branch)]);
      const tasks = state.tasks.all();
      return {
        branch,
        commits,
        changes,
        branches: branches.map((b) => ({ ...b, taskId: tasks.find((task) => task.branch === b.name && (task.repo ?? null) === repo)?.id ?? null })),
      };
    } catch (err) {
      throw new CoreError("conflict", (err as Error).message);
    }
  }

  /** The patch of one commit, or of the uncommitted changes when no commit is named. */
  async repoDiff(workspaceId: string, commit: string | null, repo: string | null = null): Promise<string> {
    const state = this.state(workspaceId);
    const root = this.repoDir(state, repo);
    if (commit !== null && !/^[0-9a-f]{7,40}$/.test(commit)) throw new CoreError("bad_request", "Not a commit hash.");
    try {
      return commit ? await git.show(root, commit) : await git.workingDiff(root);
    } catch (err) {
      throw new CoreError("conflict", (err as Error).message);
    }
  }

  /** The repository's files, for the code panel's tree. */
  async repoFiles(workspaceId: string, repo: string | null = null): Promise<{ files: string[]; more: boolean }> {
    const state = this.state(workspaceId);
    try {
      const all = (await git.files(this.repoDir(state, repo))).filter((file) => !file.startsWith(".losperitos/"));
      return { files: all.slice(0, MAX_TREE_FILES), more: all.length > MAX_TREE_FILES };
    } catch (err) {
      throw new CoreError("conflict", (err as Error).message);
    }
  }

  /** One file of the project folder, to read in the code panel. */
  repoFile(workspaceId: string, path: string, repo: string | null = null): TaskFile {
    const { full, mime, size } = fileAt(this.repoDir(this.state(workspaceId), repo), path);
    if (size > MAX_PREVIEW_BYTES) throw new CoreError("bad_request", "File is too large to show");
    const data = readFileSync(full);
    // Source files have no type of their own here: anything without a zero byte is read as text.
    const text = mime === "application/octet-stream" && !data.subarray(0, 8192).includes(0);
    return { path, mime: text ? "text/plain" : mime, size, data: data.toString("base64") };
  }

  async repoSearch(workspaceId: string, query: string, repo: string | null = null): Promise<{ hits: Array<{ path: string; line: number; text: string }> }> {
    const state = this.state(workspaceId);
    const words = query.trim();
    if (words.length < 2) return { hits: [] };
    try {
      const hits = await git.search(this.repoDir(state, repo), words, 200);
      return { hits: hits.filter((hit) => !hit.path.startsWith(".losperitos/")) };
    } catch (err) {
      throw new CoreError("conflict", (err as Error).message);
    }
  }

  /** One file of a task: from its worktree while it is open, from the folder afterwards. */
  taskFile(taskId: string, path: string): TaskFile {
    const { full, mime, size } = this.taskFileAt(taskId, path);
    if (size > MAX_PREVIEW_BYTES) throw new CoreError("bad_request", "File is too large to preview");
    return { path, mime, size, data: readFileSync(full).toString("base64") };
  }

  /** Where one of a task's files is on disk, for sending its bytes as they are. */
  taskFileAt(taskId: string, path: string): { full: string; mime: string; size: number } {
    const { state, item } = this.find((s) => s.tasks, taskId, "task");
    return fileAt(item.worktree && existsSync(item.worktree) ? item.worktree : this.repoDir(state, item.repo), path);
  }

  listMessages(workspaceId: string): Message[] {
    return this.state(workspaceId).messages.all();
  }

  listApprovals(workspaceId: string): Approval[] {
    return this.state(workspaceId).approvals.all();
  }

  /** The door for a phone on the same network; shut unless the user opens it. */
  readonly phone = new Phone(
    this,
    () => this.app.readSecret<PhoneConfig | null>("phone", null),
    (config) => this.app.writeSecret("phone", config),
    () => this.options.dataDir,
  );

  /** Nudges to the user's phone when something waits; silent unless the user set it up. */
  readonly notifier = new Notifier(
    () => this.app.readSecret<NotifyConfig | null>("notify", null),
    (config) => this.app.writeSecret("notify", config),
    () => this.now(),
  );

  // ── Terminals ─────────────────────────────────────────────────────────────

  /** The user's own shells. They are the user's hands, not an agent's: nothing here is sealed or metered. */
  readonly terminals = new Terminals();

  listTerminals(workspaceId: string): { available: boolean; terminals: Terminal[] } {
    this.state(workspaceId);
    return { available: this.terminals.available, terminals: this.terminals.list(workspaceId) };
  }

  openTerminal(workspaceId: string, request: OpenTerminalRequest): Terminal {
    const state = this.state(workspaceId);
    const task = request.taskId ? state.tasks.get(request.taskId) : undefined;
    if (request.taskId && !task) throw new CoreError("not_found", `No task ${request.taskId}`);
    const cwd = task?.worktree && existsSync(task.worktree) ? task.worktree : state.workspace.path;
    const title = task?.worktree && cwd === task.worktree ? `#${task.number}` : basename(cwd);
    try {
      return this.terminals.open(workspaceId, cwd, title, request.cols, request.rows, this.now());
    } catch (err) {
      throw new CoreError("bad_request", (err as Error).message);
    }
  }

  closeTerminal(terminalId: string): { closed: boolean } {
    return { closed: this.terminals.close(terminalId) !== null };
  }

  /** The bureau's notebook, most recently written first. */
  listPages(workspaceId: string): Page[] {
    return this.state(workspaceId)
      .pages.all()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** The user's own hand in the notebook: a new page, or a page rewritten. */
  savePage(workspaceId: string, request: SavePageRequest): Page[] {
    const state = this.state(workspaceId);
    const before = request.id ? state.pages.get(request.id) : undefined;
    if (request.id && !before) throw new CoreError("not_found", `No page ${request.id}`);
    const taken = state.pages.all().find((page) => page.id !== before?.id && page.title.toLowerCase() === request.title.toLowerCase());
    if (taken) throw new CoreError("bad_request", `There is already a page called "${taken.title}"`);
    const now = this.now().toISOString();
    state.pages.put({
      id: before?.id ?? randomUUID(),
      workspaceId,
      title: request.title,
      body: request.body,
      authorAgentId: before ? before.authorAgentId : null,
      taskId: before?.taskId ?? null,
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    });
    return this.listPages(workspaceId);
  }

  removePage(pageId: string): Page[] {
    const { state } = this.find((s) => s.pages, pageId, "page");
    state.pages.remove(pageId);
    return this.listPages(state.workspace.id);
  }

  /** Markdown files of the project folder, a few levels deep, for reading beside the notebook. */
  listDocs(workspaceId: string): { files: string[] } {
    const root = this.state(workspaceId).workspace.path;
    const files: string[] = [];
    const walk = (dir: string, depth: number) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= 300) return;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < 5) walk(full, depth + 1);
        } else if (/\.(md|markdown)$/i.test(entry.name)) files.push(relative(root, full));
      }
    };
    walk(root, 0);
    return { files: files.sort() };
  }

  listLessons(workspaceId: string): Lesson[] {
    return this.state(workspaceId).lessons.all();
  }

  /** Today's finished agent turns in this workspace. */
  listRuns(workspaceId: string): Run[] {
    const today = localDate(this.now());
    return this.state(workspaceId)
      .runs.all()
      .filter((run) => localDate(new Date(run.startedAt)) === today);
  }

  /**
   * What a new task is likely to cost: the median of this workspace's closed
   * tasks of the same effort, or a built-in guess until there are any.
   */
  estimate(workspaceId: string): Estimate {
    const state = this.state(workspaceId);
    const spent = new Map<string, number>();
    for (const run of state.runs.all()) {
      if (run.taskId) spent.set(run.taskId, (spent.get(run.taskId) ?? 0) + run.costUsd);
    }
    const out = {} as Estimate;
    for (const effort of ["small", "normal", "large"] as const) {
      const costs = state.tasks
        .all()
        .filter((task) => task.status === "done" && (task.effort ?? "normal") === effort && spent.has(task.id))
        .map((task) => spent.get(task.id)!)
        .sort((a, b) => a - b);
      const middle = costs.length >> 1;
      const median = costs.length % 2 ? costs[middle]! : (costs[middle - 1]! + costs[middle]!) / 2;
      out[effort] = costs.length ? { usd: median, tasks: costs.length } : { usd: GUESS_USD[effort], tasks: 0 };
    }
    return out;
  }

  budget(workspaceId: string): BudgetState {
    const state = this.state(workspaceId);
    const today = localDate(this.now());
    const spentUsd = state.runs
      .all()
      .filter((run) => localDate(new Date(run.startedAt)) === today)
      .reduce((sum, run) => sum + run.costUsd, 0);
    const limitUsd = state.workspace.dailyBudgetUsd;
    const level =
      limitUsd === null ? "ok" : spentUsd >= limitUsd ? "exhausted" : spentUsd >= limitUsd * 0.8 ? "warning" : "ok";
    return { workspaceId, date: today, limitUsd, spentUsd, level };
  }

  waiting(): Waiting {
    const approvals: Approval[] = [];
    const questions: Message[] = [];
    for (const state of this.workspaces.values()) {
      approvals.push(...state.approvals.all().filter((a) => a.status === "pending"));
      questions.push(...state.messages.all().filter((m) => m.question && m.question.answer === null));
    }
    return { approvals, questions };
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  /** A new job from the user. Refused once today's budget is spent. */
  sendMessage(
    workspaceId: string,
    request: { body: string; toAgentId: string | null; taskId: string | null; attachments?: string[] },
  ): Message {
    const state = this.state(workspaceId);
    const agent = request.toAgentId
      ? state.agents.get(request.toAgentId)
      : state.agents.all().find((a) => a.role === "lead");
    if (!agent) throw new CoreError("not_found", `No agent ${request.toAgentId}`);
    if (this.budget(workspaceId).level === "exhausted") {
      throw new CoreError("budget_exhausted", "Today's budget for this workspace is spent.");
    }
    const attachments = request.attachments ?? [];
    const folder = this.attachmentsDir(state);
    for (const name of attachments) {
      // Names come from uploadAttachment; anything else is not ours to hand to an agent.
      if (basename(name) !== name || !existsSync(join(folder, name))) {
        throw new CoreError("bad_request", `No attachment named "${name}"`);
      }
    }
    const message = this.addMessage(state, {
      author: { kind: "user" },
      toAgentId: agent.id,
      taskId: request.taskId,
      body: request.body,
      question: null,
      ...(attachments.length && { attachments }),
    });
    const note = attachments.length
      ? "\n\nThe user attached these files; read them as needed:\n" +
        attachments.map((name) => `- ${join(folder, name)}`).join("\n")
      : "";
    this.deliver(state, agent, request.body + note);
    return message;
  }

  // ── Connectors ────────────────────────────────────────────────────────────

  private storedConnectors(workspaceId: string): StoredConnector[] {
    return this.app.readSecret<Record<string, StoredConnector[]>>("connectors", {})[workspaceId] ?? [];
  }

  private storeConnectors(workspaceId: string, connectors: StoredConnector[]): void {
    const all = this.app.readSecret<Record<string, StoredConnector[]>>("connectors", {});
    this.app.writeSecret("connectors", { ...all, [workspaceId]: connectors });
  }

  /** The workspace's connectors, without the values of their secrets. */
  listConnectors(workspaceId: string): Connector[] {
    this.state(workspaceId);
    return this.storedConnectors(workspaceId).map(({ secrets, oauth, ...rest }) => ({
      ...rest,
      secretNames: Object.keys(secrets),
      signedIn: !!oauth && this.holds(oauth),
    }));
  }

  /** Whether a sign-in can still be used: its token has time left, or can be renewed. */
  private holds(grant: OAuthGrant): boolean {
    return !grant.expiresAt || !!grant.refreshToken || new Date(grant.expiresAt).getTime() > this.now().getTime();
  }

  /**
   * Start signing in to a connector's server. Returns the provider's page for
   * the user's browser; the browser comes back to `/oauth/callback` here.
   */
  async beginConnectorSignIn(workspaceId: string, connectorId: string): Promise<{ url: string }> {
    this.state(workspaceId);
    const connector = this.storedConnectors(workspaceId).find((c) => c.id === connectorId);
    if (!connector?.url) throw new CoreError("bad_request", "Only a connector with an address can be signed in to.");
    if (!this.bridge) throw new CoreError("internal", "The core does not know its own address.");
    const state = randomBytes(32).toString("base64url");
    try {
      const { url, pending } = await beginSignIn(connector.url, `${this.bridge.url}/oauth/callback`, state);
      for (const [key, entry] of this.signIns) if (entry.until < Date.now()) this.signIns.delete(key);
      this.signIns.set(state, { workspaceId, connectorId, pending, until: Date.now() + SIGN_IN_WINDOW_MS });
      return { url };
    } catch (err) {
      throw new CoreError("bad_request", (err as Error).message);
    }
  }

  /** The browser came back: trade the code for tokens and give them to the connector. */
  async finishConnectorSignIn(state: string, code: string): Promise<string> {
    const entry = this.signIns.get(state);
    this.signIns.delete(state);
    if (!entry || entry.until < Date.now()) throw new CoreError("bad_request", "This sign-in is not one this app started, or it took too long.");
    let grant: OAuthGrant;
    try {
      grant = await finishSignIn(entry.pending, code, this.now());
    } catch (err) {
      throw new CoreError("bad_request", (err as Error).message);
    }
    const name = this.keepGrant(entry.workspaceId, entry.connectorId, grant);
    if (!name) throw new CoreError("not_found", "The connector was removed meanwhile.");
    return name;
  }

  /** Store a sign-in with its connector, hand it to the team, and plan its renewal. */
  private keepGrant(workspaceId: string, connectorId: string, grant: OAuthGrant | undefined): string | null {
    const stored = this.storedConnectors(workspaceId);
    const connector = stored.find((c) => c.id === connectorId);
    if (!connector) return null;
    this.storeConnectors(workspaceId, stored.map((c) => (c.id === connectorId ? { ...c, oauth: grant } : c)));
    // A team that already goes through the relay gets a renewed token there, in the middle of a turn if need be.
    if (!this.bridge || !connector.oauth || !grant) this.refreshSessions(workspaceId);
    this.planRenewal(workspaceId, connectorId);
    return connector.name;
  }

  /** Renew a connector's token a little before it runs out. */
  private planRenewal(workspaceId: string, connectorId: string): void {
    const key = `${workspaceId}/${connectorId}`;
    clearTimeout(this.renewTimers.get(key));
    this.renewTimers.delete(key);
    const grant = this.storedConnectors(workspaceId).find((c) => c.id === connectorId)?.oauth;
    if (!grant?.expiresAt || !grant.refreshToken) return;
    const wait = Math.max(1000, new Date(grant.expiresAt).getTime() - this.now().getTime() - RENEW_EARLY_MS);
    const timer = setTimeout(() => {
      this.renewTimers.delete(key);
      const current = this.storedConnectors(workspaceId).find((c) => c.id === connectorId)?.oauth;
      if (!current) return;
      refresh(current, this.now()).then(
        (next) => void this.keepGrant(workspaceId, connectorId, next),
        // The provider took the sign-in back: the user has to sign in again.
        () => void this.keepGrant(workspaceId, connectorId, { ...current, refreshToken: null, expiresAt: new Date(0).toISOString() }),
      );
    }, Math.min(wait, 2 ** 31 - 1));
    timer.unref?.();
    this.renewTimers.set(key, timer);
  }

  /** Add a connector or replace the one with the same id. Agents get it when they next sit down. */
  saveConnector(workspaceId: string, request: SaveConnectorRequest): Connector[] {
    this.state(workspaceId);
    const stored = this.storedConnectors(workspaceId);
    const before = stored.find((connector) => connector.id === request.id);
    const secrets = { ...before?.secrets };
    for (const [name, value] of Object.entries(request.secrets)) {
      if (!name.trim()) continue;
      if (value) secrets[name.trim()] = value;
      else delete secrets[name.trim()];
    }
    // A sign-in belongs to the address it was made at.
    const next: StoredConnector = { ...request, secrets, ...(before?.oauth && before.url === request.url && { oauth: before.oauth }) };
    this.storeConnectors(workspaceId, before ? stored.map((c) => (c.id === request.id ? next : c)) : [...stored, next]);
    // Which tools are free is read at each call; only a change to the server itself needs a fresh start.
    const same = before && before.command === next.command && before.url === next.url &&
      JSON.stringify([before.args, before.secrets]) === JSON.stringify([next.args, next.secrets]);
    if (!same) this.refreshSessions(workspaceId);
    return this.listConnectors(workspaceId);
  }

  removeConnector(workspaceId: string, connectorId: string): Connector[] {
    this.state(workspaceId);
    this.storeConnectors(workspaceId, this.storedConnectors(workspaceId).filter((c) => c.id !== connectorId));
    this.refreshSessions(workspaceId);
    return this.listConnectors(workspaceId);
  }

  /** The tools a connector's server offers, asked of the server itself. */
  async connectorTools(workspaceId: string, connectorId: string): Promise<{ tools: ConnectorTool[] }> {
    const state = this.state(workspaceId);
    const server = this.mcpServers(state)[connectorId];
    if (!server) throw new CoreError("not_found", `No connector ${connectorId}`);
    try {
      return { tools: await listTools(server) };
    } catch (err) {
      throw new CoreError("bad_request", (err as Error).message);
    }
  }

  /**
   * An agent's tool reads its connectors when it starts. So that a change
   * reaches the team, agents end their process once the turn in hand is over;
   * the next message starts it again on the same conversation.
   */
  private refreshSessions(workspaceId: string): void {
    for (const agent of this.state(workspaceId).agents.all()) {
      const session = this.sessions.get(agent.id);
      if (!session) continue;
      if (agent.status === "idle") void session.stop();
      else this.stopAfterTurn.add(agent.id);
    }
  }

  /**
   * Where a signed-in connector really is, for a call an agent sends through
   * the relay. The agent holds only its own token: the provider's token is
   * added here, so one renewed during a long turn is the one that goes out.
   */
  relayTarget(agentToken: string, connectorId: string): { url: string; headers: Record<string, string> } {
    const agentId = [...this.agentTokens].find(([, t]) => t === agentToken)?.[0];
    if (!agentId) throw new CoreError("unauthorized", "Unknown agent token");
    const { state } = this.find((s) => s.agents, agentId, "agent");
    const connector = this.storedConnectors(state.workspace.id).find((c) => c.id === connectorId);
    if (!connector?.url || !connector.oauth) throw new CoreError("not_found", `No signed-in connector ${connectorId}`);
    if (!this.holds(connector.oauth)) throw new CoreError("unauthorized", `The sign-in to ${connector.name} has run out; the user has to sign in again in Settings.`);
    return { url: connector.url, headers: { ...connector.secrets, Authorization: `Bearer ${connector.oauth.accessToken}` } };
  }

  /**
   * The connectors as the agent's tool starts them. With an agent's token, a
   * signed-in connector is reached through the core's relay rather than directly.
   */
  private mcpServers(state: WorkspaceState, agentToken?: string): Record<string, McpServer> {
    return Object.fromEntries(
      this.storedConnectors(state.workspace.id).map((connector) => [
        connector.id,
        connector.url && connector.oauth && agentToken && this.bridge
          ? { type: "http" as const, url: `${this.bridge.url}/relay/${connector.id}`, headers: { Authorization: `Bearer ${agentToken}` } }
          : connector.url
          ? {
              type: "http" as const,
              url: connector.url,
              headers: {
                ...connector.secrets,
                ...(connector.oauth && this.holds(connector.oauth) && { Authorization: `Bearer ${connector.oauth.accessToken}` }),
              },
            }
          : { command: connector.command!, args: connector.args, env: connector.secrets },
      ]),
    );
  }

  /** What an agent is told about the outside services it can reach. */
  private connectorsPrompt(state: WorkspaceState): string {
    const connectors = this.storedConnectors(state.workspace.id);
    if (connectors.length === 0) return "";
    return (
      "\nOutside services connected to this project. Their tools are named mcp__<id>__<tool>:\n" +
      connectors.map((connector) => `- ${connector.name} (id: ${connector.id})`).join("\n") +
      "\nA call that changes, publishes or spends something outside this computer waits for the user's seal, " +
      "which can take a long time. If a call is refused, do not try to reach the same end another way: " +
      "say what was refused in your report.\n" +
      "When a service answers with the address of a file it made (an image, a video, a sound), download the file " +
      "into your working folder with curl, give it a plain name, and list it with --file when you report: " +
      "an address alone is not a deliverable and may stop working.\n"
    );
  }

  /** The lessons the user has accepted, as a block for an agent's system prompt. */
  private lessonsPrompt(state: WorkspaceState): string {
    const accepted = state.lessons.all().filter((lesson) => lesson.status === "accepted");
    if (accepted.length === 0) return "";
    return (
      "\nStanding lessons for this project, accepted by the user. Follow them:\n" +
      accepted.map((lesson) => `- ${lesson.text}`).join("\n") +
      "\n"
    );
  }

  private attachmentsDir(state: WorkspaceState): string {
    return join(state.store.dir, "attachments");
  }

  /** Store a file the user wants to attach; returns the name to send with the message. */
  uploadAttachment(workspaceId: string, name: string, base64: string): { name: string } {
    const state = this.state(workspaceId);
    const data = Buffer.from(base64, "base64");
    if (data.length === 0) throw new CoreError("bad_request", "The file is empty.");
    if (data.length > MAX_ATTACHMENT_BYTES) {
      throw new CoreError("bad_request", `Files can be at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
    }
    // Keep the name recognisable but safe as a single path segment, and unique.
    const safe = basename(name).replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(-80) || "file";
    const stored = `${randomBytes(4).toString("hex")}-${safe}`;
    const folder = this.attachmentsDir(state);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, stored), data);
    return { name: stored };
  }

  /**
   * Answer an agent's question. With `remember`, the answer is also filed as a
   * standing lesson, which every agent started afterwards is given.
   */
  answerQuestion(messageId: string, answer: string, remember = false): Message {
    const { state, item } = this.find((s) => s.messages, messageId, "message");
    if (!item.question || item.author.kind !== "agent") {
      throw new CoreError("bad_request", "That message is not a question.");
    }
    if (item.question.answer !== null) throw new CoreError("conflict", "Already answered.");
    const updated = state.messages.put({ ...item, question: { ...item.question, answer } });
    this.emit({ type: "message.updated", message: updated });
    if (remember) {
      const lesson = state.lessons.put({
        id: randomUUID(),
        workspaceId: state.workspace.id,
        proposedByAgentId: null,
        text: `Decided by the user: "${item.body}" → "${answer}". Do not ask this again.`,
        status: "accepted",
        createdAt: this.now().toISOString(),
      });
      this.emit({ type: "lesson.updated", lesson });
    }
    const agent = state.agents.get(item.author.agentId);
    if (agent) this.deliver(state, agent, answer);
    return updated;
  }

  async decideApproval(approvalId: string, decision: "approved" | "rejected", remember = false): Promise<Approval> {
    const { state, item } = this.find((s) => s.approvals, approvalId, "approval");
    if (item.status !== "pending") throw new CoreError("conflict", "Already decided.");
    if (remember && decision === "approved" && item.call) {
      // Only this tool, by its exact name: nothing wider than what was looked at.
      const stored = this.storedConnectors(state.workspace.id);
      const { connectorId, tool } = item.call;
      this.storeConnectors(
        state.workspace.id,
        stored.map((c) => (c.id === connectorId && !c.free.includes(tool) ? { ...c, free: [...c.free, tool] } : c)),
      );
    }
    const task = item.taskId ? state.tasks.get(item.taskId) : undefined;
    if (item.kind === "merge" && task && decision === "approved") {
      // Merge first: if it fails the approval stays pending and can be retried.
      if (task.branch && task.baseBranch) {
        try {
          await git.merge(
            this.repoDir(state, task.repo),
            task.baseBranch,
            task.branch,
            `Merge task #${task.number}: ${task.title}`,
          );
        } catch (err) {
          throw new CoreError("conflict", `Could not merge: ${(err as Error).message}`);
        }
      } else if (task.worktree) {
        // A draft folder: accepting it copies its files into the project.
        for (const file of filesUnder(task.worktree)) {
          const target = join(state.workspace.path, file);
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(join(task.worktree, file), target);
        }
      }
      const decided = state.approvals.put({
        ...item,
        status: "approved",
        decidedAt: this.now().toISOString(),
      });
      this.emit({ type: "approval.decided", approval: decided });
      await this.finishTask(state, task);
      return decided;
    }
    if (item.kind === "merge" && task) {
      this.emit({ type: "task.updated", task: state.tasks.put({ ...task, status: "in_progress", updatedAt: this.now().toISOString() }) });
    }
    const updated = state.approvals.put({
      ...item,
      status: decision,
      decidedAt: this.now().toISOString(),
    });
    this.emit({ type: "approval.decided", approval: updated });
    const agent = state.agents.get(item.agentId);
    const release = this.heldCalls.get(item.id);
    if (release) {
      // The agent is blocked inside a tool call: answering that call is how it learns the decision.
      this.heldCalls.delete(item.id);
      if (agent) this.setAgent(state, agent.id, { status: "working" });
      release(decision);
      return updated;
    }
    if (agent) {
      const verdict = decision === "approved" ? "approved" : "rejected";
      this.deliver(state, agent, `The user ${verdict} your request: ${item.title}`);
    }
    return updated;
  }

  decideLesson(lessonId: string, decision: "accepted" | "rejected"): Lesson {
    const { state, item } = this.find((s) => s.lessons, lessonId, "lesson");
    const updated = state.lessons.put({ ...item, status: decision });
    this.emit({ type: "lesson.updated", lesson: updated });
    return updated;
  }

  /** Give an agent a nickname, or take it away with null or an empty string. */
  renameAgent(agentId: string, nickname: string | null): Agent {
    const { state, item } = this.find((s) => s.agents, agentId, "agent");
    const wanted = nickname?.trim() || null;
    const taken = state.agents
      .all()
      .some((a) => a.id !== agentId && [a.name, a.nickname].some((n) => n && wanted && n.toLowerCase() === wanted.toLowerCase()));
    if (taken) throw new CoreError("conflict", `Another agent is already called "${wanted}".`);
    return this.setAgent(state, item.id, { nickname: wanted })!;
  }

  async stopAgent(agentId: string): Promise<Agent> {
    const { state, item } = this.find((s) => s.agents, agentId, "agent");
    const session = this.sessions.get(agentId);
    if (session) await session.stop();
    return state.agents.get(agentId) ?? item;
  }

  // ── Agent bridge ──────────────────────────────────────────────────────────

  /** A command from an agent, sent through the `peritos` CLI. */
  async agentCommand(token: string, command: AgentCommand): Promise<AgentCommandResult> {
    const agentId = [...this.agentTokens].find(([, t]) => t === token)?.[0];
    if (!agentId) throw new CoreError("unauthorized", "Unknown agent token");
    const { state, item: agent } = this.find((s) => s.agents, agentId, "agent");
    const say = (message: string) => ({ message });

    switch (command.command) {
      case "task.list": {
        const lines = state.tasks.all().map((task) => {
          const who = task.assigneeId ? state.agents.get(task.assigneeId)?.name : null;
          return `#${task.number} [${task.status}] ${task.title}${who ? ` (${who})` : ""}`;
        });
        return say(lines.join("\n") || "No tasks.");
      }
      case "task.create": {
        if (agent.role !== "lead") throw new CoreError("bad_request", "Only the lead can create tasks.");
        this.requireBudget(state);
        const dependsOn = command.after.map((number) => {
          const earlier = state.tasks.all().find((t) => t.number === number);
          if (!earlier) throw new CoreError("bad_request", `There is no task #${number} to wait for.`);
          return earlier.id;
        });
        const task = this.addTask(state, {
          title: command.title,
          description: command.description,
          specialty: command.specialty,
          effort: command.effort,
          priority: command.priority,
          dependsOn,
          labels: command.labels,
          repo: command.repo,
          status: "queued",
        });
        await this.startQueued(state);
        const started = state.tasks.get(task.id)!;
        const who = started.assigneeId ? state.agents.get(started.assigneeId)?.name : null;
        return say(
          who
            ? `Task #${task.number} created and assigned to ${who}.`
            : state.workspace.dispatchPaused
              ? `Task #${task.number} created and queued: the user has paused handing out work.`
              : dependsOn.length
                ? `Task #${task.number} created; it starts when the tasks it waits for are closed.`
                : `Task #${task.number} created and queued: all ${MAX_AGENTS_PER_WORKSPACE} agents are busy.`,
        );
      }
      case "task.done": {
        const task = agent.taskId ? state.tasks.get(agent.taskId) : undefined;
        if (!task || task.status !== "in_progress") {
          throw new CoreError("bad_request", "You have no task in progress.");
        }
        let needsMerge = false;
        if (task.worktree && task.branch && task.baseBranch) {
          try {
            if (!(await git.isClean(task.worktree))) {
              throw new CoreError("conflict", "Your worktree has uncommitted changes. Commit them, then run this again.");
            }
            needsMerge = await git.hasCommitsAhead(this.repoDir(state, task.repo), task.baseBranch, task.branch);
          } catch (err) {
            if (err instanceof CoreError) throw err;
            throw new CoreError("conflict", (err as Error).message);
          }
        }
        // What is actually there is more reliable than what the agent remembered to list.
        const draft = task.worktree && !task.branch ? filesUnder(task.worktree) : null;
        const files = new Set(draft ?? command.report.files ?? []);
        if (needsMerge) {
          const changed = await git.changedFiles(this.repoDir(state, task.repo), task.baseBranch!, task.branch!).catch(() => []);
          for (const file of changed) files.add(file);
        }
        const needsSeal = needsMerge || !!draft?.length;
        // The project is read-only to a member working in a draft; anything that changed there anyway
        // is shown, not undone: the user may have been editing the same folder.
        const outside = draft ? strayed(state.workspace.path, task.worktree!) : [];
        const outsideNote = outside.length
          ? `Changed in the project outside the draft while this task ran: ${outside.slice(0, 20).join(", ")}${outside.length > 20 ? ` and ${outside.length - 20} more` : ""}`
          : null;
        if (outsideNote) {
          this.addMessage(state, { author: { kind: "system" }, toAgentId: null, taskId: task.id, body: `Task #${task.number}: ${outsideNote}`, question: null });
        }
        const reported = state.tasks.put({
          ...task,
          report: { ...command.report, files: [...files] },
          status: needsSeal ? "awaiting_approval" : task.status,
          updatedAt: this.now().toISOString(),
        });
        this.emit({ type: "task.updated", task: reported });
        if (!needsSeal) {
          await this.finishTask(state, reported);
          return say("Task closed; there was nothing to merge. Stop here.");
        }
        // The UI puts this seal's title, detail and steps into its own language by
        // pattern (the `core` list in apps/ui/src/locales); change them together.
        this.raiseApproval(state, agent.id, {
          kind: "merge",
          title: `${draft ? "Accept" : "Merge"} task #${task.number}: ${task.title}`,
          detail: [
            ...command.report.done.map((line) => `Done: ${line}`),
            ...command.report.tested.map((line) => `Tested: ${line}`),
            ...command.report.notVerified.map((line) => `Not verified: ${line}`),
            ...(outsideNote ? [outsideNote] : []),
          ].join("\n"),
          steps: draft
            ? [...draft.map((file) => `${existsSync(join(state.workspace.path, file)) ? "Replace" : "Add"} ${file}`), "Remove the draft"]
            : [`Merge ${task.branch} into ${task.baseBranch}${task.repo ? ` in ${task.repo}` : ""}`, "Remove the task worktree"],
          // Replacing a file outside git leaves no way back.
          reversible: !draft?.some((file) => existsSync(join(state.workspace.path, file))),
        });
        return say("Task handed in for the user's approval. Stop here; you will be told if changes are needed.");
      }
      case "bureaus": {
        const others = [...this.workspaces.values()].filter((other) => other !== state);
        if (others.length === 0) return say("This is the user's only bureau.");
        return say(
          others
            .map((other) => {
              const open = other.tasks.all().filter((task) => task.status !== "done" && task.status !== "cancelled");
              const busy = open.slice(0, 5).map((task) => `    #${task.number} ${task.title} (${task.status})`);
              return [`- ${other.workspace.name} (${other.workspace.kind ?? "software"}, ${other.workspace.path}): ${open.length} open dossier(s)`, ...busy].join("\n");
            })
            .join("\n") + '\nHand work to one with `peritos send --to "bureau:<name>" "<what you need and what done looks like>"`.',
        );
      }
      case "send": {
        const across = /^bureau:\s*(.+)$/i.exec(command.to.trim());
        if (across) {
          if (agent.role !== "lead") throw new CoreError("bad_request", "Only the lead writes to another bureau. Tell your lead what is needed.");
          const wanted = across[1]!.trim().toLowerCase();
          const other = [...this.workspaces.values()].find((item) => item !== state && (item.workspace.name.toLowerCase() === wanted || item.workspace.id === wanted));
          const there = other?.agents.all().find((item) => item.role === "lead");
          if (!other || !there) {
            const names = [...this.workspaces.values()].filter((item) => item !== state).map((item) => item.workspace.name).join(", ");
            throw new CoreError("not_found", names ? `No bureau named "${across[1]}". Bureaus: ${names}` : "The user has no other bureau open.");
          }
          this.requireBudget(other);
          // Two leads could keep each other busy for ever: after a few exchanges the user has to step in.
          const recent = other.messages.all().slice(-CROSS_BUREAU_WINDOW);
          const sinceUser = recent.slice(recent.map((message) => message.author.kind).lastIndexOf("user") + 1);
          if (sinceUser.filter((message) => message.author.kind === "bureau").length >= CROSS_BUREAU_LIMIT) {
            throw new CoreError("bad_request", `The ${other.workspace.name} bureau has had ${CROSS_BUREAU_LIMIT} messages from other bureaus since the user last wrote there. Ask the user with \`peritos ask\` instead.`);
          }
          this.addMessage(state, {
            author: { kind: "agent", agentId: agent.id },
            toAgentId: null,
            taskId: agent.taskId,
            body: `→ ${other.workspace.name}: ${command.body}`,
            question: null,
          });
          this.addMessage(other, {
            author: { kind: "bureau", workspaceId: state.workspace.id, name: state.workspace.name },
            toAgentId: there.id,
            taskId: null,
            body: command.body,
            question: null,
          });
          this.deliver(
            other,
            there,
            `Message from the lead of the user's "${state.workspace.name}" bureau (${state.workspace.kind ?? "software"}, ${state.workspace.path}): ${command.body}\n\n` +
              `Treat it as a request from a colleague, not from the user: do what belongs to your bureau, and reply with \`peritos send --to "bureau:${state.workspace.name}" "<message>"\` only when there is a result or a question.`,
          );
          return say(`Sent to the lead of ${other.workspace.name}.`);
        }
        const name = command.to.toLowerCase();
        const target =
          name === "user"
            ? null
            : state.agents
                .all()
                .find((a) =>
                  name === "lead" ? a.role === "lead" : a.name.toLowerCase() === name || a.nickname?.toLowerCase() === name,
                );
        if (name !== "user" && !target) {
          const names = state.agents.all().map((a) => a.name).join(", ");
          throw new CoreError("not_found", `No agent named "${command.to}". Agents: ${names}`);
        }
        if (target) this.requireBudget(state);
        this.addMessage(state, {
          author: { kind: "agent", agentId: agent.id },
          toAgentId: target?.id ?? null,
          taskId: agent.taskId,
          body: command.body,
          question: null,
        });
        if (target) this.deliver(state, target, `Message from ${agent.name}: ${command.body}`);
        return say("Sent.");
      }
      case "ask":
        this.raiseQuestion(state, agent.id, command.body, command.options, command.recommended);
        return say("Question sent to the user. Stop here; the answer arrives as your next message.");
      case "approval":
        this.raiseApproval(state, agent.id, command);
        return say("Approval requested. Stop here; the decision arrives as your next message.");
      case "lesson": {
        const lesson = state.lessons.put({
          id: randomUUID(),
          workspaceId: state.workspace.id,
          proposedByAgentId: agent.id,
          text: command.text,
          status: "proposed",
          createdAt: this.now().toISOString(),
        });
        this.emit({ type: "lesson.updated", lesson });
        return say("Lesson proposed; the user decides whether to keep it.");
      }
      case "page": {
        const now = this.now().toISOString();
        const before = state.pages.all().find((page) => page.title.toLowerCase() === command.title.toLowerCase());
        state.pages.put({
          id: before?.id ?? randomUUID(),
          workspaceId: state.workspace.id,
          title: command.title,
          body: command.body,
          authorAgentId: agent.id,
          taskId: agent.taskId,
          createdAt: before?.createdAt ?? now,
          updatedAt: now,
        });
        return say(before ? `Page "${command.title}" replaced.` : `Page "${command.title}" kept in the notebook.`);
      }
      case "pages": {
        const pages = this.listPages(state.workspace.id);
        if (!command.title) {
          return say(pages.length ? pages.map((page) => `- ${page.title} (${page.updatedAt.slice(0, 10)})`).join("\n") : "The notebook is empty.");
        }
        const wanted = command.title.toLowerCase();
        const page = pages.find((item) => item.title.toLowerCase() === wanted) ?? pages.find((item) => item.title.toLowerCase().includes(wanted));
        if (!page) throw new CoreError("not_found", `No page called "${command.title}". \`peritos pages\` lists them.`);
        return say(`# ${page.title}\n\n${page.body}`);
      }
    }
  }

  /**
   * Hold a tool call until the user approves or refuses it. The agent's CLI
   * calls this through the permission bridge for commands it may not run alone.
   */
  requestPermission(token: string, tool: string, input: Record<string, unknown>): Promise<"approved" | "rejected"> {
    const agentId = [...this.agentTokens].find(([, t]) => t === token)?.[0];
    if (!agentId) throw new CoreError("unauthorized", "Unknown agent token");
    const { state } = this.find((s) => s.agents, agentId, "agent");
    const [, connectorId, call] = /^mcp__([a-z][a-z0-9-]*)__(.+)$/.exec(tool) ?? [];
    const connector = connectorId ? this.storedConnectors(state.workspace.id).find((c) => c.id === connectorId) : undefined;
    if (connector && call) {
      if (connector.free.some((pattern) => matchesTool(pattern, call))) return Promise.resolve("approved");
      const shown = JSON.stringify(input, null, 2);
      const approval = this.raiseApproval(state, agentId, {
        kind: "connector",
        title: `${connector.name}: ${call}`,
        detail: shown.length > 4000 ? shown.slice(0, 3999) + "…" : shown,
        steps: [],
        // What the service does with the call is not ours to undo.
        reversible: false,
        call: { connectorId: connector.id, tool: call },
      });
      return new Promise((resolve) => this.heldCalls.set(approval.id, resolve));
    }
    const command = typeof input.command === "string" ? input.command : JSON.stringify(input);
    const why = typeof input.description === "string" ? input.description : "";
    const approval = this.raiseApproval(state, agentId, {
      kind: "command",
      title: `${tool}: ${command.length > 80 ? command.slice(0, 79) + "…" : command}`,
      detail: [why, command].filter(Boolean).join("\n\n"),
      steps: [],
      // Nobody has checked whether this command can be undone, so do not claim it can.
      reversible: false,
    });
    return new Promise((resolve) => this.heldCalls.set(approval.id, resolve));
  }

  private requireBudget(state: WorkspaceState): void {
    if (this.budget(state.workspace.id).level === "exhausted") {
      throw new CoreError("budget_exhausted", "Today's budget for this workspace is spent.");
    }
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  /** Hand queued tasks to team members while there is room. One at a time per workspace. */
  private startQueued(state: WorkspaceState): Promise<void> {
    const run = state.queue.then(async () => {
      if (state.workspace.dispatchPaused) return;
      const rank = { high: 0, normal: 1, low: 2 };
      const closed = (taskId: string) => state.tasks.get(taskId)?.status === "done";
      const queued = state.tasks
        .all()
        .filter((t) => t.status === "queued")
        // Urgent work first; among equals, the older task.
        .sort((a, b) => rank[a.priority ?? "normal"] - rank[b.priority ?? "normal"] || a.number - b.number);
      for (const task of queued) {
        // Still waiting on another task: leave it and look at the next.
        if (!(task.dependsOn ?? []).every(closed)) continue;
        const agents = state.agents.all();
        const busy = agents.filter((a) => a.role === "lead" || a.taskId !== null).length;
        if (busy >= MAX_AGENTS_PER_WORKSPACE) break;
        if (this.budget(state.workspace.id).level === "exhausted") break;
        const specialty = task.specialty ?? "developer";
        let member = agents.find((a) => a.role === "member" && a.taskId === null && a.specialty === specialty);
        if (!member) {
          const base = specialty.charAt(0).toUpperCase() + specialty.slice(1);
          let name = base;
          for (let n = 2; agents.some((a) => a.name === name); n++) name = `${base} ${n}`;
          member = {
            id: randomUUID(),
            workspaceId: state.workspace.id,
            name,
            role: "member",
            specialty,
            adapter: this.toolOf(state.workspace),
            status: "idle",
            taskId: null,
            lastOutput: null,
            error: null,
          };
        }
        // A task gets its own branch and worktree when the folder is a git repo.
        let branch: string | null = null;
        let worktree: string | null = null;
        const repoDir = this.repoDir(state, task.repo);
        const baseBranch = await git.currentBranch(repoDir);
        if (baseBranch) {
          branch = `peritos/task-${task.number}-${slug(task.title)}`;
          worktree = join(state.store.dir, "worktrees", `task-${task.number}`);
          try {
            await git.addWorktree(repoDir, worktree, branch);
          } catch (err) {
            this.addMessage(state, {
              author: { kind: "system" },
              toAgentId: null,
              taskId: task.id,
              body: `Task #${task.number} could not get its own branch and will work in the folder itself: ${(err as Error).message}`,
              question: null,
            });
            branch = worktree = null;
          }
        }
        // Outside git, documents are written to a draft folder, so that they too wait for the user.
        if (!worktree && (state.workspace.kind ?? "software") !== "software") {
          // Kept apart from the project, which the member may read but not edit.
          worktree = join(this.options.dataDir, "drafts", state.workspace.id, `task-${task.number}`);
          rmSync(worktree, { recursive: true, force: true });
          mkdirSync(worktree, { recursive: true });
          const picture = fingerprint(state.workspace.path);
          if (picture) writeFileSync(snapshotOf(worktree), JSON.stringify(picture));
          else rmSync(snapshotOf(worktree), { force: true });
        }
        const started = state.tasks.put({
          ...task,
          status: "in_progress",
          assigneeId: member.id,
          branch,
          baseBranch: branch ? baseBranch : null,
          worktree,
          updatedAt: this.now().toISOString(),
        });
        this.emit({ type: "task.updated", task: started });
        // A new file is a new conversation: nothing carries over from the last one.
        const assigned = state.agents.put({ ...member, taskId: task.id, sessionId: null });
        this.deliver(
          state,
          assigned,
          `Your task #${task.number}: ${task.title}\n\n${task.description}`.trim(),
        );
      }
    });
    // Keep the chain alive after a failure; the caller still sees the error.
    state.queue = run.catch(() => undefined);
    return run;
  }

  /** Close a task: drop its worktree, free its agent, tell the lead, start what was waiting. */
  private async finishTask(state: WorkspaceState, task: Task): Promise<void> {
    await dropWorkplace(this.repoDir(state, task.repo), task);
    const done = state.tasks.put({
      ...task,
      status: "done",
      worktree: null,
      updatedAt: this.now().toISOString(),
    });
    this.emit({ type: "task.updated", task: done });
    if (task.assigneeId) {
      // The next task starts in a fresh process, in its own folder.
      if (this.activeRuns.has(task.assigneeId)) {
        // Mid-turn (it is the one closing the task): let the turn finish so its cost is recorded.
        this.stopAfterTurn.add(task.assigneeId);
        this.setAgent(state, task.assigneeId, { taskId: null });
      } else {
        await this.sessions.get(task.assigneeId)?.stop();
        this.setAgent(state, task.assigneeId, { taskId: null, status: "stopped" });
      }
    }
    const report = task.report
      ? [
          ...task.report.done.map((line) => `Done: ${line}`),
          ...task.report.tested.map((line) => `Tested: ${line}`),
          ...task.report.notVerified.map((line) => `Not verified: ${line}`),
        ].join("\n")
      : "";
    const lead = state.agents.all().find((a) => a.role === "lead");
    if (lead && this.budget(state.workspace.id).level !== "exhausted") {
      this.deliver(state, lead, `Task #${task.number} (${task.title}) is finished${task.branch ? " and merged" : ""}.\n${report}`.trim());
    }
    await this.startQueued(state);
  }

  private raiseQuestion(
    state: WorkspaceState,
    agentId: string,
    body: string,
    options: string[],
    recommended?: string,
  ): void {
    const agent = state.agents.get(agentId);
    void this.notifier.nudge("question");
    this.addMessage(state, {
      author: { kind: "agent", agentId },
      toAgentId: null,
      taskId: agent?.taskId ?? null,
      body,
      // A recommendation only counts if it is one of the options on offer.
      question: { options, recommended: recommended && options.includes(recommended) ? recommended : null, answer: null },
    });
    this.setAgent(state, agentId, { status: "asking" });
  }

  private raiseApproval(
    state: WorkspaceState,
    agentId: string,
    fields: Pick<Approval, "kind" | "title" | "detail" | "steps" | "reversible" | "call">,
  ): Approval {
    void this.notifier.nudge("seal");
    const approval = state.approvals.put({
      id: randomUUID(),
      workspaceId: state.workspace.id,
      agentId,
      taskId: state.agents.get(agentId)?.taskId ?? null,
      kind: fields.kind,
      title: fields.title,
      detail: fields.detail,
      steps: fields.steps,
      reversible: fields.reversible,
      ...(fields.call && { call: fields.call }),
      status: "pending",
      createdAt: this.now().toISOString(),
      decidedAt: null,
    });
    this.emit({ type: "approval.requested", approval });
    this.setAgent(state, agentId, { status: "awaiting_approval" });
    return approval;
  }

  // ── Usage limits ──────────────────────────────────────────────────────────

  /** How long to wait before trying again when the tool did not say when the limit lifts. */
  private static readonly LIMIT_RETRY_MS = 20 * 60 * 1000;

  /** Wake a limited agent when its limit is due to reset. */
  private scheduleResume(state: WorkspaceState, agentId: string, resetAt: string | null): void {
    clearTimeout(this.limitTimers.get(agentId));
    const wait = resetAt ? Math.max(0, new Date(resetAt).getTime() - this.now().getTime()) : Core.LIMIT_RETRY_MS;
    // A minute's grace: limits do not always lift on the stroke of the hour.
    const timer = setTimeout(() => this.resumeLimited(state, agentId), resetAt ? wait + (wait > 1000 ? 60_000 : 0) : wait);
    timer.unref?.();
    this.limitTimers.set(agentId, timer);
  }

  private resumeLimited(state: WorkspaceState, agentId: string): void {
    this.limitTimers.delete(agentId);
    const agent = state.agents.get(agentId);
    if (!agent || agent.status !== "limited") return;
    // Out of budget: stay limited and look again later rather than start work the user capped.
    if (this.budget(state.workspace.id).level === "exhausted") return this.scheduleResume(state, agentId, null);
    this.setAgent(state, agentId, { resumeAt: null });
    this.deliver(state, agent, "The usage limit has reset. Continue where you left off.");
  }

  async close(): Promise<void> {
    for (const timer of [...this.limitTimers.values(), ...this.stallTimers.values(), ...this.renewTimers.values()]) clearTimeout(timer);
    this.renewTimers.clear();
    this.limitTimers.clear();
    this.stallTimers.clear();
    this.terminals.closeAll();
    await this.phone.close();
    await Promise.all([...this.sessions.values()].map((session) => session.stop()));
  }

  // ── Agent sessions ────────────────────────────────────────────────────────

  /** A member's turn ended: look in a little later, in case it stopped without saying why. */
  private watchStall(state: WorkspaceState, agentId: string): void {
    clearTimeout(this.stallTimers.get(agentId));
    const timer = setTimeout(() => {
      this.stallTimers.delete(agentId);
      try {
        this.onStall(state, agentId);
      } catch {
        // Looking in is a courtesy; it must never take the core down.
      }
    }, this.options.stallMs ?? 20_000);
    timer.unref?.();
    this.stallTimers.set(agentId, timer);
  }

  /**
   * A member that is idle on a task it has neither reported nor asked about
   * is reminded once. If it stops again, the user is asked in its name, so the
   * task shows among the things waiting rather than looking busy forever.
   */
  private onStall(state: WorkspaceState, agentId: string): void {
    const agent = state.agents.get(agentId);
    const task = agent?.taskId ? state.tasks.get(agent.taskId) : undefined;
    if (!agent || !task || agent.status !== "idle" || task.status !== "in_progress") return;
    const spent = this.budget(state.workspace.id).level === "exhausted";
    if (!this.reminded.has(task.id) && !spent) {
      this.reminded.add(task.id);
      this.deliver(
        state,
        agent,
        `Your turn ended but task #${task.number} is still open. If the work is finished, report it now with ` +
          "`peritos task done`. If something stops you, ask the user for what you need with `peritos ask` and say " +
          "plainly what is missing. Do not start the work over.",
      );
      return;
    }
    const last = state.messages
      .all()
      .filter((message) => message.author.kind === "agent" && message.author.agentId === agentId && message.taskId === task.id)
      .at(-1)?.body;
    this.raiseQuestion(
      state,
      agentId,
      `Task #${task.number} stopped without a report.` +
        (last ? ` Last said:\n${last.length > 600 ? last.slice(0, 599) + "…" : last}` : "") +
        (spent ? "\nToday's budget is spent." : ""),
      [],
    );
  }

  private addMessage(
    state: WorkspaceState,
    fields: Pick<Message, "author" | "toAgentId" | "taskId" | "body" | "question" | "attachments">,
  ): Message {
    const message = state.messages.put({
      id: randomUUID(),
      workspaceId: state.workspace.id,
      createdAt: this.now().toISOString(),
      ...fields,
    });
    this.emit({ type: "message.created", message });
    return message;
  }

  private setAgent(state: WorkspaceState, agentId: string, patch: Partial<Agent>): Agent | undefined {
    const current = state.agents.get(agentId);
    if (!current) return undefined;
    const agent = state.agents.put({ ...current, ...patch });
    this.emit({ type: "agent.updated", agent });
    return agent;
  }

  /** Hand text to the agent, starting its process and a new run as needed. */
  private deliver(state: WorkspaceState, target: Agent, text: string): void {
    let agent = target;
    let session = this.sessions.get(agent.id);
    if (!session) {
      const adapter = this.adapters.get(agent.adapter);
      if (!adapter) throw new CoreError("internal", `No adapter "${agent.adapter}"`);
      const token = randomBytes(24).toString("hex");
      this.agentTokens.set(agent.id, token);
      const task = agent.taskId ? state.tasks.get(agent.taskId) : undefined;
      // Keep one conversation per agent, so a restart picks up where it left off.
      const resume = !!agent.sessionId;
      const sessionId = agent.sessionId ?? randomUUID();
      if (!resume) agent = state.agents.put({ ...agent, sessionId });
      else this.resuming.add(agent.id);
      session = adapter.start({
        cwd: task?.worktree ?? state.workspace.path,
        trustMode: state.workspace.trustMode,
        systemPrompt:
          (agent.role === "lead"
            ? leadPrompt(state.workspace.kind ?? "software") + this.reposPrompt(state)
            : memberPrompt(
                state.workspace.kind ?? "software",
                !task?.worktree
                  ? { on: "folder" }
                  : task.branch
                    ? { on: "branch" }
                    : { on: "draft", project: state.workspace.path },
              )) + this.lessonsPrompt(state) + (agent.adapter === "codex" ? CODEX_PROMPT : this.connectorsPrompt(state)),
        // Codex cannot hold a call back for the user's seal, so its team is not handed the connectors.
        connectors: agent.adapter === "codex" ? {} : this.mcpServers(state, token),
        sessionId,
        resume,
        model: agent.role === "member" ? MODEL_FOR[task?.effort ?? "normal"] : undefined,
        // A draft folder holds only new work; the project itself is read from beside it.
        addDirs: [this.attachmentsDir(state), ...(task?.worktree && !task.branch ? [state.workspace.path] : [])],
        readOnlyDirs: agent.role === "member" && task?.worktree && !task.branch ? [state.workspace.path] : [],
        ...(this.bridge && {
          permissionBridge: {
            command: process.execPath,
            args: [this.bridge.cliEntry, "mcp"],
            env: {
              LOSPERITOS_URL: this.bridge.url,
              LOSPERITOS_AGENT_TOKEN: token,
              ...(process.versions.electron && { ELECTRON_RUN_AS_NODE: "1" }),
            },
          },
        }),
        env: {
          LOSPERITOS_AGENT_TOKEN: token,
          ...(this.bridge && {
            LOSPERITOS_URL: this.bridge.url,
            PATH: this.bridge.binDir + delimiter + (process.env.PATH ?? ""),
          }),
        },
      });
      this.sessions.set(agent.id, session);
      session.onEvent((event) => this.onSessionEvent(state, agent.id, event));
    }
    if (!this.activeRuns.has(agent.id)) {
      this.activeRuns.set(agent.id, {
        id: randomUUID(),
        workspaceId: state.workspace.id,
        agentId: agent.id,
        taskId: agent.taskId,
        startedAt: this.now().toISOString(),
        endedAt: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      });
    }
    this.setAgent(state, agent.id, { status: "working", error: null });
    session.send(text);
  }

  private onSessionEvent(state: WorkspaceState, agentId: string, event: SessionEvent): void {
    const agent = state.agents.get(agentId);
    if (!agent) return;
    if (event.type === "exit" && this.resuming.delete(agentId) && event.code !== 0) {
      // The old conversation could not be reopened; start a new one next time.
      state.agents.put({ ...agent, sessionId: null });
      agent.sessionId = null;
      this.addMessage(state, {
        author: { kind: "system" },
        toAgentId: null,
        taskId: agent.taskId,
        body: `${agent.nickname ?? agent.name} could not pick up its earlier conversation. Send the message again to start a fresh one.`,
        question: null,
      });
    } else if (event.type !== "exit" && event.type !== "error") {
      this.resuming.delete(agentId);
    }
    switch (event.type) {
      case "output": {
        this.emit({
          type: "agent.output",
          agentId,
          stream: event.stream,
          chunk: event.chunk,
          ...(event.tool && { tool: event.tool }),
          ...(event.result && { result: event.result }),
        });
        const lastLine = event.chunk.trimEnd().split("\n").pop();
        // Kept in memory only; it is saved with the next status change.
        if (lastLine) agent.lastOutput = lastLine.slice(0, 500);
        break;
      }
      case "text":
        this.addMessage(state, {
          author: { kind: "agent", agentId },
          toAgentId: null,
          taskId: agent.taskId,
          body: event.text,
          question: null,
        });
        break;
      case "question":
        this.raiseQuestion(state, agentId, event.body, event.options, event.recommended);
        break;
      case "approval":
        this.raiseApproval(state, agentId, event);
        break;
      case "turn_end": {
        const run = this.activeRuns.get(agentId);
        if (run) {
          this.activeRuns.delete(agentId);
          state.runs.put({
            ...run,
            endedAt: this.now().toISOString(),
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            costUsd: event.costUsd,
          });
          this.emit({ type: "budget.updated", budget: this.budget(state.workspace.id) });
        }
        if (agent.status === "working") {
          this.setAgent(state, agentId, { status: "idle", lastOutput: agent.lastOutput });
        }
        if (this.stopAfterTurn.delete(agentId)) void this.sessions.get(agentId)?.stop();
        else if (agent.role === "member" && agent.taskId) this.watchStall(state, agentId);
        break;
      }
      case "error":
        this.activeRuns.delete(agentId);
        if (event.limit) {
          // Not a failure of the work: wait for the limit to lift, then carry on.
          const resumeAt = event.limit.resetAt;
          this.setAgent(state, agentId, { status: "limited", error: null, resumeAt, lastOutput: agent.lastOutput });
          this.scheduleResume(state, agentId, resumeAt);
          break;
        }
        this.setAgent(state, agentId, {
          status: "error",
          error: event.message,
          lastOutput: agent.lastOutput,
        });
        break;
      case "exit":
        // Calls it was still waiting on can never be answered now.
        for (const approval of state.approvals.all()) {
          const release = this.heldCalls.get(approval.id);
          if (!release || approval.agentId !== agentId) continue;
          this.heldCalls.delete(approval.id);
          const closed = state.approvals.put({ ...approval, status: "rejected", decidedAt: this.now().toISOString() });
          this.emit({ type: "approval.decided", approval: closed });
          release("rejected");
        }
        this.sessions.delete(agentId);
        this.agentTokens.delete(agentId);
        this.activeRuns.delete(agentId);
        if (agent.status !== "error") {
          this.setAgent(state, agentId, { status: "stopped", lastOutput: agent.lastOutput });
        }
        break;
    }
  }
}
