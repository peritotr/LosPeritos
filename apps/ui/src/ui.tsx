import type { ReactNode } from "react";
import {
  Activity,
  Check,
  CircleDashed,
  Clock,
  Eye,
  MessageCircleQuestion,
  PencilLine,
  Square,
  Stamp as StampIcon,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Agent, AgentStatus, Approval, Message, Task, TaskStatus, Workspace, WorkspaceKind } from "@losperitos/protocol";
import { T, fromCore } from "./strings";

/** A Lucide icon at the design's stroke weight. */
export function I({ icon: Glyph, size = 15 }: { icon: LucideIcon; size?: number }) {
  return <Glyph className="icon" size={size} strokeWidth={1.5} aria-hidden />;
}

// ── Formatting ─────────────────────────────────────────────────────────────

export const money = (usd: number) => `$${usd.toFixed(2)}`;
export const pad = (n: number, width = 4) => String(n).padStart(width, "0");
export const fileRef = (task: Pick<Task, "number">) => `F-${pad(task.number)}`;
export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return T.time.now;
  if (minutes < 60) return T.time.minutes(minutes);
  if (minutes < 60 * 24) return T.time.hours(Math.round(minutes / 60));
  return T.time.days(Math.round(minutes / 1440));
}

/** `S-0003`: approvals are numbered per bureau in the order they were raised. */
export function sealRef(approval: Approval, all: Approval[]): string {
  const peers = all
    .filter((a) => a.workspaceId === approval.workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return `S-${pad(peers.findIndex((a) => a.id === approval.id) + 1)}`;
}

export function questionRef(message: Message, all: Message[]): string {
  const peers = all
    .filter((m) => m.workspaceId === message.workspaceId && m.question)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return `Q-${pad(peers.findIndex((m) => m.id === message.id) + 1)}`;
}

// ── Peritos ────────────────────────────────────────────────────────────────

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const TOOL: Record<Agent["adapter"], string> = { "claude-code": "Claude Code", codex: "Codex", fake: T.perito.demoTool };
const KNOWN_ROLES = ["architect", "developer", "auditor", "tester", "designer"] as const;
export type EmblemRole = "lead" | (typeof KNOWN_ROLES)[number] | "other";

export interface Perito {
  role: EmblemRole;
  /** "Developer", "Lead Perito". */
  title: string;
  /** "Developer II": unique within the bureau. */
  who: string;
  /** "Perito II · Claude Code". */
  sub: string;
  mono: string;
  tool: string;
}

/** How an agent is presented: its speciality, seat numeral and emblem. */
export function perito(agent: Agent, all: Agent[]): Perito {
  const tool = TOOL[agent.adapter];
  if (agent.role === "lead") {
    return {
      role: "lead",
      title: T.perito.lead,
      who: agent.nickname || T.perito.lead,
      sub: `${agent.nickname ? T.perito.lead : T.perito.leadSub} · ${tool}`,
      mono: "BP",
      tool,
    };
  }
  const seat = all.filter((a) => a.workspaceId === agent.workspaceId && a.role === "member").indexOf(agent) + 1;
  const speciality = (agent.specialty ?? "perito").toLowerCase();
  const numeral = ROMAN[seat] ?? String(seat);
  // Only the software roles have an emblem of their own.
  const known = (KNOWN_ROLES as readonly string[]).includes(speciality);
  // Known specialities are translated; anything else the lead invented is shown as written.
  const title = speciality in T.perito.roles
    ? T.perito.roles[speciality as keyof typeof T.perito.roles]
    : speciality.charAt(0).toUpperCase() + speciality.slice(1);
  const consonants = speciality.replace(/[aeiou]/g, "");
  return {
    role: known ? (speciality as EmblemRole) : "other",
    title,
    // A nickname replaces "Developer II"; the speciality then moves to the line below.
    who: agent.nickname || `${title} ${numeral}`,
    sub: agent.nickname ? `${title} · Perito ${numeral} · ${tool}` : `Perito ${numeral} · ${tool}`,
    mono: (speciality[0]! + (consonants[1] ?? speciality[1] ?? "")).toUpperCase(),
    tool,
  };
}

const MARK: Record<EmblemRole, ReactNode> = {
  lead: <rect x={5} y={5} width={30} height={30} />,
  architect: <path d="M1 14 L14 1" />,
  developer: <path d="M1 14h5M1 26h5M39 14h-5M39 26h-5" />,
  auditor: <circle cx={20} cy={20} r={15} />,
  tester: <path d="M20 3 37 20 20 37 3 20Z" />,
  designer: <path d="M39 22A17 17 0 0 0 22 39" />,
  other: null,
};

/** The emblem's inner drawing, on a 40-unit grid; reused inside the floor SVG. */
export function EmblemMarks({ role, mono, stroke = 1 }: { role: EmblemRole; mono: string; stroke?: number }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={stroke}>
      <rect x={1} y={1} width={38} height={38} />
      {MARK[role]}
      <text
        x={20}
        y={25}
        textAnchor="middle"
        fontFamily="var(--font-heading)"
        fontWeight={600}
        fontSize={mono.length > 2 ? 11 : 14}
        fill="currentColor"
        stroke="none"
        letterSpacing=".04em"
      >
        {mono}
      </text>
    </g>
  );
}

/** A perito's mark: a square frame, one geometric figure and a monogram. No faces. */
export function Emblem({ role, mono, size = 40 }: { role: EmblemRole; mono: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={T.emblem(role === "other" ? mono : role)}
    >
      <EmblemMarks role={role} mono={mono} stroke={40 / size} />
    </svg>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  icon: LucideIcon;
  color: string;
  ground?: string;
}

export const AGENT_STATUS: Record<AgentStatus, StatusMeta> = {
  idle: { label: T.status.idle, icon: CircleDashed, color: "var(--st-idle)" },
  stopped: { label: T.status.stopped, icon: Square, color: "var(--st-idle)" },
  working: { label: T.status.working, icon: Activity, color: "var(--st-work)", ground: "var(--st-work-bg)" },
  asking: { label: T.status.asking, icon: MessageCircleQuestion, color: "var(--st-act)", ground: "var(--st-act-bg)" },
  awaiting_approval: { label: T.status.awaitingSeal, icon: StampIcon, color: "var(--st-act)", ground: "var(--st-act-bg)" },
  error: { label: T.status.error, icon: TriangleAlert, color: "var(--st-err)", ground: "var(--st-err-bg)" },
  limited: { label: T.status.limited, icon: Clock, color: "var(--st-warn)", ground: "var(--st-warn-bg)" },
};

export const TASK_STATUS: Record<TaskStatus, StatusMeta> = {
  draft: { label: T.file.draft, icon: PencilLine, color: "var(--st-idle)" },
  queued: { label: T.file.queued, icon: Clock, color: "var(--st-idle)" },
  in_progress: { label: T.file.inProgress, icon: Activity, color: "var(--st-work)", ground: "var(--st-work-bg)" },
  in_review: { label: T.file.inReview, icon: Eye, color: "var(--st-warn)", ground: "var(--st-warn-bg)" },
  awaiting_approval: { label: T.status.awaitingSeal, icon: StampIcon, color: "var(--st-act)", ground: "var(--st-act-bg)" },
  done: { label: T.file.closed, icon: Check, color: "var(--st-done)" },
  cancelled: { label: T.file.cancelled, icon: Square, color: "var(--st-idle)" },
};

/** Status is never colour alone: always an icon and a label. */
export function Badge({ meta }: { meta: StatusMeta }) {
  return (
    <span className="badge" style={{ color: meta.color, background: meta.ground }}>
      <I icon={meta.icon} size={13} />
      {meta.label}
    </span>
  );
}

// ── Frames ─────────────────────────────────────────────────────────────────

/** Four registration marks; the parent carries the `blueprint` class. */
export function Corners() {
  return (
    <>
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />
    </>
  );
}

export function Stamp({
  kind,
  sub,
  animate,
}: {
  kind: "approved" | "declined" | "pending";
  sub?: string;
  animate?: boolean;
}) {
  const label = { approved: T.seal.sealed, declined: T.seal.declined, pending: T.seal.awaiting }[kind];
  return (
    <div className={`stamp ${kind} ${animate ? "animate" : ""}`} role="img" aria-label={label}>
      {label}
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function PageHead({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="grow">
        <div className="kicker">{kicker}</div>
        <h2>{title}</h2>
      </div>
      {children}
    </header>
  );
}

export function Empty({ icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <I icon={icon} size={34} />
      <h4>{title}</h4>
      {children && <p>{children}</p>}
    </div>
  );
}

/** A two-option switch. Selection is ink, not the accent. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: Array<{ value: V; label: string; icon?: LucideIcon }>;
  onChange(value: V): void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.icon && <I icon={option.icon} size={14} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * An agent tool's own words for "you are not signed in" vary and say little.
 * Where an error reads like one, what to do about it is added.
 */
export function explainError(text: string): string {
  return /oauth|authenticat|unauthori[sz]ed|\b401\b|not logged in|invalid api key|credential|\/login/i.test(text) ? `${text}\n\n${T.status.signInHint}` : text;
}

export const kindOf = (bureau: Workspace): WorkspaceKind => bureau.kind ?? "software";

/** Outside a software bureau a branch is called a draft, and its git name stays out of sight. */
export function branchText(bureau: Workspace, task: Task | undefined, none: string): string {
  const software = kindOf(bureau) === "software";
  // Without git a document bureau keeps the task's work in a draft folder instead.
  if (!task?.branch) return task?.worktree && !software ? T.files.ownDraft : none;
  return software ? task.branch : T.files.ownDraft;
}

/** What a seal is for; in a document bureau a merge is the acceptance of a draft. */
export function sealKind(bureau: Workspace, approval: Approval): string {
  return approval.kind === "merge" && kindOf(bureau) !== "software" ? T.files.draft : T.seal.kind[approval.kind];
}

/**
 * A seal's wording in the interface language. Only merge seals are written by
 * the core; the rest is the agent's own text and is shown as written.
 */
/**
 * Seals raised by older versions carry a tool's internal name and its
 * arguments as raw data for a title; they are read the way new ones are written.
 */
function plainTitle(title: string): string {
  const [, tool, data] = /^([\w-]+): (\{.*)$/s.exec(title) ?? [];
  if (!tool) return title;
  const [, server, call] = /^mcp__(.+?)__(.+)$/.exec(tool) ?? [];
  const name = server && call ? `${server.replace(/^claude_ai_/, "").replace(/_/g, " ")}: ${call}` : tool;
  if (server) return name;
  const main = /"(?:command|query|url|file_path|path|pattern|prompt)":"((?:[^"\\]|\\.)*)/.exec(data ?? "")?.[1];
  return main ? `${name}: ${main.replace(/\\(.)/g, "$1")}` : name;
}

export function sealText(approval: Approval): { title: string; detail: string; steps: string[] } {
  const own = approval.kind === "merge" ? fromCore : (text: string) => text;
  return { title: plainTitle(own(approval.title)), detail: own(approval.detail), steps: approval.steps.map(own) };
}
