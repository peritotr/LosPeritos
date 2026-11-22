import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, join, resolve } from "node:path";
import type {
  Agent,
  AgentAdapter,
  AgentCommand,
  AgentCommandResult,
  ApiError,
  Approval,
  BudgetState,
  Event,
  EventEnvelope,
  Lesson,
  Message,
  Run,
  Task,
  ToolCheck,
  Waiting,
  Workspace,
} from "@losperitos/protocol";
import { MAX_AGENTS_PER_WORKSPACE, PROTOCOL_VERSION } from "@losperitos/protocol";
import * as git from "@losperitos/git";
import { AppStore, WorkspaceStore, type Collection } from "@losperitos/storage";
import type { Adapter, AgentSession, SessionEvent } from "@losperitos/adapters";

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
}

interface WorkspaceState {
  workspace: Workspace;
  store: WorkspaceStore;
  agents: Collection<Agent>;
  tasks: Collection<Task>;
  messages: Collection<Message>;
  approvals: Collection<Approval>;
  lessons: Collection<Lesson>;
  runs: Collection<Run>;
  /** Tail of the chain that serialises task starts in this workspace. */
  queue: Promise<void>;
}

const BRIDGE_PROMPT =
  "You talk to the team and the user through the `peritos` command in your shell:\n" +
  "- `peritos ask \"<question>\" --option A --option B\` asks the user; then stop and wait for the answer.\n" +
  "- `peritos approval --title \"<what>\" --kind deploy|command|other --detail \"<why>\" --step \"<step>\"` " +
  "requests the user's approval before anything that deploys, publishes, deletes data or cannot be undone; then stop and wait.\n" +
  "- `peritos send --to <agent name|lead|user> \"<message>\"` messages a teammate.\n" +
  "- `peritos lesson \"<rule>\"` proposes a lasting rule for this project.\n" +
  "- `peritos task list` shows all tasks.\n";

const LEAD_PROMPT =
  "You are the lead of a small team of coding agents working in this folder. " +
  "Small jobs you do yourself. Larger jobs you split into independent tasks and hand out with " +
  "`peritos task create --title \"<title>\" --description \"<everything the teammate needs>\" --specialty <developer|tester|designer|...>`. " +
  "Each task goes to a teammate who works on a separate git branch and cannot see this conversation, " +
  "so make every description self-contained and keep tasks from touching the same files. " +
  "After handing out tasks, stop; you are told when each one is merged. " +
  "Never merge or push branches yourself.\n" +
  BRIDGE_PROMPT;

const MEMBER_PROMPT =
  "You are a member of a small team of coding agents. You work on one task, in your own git " +
  "worktree and branch; stay inside this folder. When the task is finished, commit your changes and run " +
  "`peritos task done --done \"<what you did>\" --tested \"<what you tested>\" --not-verified \"<what you could not verify>\"` " +
  "(repeat a flag for several items), then stop. Never merge, push or switch branches.\n" +
  BRIDGE_PROMPT;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "task";
}

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
  private bridge: { url: string; binDir: string } | null = null;
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
    this.bridge = { url, binDir };
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
    return Promise.all([git, lead.check()]);
  }

  // ── Workspaces ────────────────────────────────────────────────────────────

  listWorkspaces(): Workspace[] {
    return [...this.workspaces.values()].map((state) => state.workspace);
  }

  openWorkspace(path: string): Workspace {
    const full = resolve(path);
    if (!existsSync(full) || !statSync(full).isDirectory()) {
      throw new CoreError("bad_request", `Not a folder: ${full}`);
    }
    const existing = [...this.workspaces.values()].find((s) => s.workspace.path === full);
    if (existing) return existing.workspace;
    const state = this.load(full);
    this.app.addWorkspacePath(full);
    this.emit({ type: "workspace.updated", workspace: state.workspace });
    return state.workspace;
  }

  updateWorkspace(
    workspaceId: string,
    patch: Partial<Pick<Workspace, "name" | "trustMode" | "dailyBudgetUsd">>,
  ): Workspace {
    const state = this.state(workspaceId);
    state.workspace = { ...state.workspace, ...patch };
    state.store.writeDoc("workspace", state.workspace);
    this.emit({ type: "workspace.updated", workspace: state.workspace });
    this.emit({ type: "budget.updated", budget: this.budget(workspaceId) });
    return state.workspace;
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
      runs: store.collection("runs"),
      queue: Promise.resolve(),
    };
    // No process survives a restart, so nobody can still be mid-turn.
    for (const agent of state.agents.all()) {
      const adapter = agent.role === "lead" ? this.options.leadAdapter : agent.adapter;
      const status = agent.status === "working" ? "idle" : agent.status;
      if (adapter !== agent.adapter || status !== agent.status) {
        state.agents.put({ ...agent, adapter, status });
      }
    }
    if (!state.agents.all().some((agent) => agent.role === "lead")) {
      state.agents.put({
        id: randomUUID(),
        workspaceId: workspace.id,
        name: "Lead",
        role: "lead",
        specialty: null,
        adapter: this.options.leadAdapter,
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
      return await git.diff(state.workspace.path, item.baseBranch, item.branch);
    } catch (err) {
      throw new CoreError("conflict", (err as Error).message);
    }
  }

  listMessages(workspaceId: string): Message[] {
    return this.state(workspaceId).messages.all();
  }

  listApprovals(workspaceId: string): Approval[] {
    return this.state(workspaceId).approvals.all();
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
    request: { body: string; toAgentId: string | null; taskId: string | null },
  ): Message {
    const state = this.state(workspaceId);
    const agent = request.toAgentId
      ? state.agents.get(request.toAgentId)
      : state.agents.all().find((a) => a.role === "lead");
    if (!agent) throw new CoreError("not_found", `No agent ${request.toAgentId}`);
    if (this.budget(workspaceId).level === "exhausted") {
      throw new CoreError("budget_exhausted", "Today's budget for this workspace is spent.");
    }
    const message = this.addMessage(state, {
      author: { kind: "user" },
      toAgentId: agent.id,
      taskId: request.taskId,
      body: request.body,
      question: null,
    });
    this.deliver(state, agent, request.body);
    return message;
  }

  answerQuestion(messageId: string, answer: string): Message {
    const { state, item } = this.find((s) => s.messages, messageId, "message");
    if (!item.question || item.author.kind !== "agent") {
      throw new CoreError("bad_request", "That message is not a question.");
    }
    if (item.question.answer !== null) throw new CoreError("conflict", "Already answered.");
    const updated = state.messages.put({ ...item, question: { ...item.question, answer } });
    this.emit({ type: "message.updated", message: updated });
    const agent = state.agents.get(item.author.agentId);
    if (agent) this.deliver(state, agent, answer);
    return updated;
  }

  async decideApproval(approvalId: string, decision: "approved" | "rejected"): Promise<Approval> {
    const { state, item } = this.find((s) => s.approvals, approvalId, "approval");
    if (item.status !== "pending") throw new CoreError("conflict", "Already decided.");
    const task = item.taskId ? state.tasks.get(item.taskId) : undefined;
    if (item.kind === "merge" && task && decision === "approved") {
      // Merge first: if it fails the approval stays pending and can be retried.
      if (task.branch && task.baseBranch) {
        try {
          await git.merge(
            state.workspace.path,
            task.baseBranch,
            task.branch,
            `Merge task #${task.number}: ${task.title}`,
          );
        } catch (err) {
          throw new CoreError("conflict", `Could not merge: ${(err as Error).message}`);
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
        const now = this.now().toISOString();
        const task = state.tasks.put({
          id: randomUUID(),
          workspaceId: state.workspace.id,
          number: Math.max(0, ...state.tasks.all().map((t) => t.number)) + 1,
          parentId: null,
          title: command.title,
          description: command.description,
          status: "queued",
          assigneeId: null,
          specialty: command.specialty,
          branch: null,
          baseBranch: null,
          worktree: null,
          report: null,
          createdAt: now,
          updatedAt: now,
        });
        this.emit({ type: "task.updated", task });
        await this.startQueued(state);
        const started = state.tasks.get(task.id)!;
        const who = started.assigneeId ? state.agents.get(started.assigneeId)?.name : null;
        return say(
          who
            ? `Task #${task.number} created and assigned to ${who}.`
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
            needsMerge = await git.hasCommitsAhead(state.workspace.path, task.baseBranch, task.branch);
          } catch (err) {
            if (err instanceof CoreError) throw err;
            throw new CoreError("conflict", (err as Error).message);
          }
        }
        const reported = state.tasks.put({
          ...task,
          report: command.report,
          status: needsMerge ? "awaiting_approval" : task.status,
          updatedAt: this.now().toISOString(),
        });
        this.emit({ type: "task.updated", task: reported });
        if (!needsMerge) {
          await this.finishTask(state, reported);
          return say("Task closed; there was nothing to merge. Stop here.");
        }
        this.raiseApproval(state, agent.id, {
          kind: "merge",
          title: `Merge task #${task.number}: ${task.title}`,
          detail: [
            ...command.report.done.map((line) => `Done: ${line}`),
            ...command.report.tested.map((line) => `Tested: ${line}`),
            ...command.report.notVerified.map((line) => `Not verified: ${line}`),
          ].join("\n"),
          steps: [`Merge ${task.branch} into ${task.baseBranch}`, "Remove the task worktree"],
          reversible: true,
        });
        return say("Task handed in for the user's approval. Stop here; you will be told if changes are needed.");
      }
      case "send": {
        const name = command.to.toLowerCase();
        const target =
          name === "user"
            ? null
            : state.agents.all().find((a) => (name === "lead" ? a.role === "lead" : a.name.toLowerCase() === name));
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
        this.raiseQuestion(state, agent.id, command.body, command.options);
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
    }
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
      const queued = state.tasks.all().filter((t) => t.status === "queued").sort((a, b) => a.number - b.number);
      for (const task of queued) {
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
            adapter: this.options.leadAdapter,
            status: "idle",
            taskId: null,
            lastOutput: null,
            error: null,
          };
        }
        // A task gets its own branch and worktree when the folder is a git repo.
        let branch: string | null = null;
        let worktree: string | null = null;
        const baseBranch = await git.currentBranch(state.workspace.path);
        if (baseBranch) {
          branch = `peritos/task-${task.number}-${slug(task.title)}`;
          worktree = join(state.store.dir, "worktrees", `task-${task.number}`);
          try {
            await git.addWorktree(state.workspace.path, worktree, branch);
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
        const assigned = state.agents.put({ ...member, taskId: task.id });
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
    if (task.worktree) {
      await git.removeWorktree(state.workspace.path, task.worktree).catch(() => undefined);
    }
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

  private raiseQuestion(state: WorkspaceState, agentId: string, body: string, options: string[]): void {
    const agent = state.agents.get(agentId);
    this.addMessage(state, {
      author: { kind: "agent", agentId },
      toAgentId: null,
      taskId: agent?.taskId ?? null,
      body,
      question: { options, answer: null },
    });
    this.setAgent(state, agentId, { status: "asking" });
  }

  private raiseApproval(
    state: WorkspaceState,
    agentId: string,
    fields: Pick<Approval, "kind" | "title" | "detail" | "steps" | "reversible">,
  ): void {
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
      status: "pending",
      createdAt: this.now().toISOString(),
      decidedAt: null,
    });
    this.emit({ type: "approval.requested", approval });
    this.setAgent(state, agentId, { status: "awaiting_approval" });
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.stop()));
  }

  // ── Agent sessions ────────────────────────────────────────────────────────

  private addMessage(
    state: WorkspaceState,
    fields: Pick<Message, "author" | "toAgentId" | "taskId" | "body" | "question">,
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
  private deliver(state: WorkspaceState, agent: Agent, text: string): void {
    let session = this.sessions.get(agent.id);
    if (!session) {
      const adapter = this.adapters.get(agent.adapter);
      if (!adapter) throw new CoreError("internal", `No adapter "${agent.adapter}"`);
      const token = randomBytes(24).toString("hex");
      this.agentTokens.set(agent.id, token);
      const task = agent.taskId ? state.tasks.get(agent.taskId) : undefined;
      session = adapter.start({
        cwd: task?.worktree ?? state.workspace.path,
        trustMode: state.workspace.trustMode,
        systemPrompt: agent.role === "lead" ? LEAD_PROMPT : MEMBER_PROMPT,
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
    switch (event.type) {
      case "output": {
        this.emit({ type: "agent.output", agentId, stream: event.stream, chunk: event.chunk });
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
        this.raiseQuestion(state, agentId, event.body, event.options);
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
        break;
      }
      case "error":
        this.activeRuns.delete(agentId);
        this.setAgent(state, agentId, {
          status: "error",
          error: event.message,
          lastOutput: agent.lastOutput,
        });
        break;
      case "exit":
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
