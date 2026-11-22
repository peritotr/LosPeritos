import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CircleAlert,
  Columns3,
  CornerDownRight,
  FileDiff,
  FileText,
  FlaskConical,
  GitBranch,
  GripVertical,
  Inbox,
  List,
  PencilLine,
  Plus,
  Send,
  Square,
  Stamp as StampIcon,
  Terminal,
} from "lucide-react";
import type { Agent, Task } from "@losperitos/protocol";
import { Chat } from "./Chat";
import { SvgFloor } from "./floor/SvgFloor";
import { SpriteLayer } from "./floor/SpriteLayer";
import { buildFloor } from "./floor/model";
import { openQuestions, pendingApprovals, type Ctx } from "./context";
import { T } from "./strings";
import {
  AGENT_STATUS,
  Badge,
  Corners,
  Emblem,
  Empty,
  I,
  PageHead,
  Segmented,
  TASK_STATUS,
  ago,
  clock,
  fileRef,
  money,
  perito,
} from "./ui";

const MAX_SEATS = 8;

/** The lively floor with characters, furniture and the dogs (the default), or emblems only. */
type FloorStyle = "emblems" | "characters";
const FLOOR_STYLE_KEY = "losperitos.floorStyle";
function readFloorStyle(): FloorStyle {
  try {
    return localStorage.getItem(FLOOR_STYLE_KEY) === "emblems" ? "emblems" : "characters";
  } catch {
    return "characters";
  }
}

/** Activate a non-button element with Enter, as the design's cards and rows do. */
const onEnter = (run: () => void) => (event: KeyboardEvent) => {
  if (event.key === "Enter") run();
};

function spendOf(ctx: Ctx, agentId: string): number {
  return (ctx.state.runs[ctx.bureau.id] ?? []).filter((run) => run.agentId === agentId).reduce((sum, run) => sum + run.costUsd, 0);
}

// ── The Bench ──────────────────────────────────────────────────────────────

export function Bench(ctx: Ctx) {
  const { state, actions, bureau, agents, tasks } = ctx;
  const [brief, setBrief] = useState("");
  const [error, setError] = useState<string | null>(null);
  const waiting = pendingApprovals(ctx.approvals).length + openQuestions(ctx.messages).length;
  const spent = state.budgets[bureau.id]?.level === "exhausted";
  const demo = agents.some((agent) => agent.adapter === "fake");
  const atWork = agents.filter((agent) => agent.status === "working").length;
  const [floorStyle, setFloorStyle] = useState<FloorStyle>(readFloorStyle);
  const floor = buildFloor({
    agents,
    tasks,
    approvals: ctx.approvals,
    flights: state.flights.filter((flight) => flight.workspaceId === bureau.id),
    stamps: state.stamps.filter((stamp) => stamp.workspaceId === bureau.id),
    output: state.output,
  });

  const send = async (body: string) => {
    if (!body.trim()) return;
    setError(null);
    try {
      await actions.send(bureau.id, body.trim());
      setBrief("");
      ctx.note(T.bench.sent);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <PageHead kicker={T.bench.sheet(bureau.name)} title={T.bench.title}>
        {waiting > 0 && (
          <button className="btn btn-primary blueprint" onClick={() => ctx.go({ screen: "awaiting" })}>
            <Corners />
            <I icon={Inbox} />
            {T.bench.awaiting(waiting)}
          </button>
        )}
      </PageHead>

      <form
        className={`brief blueprint ${spent ? "spent" : ""}`}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send(brief);
        }}
      >
        <Corners />
        <Emblem role="lead" mono="BP" size={36} />
        <input
          className="input grow"
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder={T.bench.placeholder}
          aria-label={T.bench.briefLabel}
          disabled={spent}
        />
        <button className="btn btn-secondary" disabled={spent || !brief.trim()}>
          {T.bench.open}
          <I icon={ArrowRight} />
        </button>
        {demo && (
          <button type="button" className="btn btn-ghost" disabled={spent} onClick={() => send("/team")}>
            {T.bench.demo}
          </button>
        )}
      </form>
      {spent && (
        <p className="brief-note">
          <I icon={Ban} />
          <span>
            {T.bench.spent} <a onClick={() => ctx.go({ screen: "ledger" })}>{T.bench.raise}</a>
          </span>
        </p>
      )}
      {error && <p className="brief-note">{error}</p>}

      <section className="floor blueprint" aria-label={T.bench.floor}>
        <Corners />
        <div className="floor-head">
          <span className="kicker grow">{T.bench.floor}</span>
          <span className="mono muted" style={{ fontSize: 12 }}>
            {T.bench.floorLive(atWork)}
          </span>
          <Segmented<FloorStyle>
            label={T.bench.floorStyle}
            value={floorStyle}
            onChange={(next) => {
              setFloorStyle(next);
              try {
                localStorage.setItem(FLOOR_STYLE_KEY, next);
              } catch {
                // Private mode: the choice lasts for this window only.
              }
            }}
            options={[
              { value: "characters", label: T.bench.styleCharacters },
              { value: "emblems", label: T.bench.styleEmblems },
            ]}
          />
        </div>
        <div className="floor-stage">
          {floorStyle === "characters" && <SpriteLayer model={floor} />}
        <SvgFloor
          model={floor}
          onOpen={(id) => ctx.go({ screen: "perito", id })}
          onFlightDone={actions.flightDone}
          onStampDone={actions.stampDone}
        />
        </div>
      </section>

      <div className="perito-grid">
        {agents.map((agent) => (
          <PeritoCard key={agent.id} ctx={ctx} agent={agent} />
        ))}
        {agents.length < MAX_SEATS && (
          <div className="seat-open">
            <I icon={Plus} size={22} />
            <strong>{T.bench.seatOpen}</strong>
            <span>{T.bench.seatOpenBody}</span>
          </div>
        )}
      </div>
    </>
  );
}

function PeritoCard({ ctx, agent }: { ctx: Ctx; agent: Agent }) {
  const view = perito(agent, ctx.agents);
  const task = ctx.tasks.find((t) => t.id === agent.taskId);
  const last = agent.error ?? ctx.state.output[agent.id]?.at(-1) ?? agent.lastOutput ?? T.bench.noOutput;
  const open = () => ctx.go({ screen: "perito", id: agent.id });

  const approval = pendingApprovals(ctx.approvals).find((a) => a.agentId === agent.id);
  const question = openQuestions(ctx.messages).find((m) => m.author.kind === "agent" && m.author.agentId === agent.id);
  const action =
    agent.status === "awaiting_approval" && approval
      ? { label: T.bench.reviewSeal, primary: true, run: () => ctx.go({ screen: "awaiting", id: approval.id }) }
      : agent.status === "asking" && question
        ? { label: T.bench.answer, primary: true, run: () => ctx.go({ screen: "awaiting", id: question.id }) }
        : agent.status === "error"
          ? {
              label: T.bench.retry,
              primary: false,
              run: () => void ctx.actions.send(ctx.bureau.id, "Retry the step that failed.", agent.id).catch(() => undefined),
            }
          : null;

  return (
    <div
      className={`card blueprint perito-card clickable ${agent.status === "error" ? "error" : ""}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onEnter(open)}
    >
      <Corners />
      <div className="row">
        <Emblem role={view.role} mono={view.mono} />
        <div className="grow">
          <div className="card-title">{view.who}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {view.sub}
          </div>
        </div>
      </div>
      <Badge meta={AGENT_STATUS[agent.status]} />
      <div>
        <div className="mono" style={{ fontSize: 12 }}>
          {task ? fileRef(task) : "—"}
        </div>
        <div className="ellipsis" style={{ fontSize: 13 }}>
          {task?.title ?? T.bench.noFile}
        </div>
      </div>
      <div className="last">{last}</div>
      <div className="row">
        <span className="mono muted ellipsis grow" style={{ fontSize: 11 }}>
          {task?.branch ?? T.bench.noBranch}
        </span>
        <span className="mono" style={{ fontSize: 12 }}>
          {money(spendOf(ctx, agent.id))}
        </span>
        {action && (
          <button
            className={`btn ${action.primary ? "btn-primary" : "btn-secondary"}`}
            onClick={(event) => {
              event.stopPropagation();
              action.run();
            }}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Files ──────────────────────────────────────────────────────────────────

export function Files(ctx: Ctx) {
  const [view, setView] = useState<"list" | "board">("list");
  const { tasks, agents } = ctx;
  const who = (task: Task) => {
    const agent = agents.find((a) => a.id === task.assigneeId);
    return agent ? perito(agent, agents).who : null;
  };
  // Children sit under their parent.
  const rows = tasks
    .filter((task) => !task.parentId)
    .sort((a, b) => b.number - a.number)
    .flatMap((root) => [root, ...tasks.filter((task) => task.parentId === root.id)]);
  const open = (task: Task) => ctx.go({ screen: "file", id: task.id });

  return (
    <>
      <PageHead kicker={T.files.kicker(ctx.bureau.name)} title={T.files.title}>
        <Segmented<"list" | "board">
          label={T.files.view}
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: T.files.list, icon: List },
            { value: "board", label: T.files.board, icon: Columns3 },
          ]}
        />
      </PageHead>

      {tasks.length === 0 ? (
        <Empty icon={FileText} title={T.files.emptyTitle}>
          {T.files.emptyBody}
        </Empty>
      ) : view === "list" ? (
        <div className="table">
          <div className="table-row head">
            {T.files.cols.map((col) => (
              <span key={col}>{col}</span>
            ))}
          </div>
          {rows.map((task) => (
            <button key={task.id} className="table-row clickable" onClick={() => open(task)}>
              <span className="mono" style={{ fontSize: 12 }}>
                {fileRef(task)}
              </span>
              <span className="row" style={{ paddingLeft: task.parentId ? 20 : 0, fontWeight: task.parentId ? 400 : 500, gap: 8 }}>
                <I icon={task.parentId ? CornerDownRight : FileText} size={14} />
                <span className="ellipsis">{task.title}</span>
              </span>
              <Badge meta={TASK_STATUS[task.status]} />
              <span className={who(task) ? "ellipsis" : "muted"}>{who(task) ?? T.file.unassigned}</span>
              <span className="mono muted ellipsis" style={{ fontSize: 12 }}>
                {task.branch ?? "—"}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {ago(task.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="board">
          {(["draft", "queued", "in_progress", "in_review", "awaiting_approval", "done"] as const).map((status) => {
            const meta = TASK_STATUS[status];
            const column = tasks.filter((task) => task.status === status);
            return (
              <section key={status} className="board-col">
                <header>
                  <span style={{ color: meta.color }}>
                    <I icon={meta.icon} size={14} />
                  </span>
                  <span className="grow">{meta.label}</span>
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {column.length}
                  </span>
                </header>
                {column.length === 0 && <div className="board-empty">{T.files.noFiles}</div>}
                {column.map((task) => (
                  <button key={task.id} className="card blueprint board-card clickable" onClick={() => open(task)}>
                    <Corners />
                    <span className="mono" style={{ fontSize: 12 }}>
                      {fileRef(task)}
                    </span>
                    <span style={{ fontSize: 13 }}>{task.title}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {who(task) ?? T.file.unassigned}
                    </span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── File detail ────────────────────────────────────────────────────────────

interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk";
  n: number | null;
  text: string;
}
interface DiffFile {
  path: string;
  add: number;
  del: number;
  lines: DiffLine[];
}

/** Split `git diff` output into files and numbered lines. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of text.split("\n")) {
    const header = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (header) {
      file = { path: header[1]!, add: 0, del: 0, lines: [] };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      file.lines.push({ kind: "hunk", n: null, text: line });
    } else if (!inHunk || line.startsWith("\\")) {
      continue;
    } else if (line.startsWith("+")) {
      file.add++;
      file.lines.push({ kind: "add", n: newLine++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      file.del++;
      file.lines.push({ kind: "del", n: oldLine++, text: line.slice(1) });
    } else {
      oldLine++;
      file.lines.push({ kind: "ctx", n: newLine++, text: line.slice(1) });
    }
  }
  return files;
}

function Changes({ ctx, task }: { ctx: Ctx; task: Task }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDiff(null);
    setError(null);
    if (task.branch) ctx.actions.taskDiff(task.id).then(setDiff, (err: Error) => setError(err.message));
  }, [task.id, task.branch, task.updatedAt]);
  const files = useMemo(() => (diff ? parseDiff(diff) : []), [diff]);

  if (!task.branch) return <p className="muted">{T.files.noBranch}</p>;
  if (error) return <p className="err">{error}</p>;
  if (diff === null) return <p className="muted">{T.files.loading}</p>;
  if (files.length === 0) return <p className="muted">{T.files.noChanges}</p>;
  return (
    <>
      {files.map((file) => (
        <figure key={file.path} className="diff-file blueprint">
          <Corners />
          <header>
            <span className="grow ellipsis">{file.path}</span>
            <span style={{ color: "var(--st-work)" }}>+{file.add}</span>
            <span style={{ color: "var(--st-err)" }}>−{file.del}</span>
          </header>
          <div className="diff-lines">
            {file.lines.map((line, index) => (
              <div key={index} className={`diff-line ${line.kind}`}>
                <span>{line.n ?? ""}</span>
                <span>{line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}</span>
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        </figure>
      ))}
    </>
  );
}

export function FileDetail({ ctx, id }: { ctx: Ctx; id: string }) {
  const [tab, setTab] = useState<"changes" | "tests">("changes");
  const task = ctx.tasks.find((t) => t.id === id);
  if (!task) {
    return (
      <Empty icon={FileText} title={T.files.emptyTitle}>
        {T.files.emptyBody}
      </Empty>
    );
  }
  const parent = ctx.tasks.find((t) => t.id === task.parentId);
  const agent = ctx.agents.find((a) => a.id === task.assigneeId);
  const view = agent ? perito(agent, ctx.agents) : null;
  const approval = pendingApprovals(ctx.approvals).find((a) => a.taskId === task.id);
  const sections = task.report
    ? ([
        [T.files.done, Check, "var(--color-text)", task.report.done],
        [T.files.tested, FlaskConical, "var(--st-work)", task.report.tested],
        [T.files.notVerified, CircleAlert, "var(--st-warn)", task.report.notVerified],
      ] as const)
    : [];

  return (
    <>
      <button className="btn btn-ghost" style={{ marginBottom: 14 }} onClick={() => ctx.go({ screen: "files" })}>
        <I icon={ArrowLeft} size={14} />
        {T.files.back}
      </button>
      <header className="page-head" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <div className="kicker">
            {T.file.kicker(fileRef(task))}
            {parent ? T.files.partOf(fileRef(parent)) : ""}
          </div>
          <h2>{task.title}</h2>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <Badge meta={TASK_STATUS[task.status]} />
            {view && (
              <span className="row" style={{ gap: 8 }}>
                <Emblem role={view.role} mono={view.mono} size={26} />
                {view.who}
              </span>
            )}
            {task.branch && (
              <span className="row mono muted" style={{ fontSize: 12, gap: 6 }}>
                <I icon={GitBranch} size={13} />
                {task.branch}
              </span>
            )}
          </div>
        </div>
      </header>

      {approval && (
        <div className="notice">
          <I icon={StampIcon} size={18} />
          <span className="grow">{T.files.awaitsSeal}</span>
          <button className="btn btn-primary" onClick={() => ctx.go({ screen: "awaiting", id: approval.id })}>
            {T.bench.reviewSeal}
          </button>
        </div>
      )}

      <div className="two-col">
        <div>
          <div className="section-label">{T.files.definition}</div>
          <p style={{ marginBottom: 24, whiteSpace: "pre-wrap" }} className={task.description ? "" : "muted"}>
            {task.description || T.files.noDefinition}
          </p>
          {task.report ? (
            <div className="report blueprint">
              <Corners />
              <div className="row">
                <h4 className="grow">{T.files.report}</h4>
                <span className="mono muted" style={{ fontSize: 12 }}>
                  {T.files.filed(clock(task.updatedAt))}
                </span>
              </div>
              {sections.map(([label, icon, color, items]) => (
                <section key={label}>
                  <h5 style={{ color }}>
                    <I icon={icon} size={14} />
                    {label}
                  </h5>
                  {items.length ? (
                    <ul>
                      {items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted" style={{ fontSize: 13 }}>
                      {T.files.none}
                    </p>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className="empty">
              <p>{T.files.noReport}</p>
            </div>
          )}
        </div>
        <div>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "changes"} onClick={() => setTab("changes")}>
              <I icon={FileDiff} />
              {T.files.changes}
            </button>
            <button role="tab" aria-selected={tab === "tests"} onClick={() => setTab("tests")}>
              <I icon={FlaskConical} />
              {T.files.tests}
            </button>
          </div>
          {tab === "changes" ? (
            <Changes ctx={ctx} task={task} />
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 12 }}>
                {T.files.noTests}
              </p>
              {task.report?.tested.map((item) => (
                <div key={item} className="row" style={{ padding: "8px 0", borderTop: "1px solid var(--lp-faint)" }}>
                  <span style={{ color: "var(--st-work)" }}>
                    <I icon={FlaskConical} />
                  </span>
                  {item}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Terminal ───────────────────────────────────────────────────────────────

function TerminalOutput({ lines, fallback }: { lines: string[] | undefined; fallback: string | null }) {
  const end = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines?.length]);
  const shown = lines?.length ? lines : fallback ? [fallback] : [];
  return (
    <pre className="term-out">
      {shown.length === 0 && <span className="out">{T.bench.noOutput}</span>}
      {shown.map((line, index) => (
        <span key={index} className={/^(>|\[|■)/.test(line) ? "cmd" : /error|failed/i.test(line) ? "bad" : "out"}>
          {line + "\n"}
        </span>
      ))}
      <span ref={end} />
    </pre>
  );
}

// ── Correspondence ─────────────────────────────────────────────────────────

export function Correspondence(ctx: Ctx) {
  const { agents, bureau } = ctx;
  const [split, setSplit] = useState(54);
  const [followId, setFollowId] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // The terminal follows whoever you clicked, else whoever is working, else the lead.
  const followed =
    agents.find((a) => a.id === followId) ?? agents.find((a) => a.status === "working") ?? agents.find((a) => a.role === "lead");

  const clamp = (value: number) => Math.min(72, Math.max(30, value));
  const drag = (event: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    const move = (e: PointerEvent) => setSplit(clamp(((e.clientX - rect.left) / rect.width) * 100));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    event.preventDefault();
  };

  return (
    <>
      <PageHead kicker={T.mail.kicker(bureau.name)} title={T.mail.title} />
      <div className="split" ref={box}>
        <section className="thread" style={{ width: `${split}%` }}>
          <Chat ctx={ctx} onPickAgent={setFollowId} />
        </section>
        <div
          className="split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={T.mail.resize}
          aria-valuenow={Math.round(split)}
          aria-valuemin={30}
          aria-valuemax={72}
          tabIndex={0}
          onPointerDown={drag}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setSplit(clamp(split - 3));
            if (event.key === "ArrowRight") setSplit(clamp(split + 3));
          }}
        >
          <I icon={GripVertical} size={12} />
        </div>
        <section className="term grow">
          {followed ? (
            <>
              <header>
                <I icon={Terminal} />
                <span className="grow ellipsis">
                  {perito(followed, agents).who}
                  <span className="mono muted"> {ctx.tasks.find((t) => t.id === followed.taskId)?.branch ?? ""}</span>
                </span>
                <Badge meta={AGENT_STATUS[followed.status]} />
                <button className="btn btn-secondary" onClick={() => ctx.go({ screen: "perito", id: followed.id })}>
                  {T.mail.open}
                </button>
              </header>
              <TerminalOutput lines={ctx.state.output[followed.id]} fallback={followed.lastOutput} />
            </>
          ) : (
            <p className="muted" style={{ padding: 16 }}>
              {T.mail.noTerminal}
            </p>
          )}
        </section>
      </div>
    </>
  );
}

// ── Perito detail ──────────────────────────────────────────────────────────

export function PeritoDetail({ ctx, id }: { ctx: Ctx; id: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The name being typed while renaming; null when not renaming. */
  const [draft, setDraft] = useState<string | null>(null);
  const agent = ctx.agents.find((a) => a.id === id);
  if (!agent) return <Empty icon={Square} title={T.bench.seatOpen} />;
  const rename = (nickname: string | null) =>
    ctx.actions.renameAgent(agent.id, nickname).then(
      () => setDraft(null),
      (err: Error) => setError(err.message),
    );
  const view = perito(agent, ctx.agents);
  const task = ctx.tasks.find((t) => t.id === agent.taskId);
  const runs = (ctx.state.runs[ctx.bureau.id] ?? []).filter((run) => run.agentId === agent.id);
  const sum = (pick: (run: (typeof runs)[number]) => number) => runs.reduce((total, run) => total + pick(run), 0);
  const stopped = agent.status === "stopped";
  const live = agent.status === "working" ? T.peritoDetail.live : stopped ? T.peritoDetail.stopped : T.peritoDetail.paused;

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      await ctx.actions.send(ctx.bureau.id, text.trim(), agent.id);
      setText("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <button className="btn btn-ghost" style={{ marginBottom: 14, alignSelf: "flex-start" }} onClick={() => ctx.go({ screen: "bench" })}>
        <I icon={ArrowLeft} size={14} />
        {T.peritoDetail.back}
      </button>
      <header className="page-head" style={{ alignItems: "center" }}>
        <Emblem role={view.role} mono={view.mono} size={52} />
        <div className="grow">
          {draft === null ? (
            <div className="rename">
              <h2>{view.who}</h2>
              <button className="btn btn-ghost btn-icon" aria-label={T.peritoDetail.rename} title={T.peritoDetail.rename} onClick={() => setDraft(agent.nickname ?? "")}>
                <I icon={PencilLine} size={14} />
              </button>
            </div>
          ) : (
            <form
              className="rename"
              onSubmit={(event) => {
                event.preventDefault();
                void rename(draft.trim() || null);
              }}
            >
              <input
                className="input"
                value={draft}
                maxLength={24}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setDraft(null)}
                aria-label={T.peritoDetail.nameLabel}
                placeholder={T.peritoDetail.nameLabel}
              />
              <button className="btn btn-secondary">{T.peritoDetail.save}</button>
              {agent.nickname && (
                <button type="button" className="btn btn-ghost" onClick={() => rename(null)}>
                  {T.peritoDetail.defaultName}
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                {T.peritoDetail.cancel}
              </button>
            </form>
          )}
          <div className="muted" style={{ fontSize: 13 }}>
            {view.sub}
          </div>
        </div>
        <Badge meta={AGENT_STATUS[agent.status]} />
        <button className="btn btn-secondary" disabled={stopped} onClick={() => void ctx.actions.stopAgent(agent.id)}>
          <I icon={Square} size={13} />
          {T.peritoDetail.stop}
        </button>
      </header>

      <div className="detail-body">
        <section className="term blueprint grow">
          <Corners />
          <header>
            <I icon={GitBranch} size={13} />
            <span className="mono grow ellipsis">{task?.branch ?? T.bench.noBranch}</span>
            <span className="live" style={{ color: agent.status === "working" ? "var(--st-work)" : "var(--lp-muted)" }}>
              {live}
            </span>
          </header>
          <TerminalOutput lines={ctx.state.output[agent.id]} fallback={agent.error ?? agent.lastOutput} />
          {error && (
            <p className="err" style={{ padding: "6px 14px", fontSize: 13 }}>
              {error}
            </p>
          )}
          <form className="composer" onSubmit={send}>
            <input
              className="input grow"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={T.peritoDetail.message}
              aria-label={T.peritoDetail.message}
            />
            <button className="btn btn-secondary" disabled={!text.trim()}>
              <I icon={Send} />
              {T.peritoDetail.send}
            </button>
          </form>
        </section>

        <aside className="aside">
          <div>
            <div className="section-label">{T.peritoDetail.currentFile}</div>
            {task ? (
              <button className="file-link" onClick={() => ctx.go({ screen: "file", id: task.id })}>
                <span className="mono" style={{ fontSize: 12 }}>
                  {fileRef(task)}
                </span>
                <span>{task.title}</span>
              </button>
            ) : (
              <p className="muted">{T.bench.noFile}</p>
            )}
          </div>
          <div>
            <div className="section-label">{T.peritoDetail.session}</div>
            <div className="figure">{money(sum((run) => run.costUsd))}</div>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>{T.peritoDetail.tool}</dt>
              <dd>{view.tool}</dd>
              <dt>{T.peritoDetail.tokensIn}</dt>
              <dd>{sum((run) => run.inputTokens).toLocaleString()}</dd>
              <dt>{T.peritoDetail.tokensOut}</dt>
              <dd>{sum((run) => run.outputTokens).toLocaleString()}</dd>
              <dt>{T.peritoDetail.turns}</dt>
              <dd>{runs.length}</dd>
              <dt>{T.peritoDetail.branch}</dt>
              <dd>{task?.branch ?? T.peritoDetail.none}</dd>
            </dl>
          </div>
        </aside>
      </div>
    </>
  );
}
