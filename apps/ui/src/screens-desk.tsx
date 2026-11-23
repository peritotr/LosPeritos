import { Attachments } from "./attachments";
import { ReportFiles } from "./preview";
import { PhoneSettings } from "./phone";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Ban,
  Check,
  CircleCheck,
  CircleAlert,
  Copy,
  FolderOpen,
  Lock,
  MessageCircleQuestion,
  RefreshCw,
  Stamp as StampIcon,
  TriangleAlert,
  Undo2,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { Approval, Message, ToolCheck, Workspace, WorkspaceKind } from "@losperitos/protocol";

const KINDS = ["software", "marketing", "content"] as const satisfies readonly WorkspaceKind[];
import { openQuestions, pendingApprovals, type Ctx } from "./context";
import { Connectors } from "./connectors";
import { UpdateSettings } from "./updates";
import { showTour } from "./onboarding";
import { CORE_URL, shell } from "./store";
import { LANGUAGES, T, dateLocale, fromCore, language, setLanguage, type Language } from "./strings";
import { Corners, Emblem, Empty, I, PageHead, Segmented, Stamp, ago, fileRef, kindOf, money, pad, perito, questionRef, sealRef, sealText } from "./ui";

const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();

/** Names for an agent and file in any bureau, for items listed across bureaus. */
function lookup(ctx: Ctx) {
  const { agents, tasks, workspaces } = ctx.state;
  return {
    who: (agentId: string | null) => {
      const agent = agents.find((a) => a.id === agentId);
      return agent ? perito(agent, agents).who : T.perito.fallback;
    },
    file: (taskId: string | null) => tasks.find((t) => t.id === taskId) ?? null,
    bureau: (id: string) => workspaces.find((w) => w.id === id),
  };
}

// ── Seal card ──────────────────────────────────────────────────────────────

/** Decide a seal request, reporting failure (a merge conflict, say) inline. */
function useSeal(ctx: Ctx, approval: Approval) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** For a connector call: let this tool go ahead unasked from now on. */
  const [remember, setRemember] = useState(false);
  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    try {
      await ctx.actions.decideApproval(approval.id, decision, remember && decision === "approved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, decide, remember, setRemember };
}

function stampTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const day = date.toLocaleDateString(dateLocale, { day: "2-digit", month: "short" }).toLocaleUpperCase(dateLocale);
  return `${day} · ${date.toTimeString().slice(0, 5)}`;
}

/**
 * What a tool was called with, laid out to be read: names on the left, values
 * as plain text, lists numbered. Prose stays prose; nothing is shown as raw JSON.
 */
function DataView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || typeof value !== "object") {
    const text = typeof value === "string" ? value : String(value);
    return <span className={typeof value === "string" ? "data-text" : "data-text mono"}>{text}</span>;
  }
  const entries: Array<[string, unknown]> = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="muted">—</span>;
  // An item that only wraps one thing (`{ params: {…} }`) is shown as that thing.
  if (!Array.isArray(value) && entries.length === 1 && entries[0]![1] !== null && typeof entries[0]![1] === "object" && depth > 0) {
    return <DataView value={entries[0]![1]} depth={depth} />;
  }
  return (
    <dl className={`data ${Array.isArray(value) ? "data-list" : ""}`}>
      {entries.map(([name, item]) => (
        <div key={name} className={item !== null && typeof item === "object" ? "data-row data-nested" : typeof item === "string" && item.length > 36 ? "data-row data-long" : "data-row"}>
          <dt>{Array.isArray(value) ? name : name.replace(/_/g, " ")}</dt>
          <dd>
            <DataView value={item} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SealDetail({ text }: { text: string }) {
  let data: unknown;
  if (/^\s*[{[]/.test(text)) {
    try {
      data = JSON.parse(text);
    } catch {
      // Cut short or not data after all: shown as it is.
    }
  }
  if (data !== undefined && data !== null && typeof data === "object") {
    return (
      <div className="detail-data">
        <DataView value={data} />
      </div>
    );
  }
  return <p className={`detail-text ${/^\s*[{[]/.test(text) ? "is-data" : ""}`}>{text}</p>;
}

function SealCard({ ctx, approval }: { ctx: Ctx; approval: Approval }) {
  const names = lookup(ctx);
  const { busy, error, decide, remember, setRemember } = useSeal(ctx, approval);
  // Animate only a seal that lands while this card is on screen.
  const wasPending = useRef(approval.status === "pending");
  const file = names.file(approval.taskId);
  const who = names.who(approval.agentId);
  const ref = sealRef(approval, ctx.state.approvals);
  const deferred = ctx.deferred.has(approval.id);

  return (
    <article className="card blueprint seal-card">
      <Corners />
      <div className="top">
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>
            {T.seal.request(ref)}
          </div>
          {/* A tool's name has no spaces to break at: let it break after an underscore rather than mid-word. */}
          <h3>{sealText(approval).title.replace(/_/g, "_\u200b")}</h3>
        </div>
        {approval.status === "pending" ? (
          <Stamp kind="pending" sub={ref} />
        ) : (
          <Stamp
            kind={approval.status === "approved" ? "approved" : "declined"}
            sub={stampTime(approval.decidedAt)}
            animate={wasPending.current}
          />
        )}
      </div>
      <dl className="kv" style={{ gridTemplateColumns: "110px minmax(0,1fr)" }}>
        <dt>{T.seal.affects}</dt>
        <dd style={{ textAlign: "left" }}>{file ? `${fileRef(file)} ${file.title}` : T.seal.kind[approval.kind]}</dd>
        <dt>{T.seal.requestedBy}</dt>
        <dd style={{ textAlign: "left" }}>{who}</dd>
        <dt>{T.seal.bureau}</dt>
        <dd style={{ textAlign: "left" }}>{names.bureau(approval.workspaceId)?.name}</dd>
      </dl>
      {approval.detail && <SealDetail text={sealText(approval).detail} />}
      {approval.steps.length > 0 && (
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>
            {T.seal.onSealing}
          </div>
          <ol className="steps">
            {sealText(approval).steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {/* What is being sealed can be read here, before the seal: the files the task handed in. */}
      {file && (file.report?.files?.length ?? 0) > 0 && (
        <div className="seal-files">
          <ReportFiles ctx={ctx} task={file} />
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => ctx.go({ screen: "file", id: file.id })}>
            {T.seal.openFile}
          </button>
        </div>
      )}
      <p className={`rev ${approval.reversible ? "" : "no"}`}>
        <I icon={approval.reversible ? Undo2 : Lock} />
        <span>
          <strong>{approval.reversible ? T.seal.reversible : T.seal.notReversible}</strong>{" "}
          {approval.reversible ? T.seal.reversibleBody : T.seal.notReversibleBody}
        </span>
      </p>
      {error && (
        <p className="err" style={{ fontSize: 13 }}>
          {error}
        </p>
      )}
      {approval.status === "pending" && approval.call && (
        <label className="row" style={{ fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>{T.seal.rememberTool(approval.call.tool)}</span>
        </label>
      )}
      {approval.status === "pending" ? (
        <>
          <div className="row wrap">
            <button className="btn btn-primary btn-lg blueprint" disabled={busy} onClick={() => decide("approved")}>
              <Corners />
              <I icon={StampIcon} size={18} />
              {T.seal.seal}
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => ctx.defer(approval.id)}>
              {T.seal.notNow}
            </button>
            <span className="grow" />
            <button className="btn btn-ghost" disabled={busy} onClick={() => decide("rejected")}>
              {T.seal.decline}
            </button>
          </div>
          {deferred && (
            <p className="muted" style={{ fontSize: 13 }}>
              {T.seal.deferred}
            </p>
          )}
        </>
      ) : (
        <p className="row" style={{ gap: 8 }}>
          <I icon={Check} />
          {approval.status === "approved" ? T.seal.sealedBy(who) : approval.lapsed ? T.seal.lapsed : T.seal.declinedBy(who)}
        </p>
      )}
    </article>
  );
}

function QuestionCard({ ctx, message }: { ctx: Ctx; message: Message }) {
  const names = lookup(ctx);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = names.file(message.taskId);
  const who = names.who(message.author.kind === "agent" ? message.author.agentId : null);

  const answer = async (value: string) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ctx.actions.answer(message.id, value.trim(), remember);
      ctx.note(T.awaiting.answerSent);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card blueprint seal-card">
      <Corners />
      <div>
        <div className="kicker" style={{ marginBottom: 8 }}>
          {T.awaiting.question(questionRef(message, ctx.state.messages))}
        </div>
        <h3 style={{ whiteSpace: "pre-wrap" }}>{fromCore(message.body)}</h3>
      </div>
      {message.attachments?.length ? <Attachments ctx={ctx} workspaceId={message.workspaceId} names={message.attachments} /> : null}
      <p className="muted" style={{ fontSize: 13 }}>
        {T.awaiting.from(who, file ? `${fileRef(file)} ${file.title}` : null)}
      </p>
      {error && (
        <p className="err" style={{ fontSize: 13 }}>
          {error}
        </p>
      )}
      {message.question!.answer === null ? (
        <>
          <div className="options">
            {message.question!.options.map((option) => (
              <button key={option} className="btn btn-act" disabled={busy} onClick={() => answer(option)}>
                {option}
                {option === message.question!.recommended && <span className="suggested">★ {T.awaiting.recommended}</span>}
              </button>
            ))}
          </div>
          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            {T.awaiting.remember}
          </label>
          <form
            className="row"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void answer(text);
            }}
          >
            <input
              className="input grow"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={T.awaiting.ownWords}
              aria-label={T.awaiting.ownWords}
            />
            <button className="btn btn-secondary" disabled={busy || !text.trim()}>
              {T.awaiting.send}
            </button>
          </form>
        </>
      ) : (
        <p className="row" style={{ gap: 8 }}>
          <I icon={Check} />
          {T.awaiting.answered(message.question!.answer)}
        </p>
      )}
    </article>
  );
}

// ── Awaiting you ───────────────────────────────────────────────────────────

type Item = { id: string; at: string; workspaceId: string } & (
  | { kind: "seal"; approval: Approval }
  | { kind: "question"; message: Message }
);

export function Awaiting({ ctx, selectedId }: { ctx: Ctx; selectedId?: string }) {
  const { state } = ctx;
  const names = lookup(ctx);
  const [picked, setPicked] = useState<string | undefined>(selectedId);
  useEffect(() => {
    if (selectedId) setPicked(selectedId);
  }, [selectedId]);

  const all: Item[] = [
    ...state.approvals.map((approval) => ({
      id: approval.id,
      at: approval.createdAt,
      workspaceId: approval.workspaceId,
      kind: "seal" as const,
      approval,
    })),
    ...state.messages
      .filter((message) => message.question)
      .map((message) => ({
        id: message.id,
        at: message.createdAt,
        workspaceId: message.workspaceId,
        kind: "question" as const,
        message,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const isPending = (item: Item) =>
    item.kind === "seal" ? item.approval.status === "pending" : item.message.question!.answer === null;
  const pending = all.filter(isPending);
  const cleared = all.filter(
    (item) => !isPending(item) && isToday(item.kind === "seal" ? item.approval.decidedAt : item.message.createdAt),
  );
  // Selection is by id, so an item stays in view after it is sealed or answered.
  const selected = all.find((item) => item.id === picked) ?? pending[0];

  const row = (item: Item, done: boolean) => {
    const title = item.kind === "seal" ? sealText(item.approval).title : fromCore(item.message.body);
    const agentId =
      item.kind === "seal" ? item.approval.agentId : item.message.author.kind === "agent" ? item.message.author.agentId : null;
    const file = names.file(item.kind === "seal" ? item.approval.taskId : item.message.taskId);
    const tag = done
      ? item.kind === "seal"
        ? item.approval.status === "approved"
          ? T.awaiting.tagSealed
          : T.awaiting.tagDeclined
        : T.awaiting.tagAnswered
      : item.kind === "question"
        ? T.awaiting.tagQuestion
        : ctx.deferred.has(item.id)
          ? T.awaiting.tagDeferred
          : T.awaiting.tagSeal;
    return (
      <button
        key={item.id}
        className={`await-row ${done ? "cleared" : ""}`}
        aria-current={selected?.id === item.id}
        onClick={() => setPicked(item.id)}
      >
        <I icon={done ? Check : item.kind === "seal" ? StampIcon : MessageCircleQuestion} size={18} />
        <span className="grow">
          <span className="ellipsis" style={{ display: "block", fontWeight: 500 }}>
            {title}
          </span>
          <span className="muted ellipsis" style={{ display: "block", fontSize: 12 }}>
            {[names.who(agentId), file ? fileRef(file) : null, ago(item.at)].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className={`tag ${done ? "" : "act"}`}>{tag}</span>
      </button>
    );
  };

  return (
    <>
      <PageHead kicker={T.awaiting.kicker} title={T.awaiting.title} />
      {pending.length === 0 && cleared.length === 0 ? (
        <Empty icon={CircleCheck} title={T.awaiting.emptyTitle}>
          {T.awaiting.emptyBody}
        </Empty>
      ) : (
        <div className="awaiting">
          <div>
            {pending.length === 0 && (
              <div style={{ marginBottom: 22 }}>
                <Empty icon={CircleCheck} title={T.awaiting.emptyTitle}>
                  {T.awaiting.emptyBody}
                </Empty>
              </div>
            )}
            {state.workspaces.map((workspace) => {
              const items = pending.filter((item) => item.workspaceId === workspace.id);
              if (items.length === 0) return null;
              return (
                <section key={workspace.id} className="await-group">
                  <header>
                    <b>{workspace.name}</b>
                    <span>{T.awaiting.count(items.length)}</span>
                  </header>
                  {items.map((item) => row(item, false))}
                </section>
              );
            })}
            {cleared.length > 0 && (
              <section className="await-group">
                <header>
                  <span>{T.awaiting.cleared}</span>
                </header>
                {cleared.map((item) => row(item, true))}
              </section>
            )}
          </div>
          <div className="await-detail">
            {selected?.kind === "seal" && <SealCard key={selected.id} ctx={ctx} approval={selected.approval} />}
            {selected?.kind === "question" && <QuestionCard key={selected.id} ctx={ctx} message={selected.message} />}
          </div>
        </div>
      )}
    </>
  );
}

/** A seal request surfacing over whatever screen the user is on. */
export function SealToast({ ctx, approval, onLeave }: { ctx: Ctx; approval: Approval; onLeave(): void }) {
  const names = lookup(ctx);
  const { busy, error, decide } = useSeal(ctx, approval);
  const sealed = approval.status === "approved";
  // After sealing, the stamp shows briefly, then the toast leaves.
  useEffect(() => {
    if (approval.status === "pending") return;
    const timer = setTimeout(onLeave, sealed ? 1700 : 0);
    return () => clearTimeout(timer);
  }, [approval.status]);

  return (
    <div className="card blueprint toast" role="alertdialog" aria-label={sealText(approval).title} style={{ background: "var(--color-bg)" }}>
      <Corners />
      <div className="kicker">{T.seal.request(sealRef(approval, ctx.state.approvals))}</div>
      <h4>{sealText(approval).title}</h4>
      <p className="muted" style={{ fontSize: 13 }}>
        {T.seal.toastLine(approval.reversible, approval.steps.length, names.who(approval.agentId))}
      </p>
      {error && (
        <p className="err" style={{ fontSize: 13 }}>
          {error}
        </p>
      )}
      {sealed ? (
        <div style={{ padding: "6px 4px" }}>
          <Stamp kind="approved" sub={stampTime(approval.decidedAt)} animate />
        </div>
      ) : (
        <div className="row">
          <button className="btn btn-primary" disabled={busy} onClick={() => decide("approved")}>
            <I icon={StampIcon} />
            {T.seal.seal}
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => {
              ctx.defer(approval.id);
              onLeave();
            }}
          >
            {T.seal.notNow}
          </button>
          <button className="btn btn-ghost" onClick={() => ctx.go({ screen: "awaiting", id: approval.id })}>
            {T.seal.details}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Archive ────────────────────────────────────────────────────────────────

export function Archive(ctx: Ctx) {
  const names = lookup(ctx);
  const lessons = ctx.state.lessons.filter((lesson) => lesson.workspaceId === ctx.bureau.id);
  // Every answered question, newest first, numbered in the order it was asked.
  const decisions = ctx.messages
    .filter((message) => message.question)
    .map((message, index) => ({ message, ref: `D-${pad(index + 1, 3)}` }))
    .filter(({ message }) => message.question!.answer !== null)
    .reverse();
  const proposed = lessons.filter((lesson) => lesson.status === "proposed");
  const accepted = lessons
    .filter((lesson) => lesson.status === "accepted")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((lesson, index) => ({ lesson, ref: `A-${pad(index + 1, 3)}` }))
    .reverse();

  return (
    <>
      <PageHead kicker={T.archive.kicker(ctx.bureau.name)} title={T.archive.title} />
      <p className="intro">{T.archive.intro}</p>
      <div className="archive">
        <section>
          <div className="section-label">{T.archive.proposed}</div>
          {proposed.length === 0 && <div className="empty"><p>{T.archive.noProposals}</p></div>}
          {proposed.length > 1 && (
            <button
              className="btn btn-secondary"
              style={{ marginBottom: 12 }}
              onClick={() =>
                Promise.all(proposed.map((lesson) => ctx.actions.decideLesson(lesson.id, "accepted"))).then(
                  () => ctx.note(T.archive.admittedAll(proposed.length)),
                  (err: Error) => ctx.note(err.message),
                )
              }
            >
              {T.archive.addAll(proposed.length)}
            </button>
          )}
          {proposed.map((lesson) => (
            <article key={lesson.id} className="card blueprint lesson">
              <Corners />
              <p>{lesson.text}</p>
              <p className="muted" style={{ fontSize: 12 }}>
                {T.archive.by(names.who(lesson.proposedByAgentId))}
              </p>
              <div className="row">
                <button
                  className="btn btn-primary"
                  onClick={() => ctx.actions.decideLesson(lesson.id, "accepted").then(() => ctx.note(T.archive.admitted))}
                >
                  {T.archive.add}
                </button>
                <button className="btn btn-secondary" onClick={() => void ctx.actions.decideLesson(lesson.id, "rejected")}>
                  {T.archive.reject}
                </button>
              </div>
            </article>
          ))}
        </section>
        <section>
          <div className="section-label">{T.awaiting.decisions}</div>
          {decisions.length === 0 && <p className="muted" style={{ marginBottom: 22 }}>{T.awaiting.noDecisions}</p>}
          {decisions.map(({ message, ref }) => (
            <div key={message.id} className="record">
              <span className="mono muted" style={{ fontSize: 12 }}>
                {ref}
              </span>
              <div>
                <p>{fromCore(message.body)}</p>
                <p style={{ color: "var(--st-act)" }}>→ {message.question!.answer}</p>
                <p className="muted" style={{ fontSize: 12 }}>
                  {names.who(message.author.kind === "agent" ? message.author.agentId : null)}
                </p>
              </div>
            </div>
          ))}
          <div className="section-label" style={{ marginTop: 26 }}>
            {T.archive.onRecord}
          </div>
          {accepted.length === 0 && <p className="muted">{T.archive.noRecords}</p>}
          {accepted.map(({ lesson, ref }) => (
            <div key={lesson.id} className="record">
              <span className="mono muted" style={{ fontSize: 12 }}>
                {ref}
              </span>
              <div>
                <p>{lesson.text}</p>
                <p className="muted" style={{ fontSize: 12 }}>
                  {names.who(lesson.proposedByAgentId)}
                </p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

// ── Ledger ─────────────────────────────────────────────────────────────────

export function BudgetBar({ spent, limit, mini }: { spent: number; limit: number | null; mini?: boolean }) {
  const share = limit ? Math.min(1, spent / limit) : 0;
  const level = limit === null ? "" : share >= 1 ? "full" : share >= 0.8 ? "warn" : "";
  return (
    <span className={`bar ${level} ${mini ? "mini" : ""}`}>
      <span style={{ width: `${share * 100}%` }} />
      <i />
    </span>
  );
}

export function Ledger(ctx: Ctx) {
  const { state, bureau, agents } = ctx;
  const runs = state.runs[bureau.id] ?? [];
  const byAgent = agents
    .map((agent) => ({ agent, spent: runs.filter((run) => run.agentId === agent.id).reduce((sum, run) => sum + run.costUsd, 0) }))
    .filter((row) => row.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  const total = byAgent.reduce((sum, row) => sum + row.spent, 0);
  const top = byAgent[0]?.spent ?? 0;

  return (
    <>
      <PageHead kicker={T.ledger.kicker} title={T.ledger.title} />
      <div className="ledger-grid">
        {state.workspaces.map((workspace) => {
          const budget = state.budgets[workspace.id];
          if (!budget) return null;
          const share = budget.limitUsd ? Math.round((budget.spentUsd / budget.limitUsd) * 100) : null;
          const line =
            budget.level === "exhausted"
              ? { icon: Ban, color: "var(--st-err)", text: T.ledger.full }
              : budget.level === "warning"
                ? { icon: TriangleAlert, color: "var(--st-warn)", text: T.ledger.warn }
                : { icon: Check, color: "var(--lp-muted)", text: T.ledger.ok };
          return (
            <article key={workspace.id} className="card blueprint ledger-card">
              <Corners />
              <span className="mono" style={{ fontSize: 13 }}>
                {workspace.name}
              </span>
              <div>
                <span className="figure">{money(budget.spentUsd)}</span>{" "}
                <span className="muted">
                  {budget.limitUsd !== null ? T.ledger.ofToday(money(budget.limitUsd)) : T.ledger.noLimit}
                </span>
              </div>
              {budget.limitUsd !== null && (
                <>
                  <BudgetBar spent={budget.spentUsd} limit={budget.limitUsd} />
                  <p className="state-line" style={{ color: line.color }}>
                    <I icon={line.icon} />
                    {line.text} · {share}%
                  </p>
                </>
              )}
            </article>
          );
        })}
      </div>

      <div className="section-label">
        {T.ledger.byPerito} · {bureau.name}
      </div>
      <div className="spend-rows">
        {byAgent.length === 0 && <p className="muted">{T.ledger.noSpend}</p>}
        {byAgent.map(({ agent, spent }) => {
          const view = perito(agent, agents);
          return (
            <div key={agent.id} className="spend-row">
              <Emblem role={view.role} mono={view.mono} size={26} />
              <span className="ellipsis">{view.who}</span>
              <span className="bar">
                <span style={{ width: `${top ? (spent / top) * 100 : 0}%` }} />
                <i />
              </span>
              <span className="mono" style={{ textAlign: "right" }}>
                {money(spent)}
              </span>
              <span className="mono muted" style={{ textAlign: "right", fontSize: 12 }}>
                {total ? Math.round((spent / total) * 100) : 0}%
              </span>
            </div>
          );
        })}
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          {T.ledger.estimate}
        </p>
      </div>
    </>
  );
}

// ── Tools (Setup and Settings) ─────────────────────────────────────────────

const INSTALL: Partial<Record<ToolCheck["tool"], string>> = {
  claude: "npm install -g @anthropic-ai/claude-code",
  codex: "npm install -g @openai/codex",
};

function Tools({ ctx, compact }: { ctx: Ctx | Pick<Ctx, "actions">; compact?: boolean }) {
  const [tools, setTools] = useState<ToolCheck[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const check = () => {
    setTools(null);
    ctx.actions.checkTools().then(setTools, () => setTools([]));
  };
  useEffect(check, []);

  if (tools === null) return <p className="muted">{T.setup.checking}</p>;
  return (
    <div>
      {tools.map((tool) => {
        const command = INSTALL[tool.tool];
        return (
          <div key={tool.tool} className="tool-row">
            <span style={{ color: tool.found ? "var(--st-work)" : "var(--st-warn)" }}>
              <I icon={tool.found ? CircleCheck : CircleAlert} size={18} />
            </span>
            <div>
              <div style={{ fontWeight: 500 }}>{T.setup.name[tool.tool]}</div>
              {!compact && <div className="muted" style={{ fontSize: 13 }}>{T.setup.purpose[tool.tool]}</div>}
              <div className="mono muted" style={{ fontSize: 12 }}>
                {tool.found ? tool.version : T.setup.notFound}
              </div>
            </div>
            <span className="tag" style={{ color: tool.found ? "var(--st-work)" : "var(--st-warn)", borderColor: "currentColor" }}>
              {tool.found ? T.setup.installed : T.setup.notInstalled}
            </span>
            {!tool.found && (
              <div className="install">
                {command && <code>{command}</code>}
                {command && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => navigator.clipboard.writeText(command).then(() => setCopied(tool.tool), () => undefined)}
                  >
                    <I icon={Copy} size={14} />
                    {copied === tool.tool ? T.setup.copied : T.setup.copy}
                  </button>
                )}
                <button className="btn btn-secondary" onClick={check}>
                  <I icon={RefreshCw} size={14} />
                  {T.setup.again}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Setup({
  ctx,
  firstRun,
  onOpened,
}: {
  ctx: Pick<Ctx, "actions">;
  firstRun: boolean;
  onOpened(workspace: Workspace): void;
}) {
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<WorkspaceKind>("software");
  const [error, setError] = useState<string | null>(null);
  const openPath = async (folder: string) => {
    setError(null);
    try {
      onOpened(await ctx.actions.openWorkspace(folder, kind));
      setPath("");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const open = (event: FormEvent) => {
    event.preventDefault();
    void openPath(path.trim());
  };
  // In the desktop app the system's folder dialog replaces typing a path.
  const choose = async () => {
    const folder = await shell!.pickFolder();
    if (folder) await openPath(folder);
  };
  return (
    <div className="setup">
      <img className="setup-logo" src={`${import.meta.env.BASE_URL}logo.jpeg`} alt="LosPeritos" width={220} height={220} />
      <div>
        <div className="kicker" style={{ marginBottom: 8 }}>
          {firstRun ? T.setup.kicker : T.setup.kickerLater}
        </div>
        <h2>{T.setup.title}</h2>
        <p className="muted" style={{ marginTop: 10 }}>
          {T.setup.intro}
        </p>
      </div>
      <section className="panel blueprint">
        <Corners />
        <h4>{T.setup.step1}</h4>
        <Tools ctx={ctx} />
      </section>
      <section className="panel blueprint">
        <Corners />
        <h4>{T.setup.step2}</h4>
        <p className="muted">{T.setup.step2Body}</p>
        <div className="kinds" role="radiogroup" aria-label={T.kinds.label}>
          {KINDS.map((key) => (
            <button key={key} type="button" role="radio" aria-checked={kind === key} className="kind" onClick={() => setKind(key)}>
              <strong>{T.kinds[key].name}</strong>
              <span className="muted">{T.kinds[key].hint}</span>
            </button>
          ))}
        </div>
        {shell ? (
          <button className="btn btn-primary blueprint" style={{ alignSelf: "flex-start" }} onClick={choose}>
            <Corners />
            <I icon={FolderOpen} />
            {T.setup.chooseNative}
          </button>
        ) : (
        <form className="row" onSubmit={open}>
          <input
            className="input grow mono"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={T.setup.pathPlaceholder}
            aria-label={T.setup.pathLabel}
          />
          <button className="btn btn-primary blueprint" disabled={!path.trim()}>
            <Corners />
            <I icon={FolderOpen} />
            {T.setup.choose}
          </button>
        </form>
        )}
        {error && (
          <p className="err" style={{ fontSize: 13 }}>
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────────

export function Settings(ctx: Ctx) {
  const { bureau, actions, state } = ctx;
  const [limit, setLimit] = useState(bureau.dailyBudgetUsd?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setLimit(bureau.dailyBudgetUsd?.toString() ?? ""), [bureau.id]);
  const online = state.phase === "ready";

  const saveBudget = (event: FormEvent) => {
    event.preventDefault();
    const value = limit.trim() === "" ? null : Number(limit);
    if (value !== null && !(Number.isFinite(value) && value >= 0)) {
      setError(T.settings.invalid);
      return;
    }
    setError(null);
    actions.updateWorkspace(bureau.id, { dailyBudgetUsd: value }).then(
      () => ctx.note(T.settings.saved),
      (err: Error) => setError(err.message),
    );
  };

  return (
    <>
      <PageHead kicker={T.settings.kicker(bureau.name)} title={T.settings.title} />
      <div className="settings">
        <section className="panel blueprint">
          <Corners />
          <h4>{T.settings.bureau}</h4>
          <form className="field" onSubmit={saveBudget}>
            <label htmlFor="budget">{T.settings.budget}</label>
            <div className="row">
              <input
                id="budget"
                className="input mono"
                inputMode="decimal"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                style={{ maxWidth: 160 }}
              />
              <button className="btn btn-secondary">{T.settings.save}</button>
            </div>
            <p className={error ? "err" : "muted"} style={{ fontSize: 12, marginTop: 6 }}>
              {error ?? T.settings.budgetHint}
            </p>
          </form>
          <div className="field">
            <label>{T.kinds.label}</label>
            <Segmented
              label={T.kinds.label}
              value={kindOf(bureau)}
              onChange={(kind) => void actions.updateWorkspace(bureau.id, { kind })}
              options={KINDS.map((key) => ({ value: key, label: T.kinds[key].name }))}
            />
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {T.kinds[kindOf(bureau)].hint}
            </p>
            <p className="muted" style={{ fontSize: 12 }}>
              {T.kinds.note}
            </p>
          </div>
          {!ctx.simple && (
          <div className="field">
            <label>{T.settings.agentTool}</label>
            <Segmented<"claude-code" | "codex">
              label={T.settings.agentTool}
              value={bureau.agentTool ?? "claude-code"}
              onChange={(agentTool) => actions.updateWorkspace(bureau.id, { agentTool }).catch((err: Error) => ctx.note(err.message))}
              options={[
                { value: "claude-code", label: "Claude Code" },
                { value: "codex", label: T.settings.codex },
              ]}
            />
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {(bureau.agentTool ?? "claude-code") === "codex" ? T.settings.codexHint : T.settings.agentToolHint}
            </p>
          </div>
          )}
          {!ctx.simple && (
          <div className="field">
            <label>{T.settings.trust}</label>
            <Segmented
              label={T.settings.trust}
              value={bureau.trustMode}
              onChange={(trustMode) => void actions.updateWorkspace(bureau.id, { trustMode })}
              options={[
                { value: "full", label: T.settings.full },
                { value: "restricted", label: T.settings.restricted },
              ]}
            />
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              {bureau.trustMode === "full" ? T.settings.fullHint : T.settings.restrictedHint}
            </p>
            <p className="muted" style={{ fontSize: 12 }}>
              {T.settings.trustNote}
            </p>
          </div>
          )}
        </section>

        {!ctx.simple && <Connectors ctx={ctx} />}
        <PhoneSettings ctx={ctx} />

        <section className="panel blueprint">
          <Corners />
          <h4>{T.settings.tools}</h4>
          <Tools ctx={ctx} compact />
          <a onClick={() => ctx.go({ screen: "setup" })}>{T.settings.openSetup}</a>
        </section>

        <section className="panel blueprint" hidden={ctx.simple}>
          <Corners />
          <h4>{T.settings.connections}</h4>
          <div className="field">
            <label htmlFor="service">{T.settings.serviceUrl}</label>
            <input id="service" className="input mono" readOnly value={CORE_URL} />
          </div>
          <p className="state-line" style={{ color: online ? "var(--st-work)" : "var(--st-err)" }}>
            <I icon={online ? Wifi : WifiOff} />
            {online ? T.settings.connected : T.settings.disconnected}
          </p>
          <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={actions.reconnect}>
            <I icon={RefreshCw} size={14} />
            {T.settings.reconnect}
          </button>
        </section>

        <section className="panel blueprint">
          <Corners />
          <h4>{T.settings.appearance}</h4>
          <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={showTour}>
            {T.tour.again}
          </button>
          <UpdateSettings updates={ctx.updates} />
          <div className="field">
            <label>{T.mode.label}</label>
            <Segmented<"simple" | "advanced">
              label={T.mode.label}
              value={ctx.simple ? "simple" : "advanced"}
              onChange={(mode) => ctx.setSimple(mode === "simple")}
              options={[
                { value: "simple", label: T.mode.simple },
                { value: "advanced", label: T.mode.advanced },
              ]}
            />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {ctx.simple ? T.mode.simpleHint : T.mode.advancedHint}
            </p>
          </div>
          <div className="field">
            <label>{T.settings.theme}</label>
            <Segmented
              label={T.settings.theme}
              value={ctx.theme}
              onChange={ctx.setTheme}
              options={[
                { value: "light", label: T.settings.light },
                { value: "dark", label: T.settings.dark },
              ]}
            />
          </div>
          <div className="field">
            <label>{T.settings.language}</label>
            <Segmented<Language>
              label={T.settings.language}
              value={language}
              onChange={setLanguage}
              options={(Object.keys(LANGUAGES) as Language[]).map((value) => ({ value, label: LANGUAGES[value] }))}
            />
          </div>
        </section>
      </div>
    </>
  );
}
