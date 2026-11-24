import { AnimatePresence, motion } from "motion/react";
import type { BudgetState } from "@losperitos/protocol";
import { T, dateLocale } from "../strings";
import { AGENT_STATUS, EmblemMarks, clock, fileRef, money } from "../ui";
import { FLOOR, type Actor, type FloorModel } from "./model";

/**
 * The floor drawn as SVG and animated with Motion. It only draws what
 * `buildFloor` hands it; a different renderer can replace this file without
 * touching the model.
 */

const slide = { type: "spring", stiffness: 90, damping: 17 } as const;

export interface FloorProps {
  model: FloorModel;
  onOpen(agentId: string): void;
  onFlightDone(id: string): void;
  onStampDone(id: string): void;
  /** Today's usage, for the board on the wall. */
  usage?: BudgetState;
  onBoard?(): void;
}

export function SvgFloor({ model, onOpen, onFlightDone, onStampDone, usage, onBoard }: FloorProps) {
  const { lead, seal, shelf } = FLOOR;
  return (
    <svg
      className="scene"
      viewBox={`0 0 ${FLOOR.width} ${FLOOR.height}`}
      role="img"
      aria-label={T.bench.floorLabel(model.actors.length, model.pending)}
    >
      {model.wires.map((wire, index) => (
        <path
          key={index}
          d={`M${lead.x} ${lead.y + 44} V${(lead.y + wire.to.y) / 2} H${wire.to.x} V${wire.to.y - 44}`}
          className={`wire ${wire.live ? "live" : ""}`}
        />
      ))}

      {usage && <Board usage={usage} onOpen={onBoard} />}

      {model.vacant.map((seat) => (
        <g key={`${seat.x}-${seat.y}`} transform={`translate(${seat.x} ${seat.y})`} className="seat-empty">
          <rect x={-84} y={-40} width={168} height={80} />
          <text y={4} textAnchor="middle">
            {T.bench.vacant}
          </text>
        </g>
      ))}

      <AnimatePresence initial={false}>
        {model.actors.map((actor) => (
          <Desk key={actor.agent.id} actor={actor} onOpen={onOpen} />
        ))}
      </AnimatePresence>

      {/* Your desk: nothing ships until the seal comes down here. */}
      <g transform={`translate(${seal.x} ${seal.y})`} className={`seal-desk ${model.pending ? "waiting" : ""}`}>
        <rect x={-136} y={-42} width={272} height={84} className="desk-top" />
        <rect x={-140} y={-46} width={280} height={92} className="seal-ring" />
        <g transform="translate(-100 2)">
          <path d="M-12 14h24v-9h-24zM-5 5v-8a5 5 0 1 1 10 0v8" className="stamp-tool" />
        </g>
        <text x={84} y={-10} textAnchor="middle" className="desk-name">
          {T.bench.yourSeal}
        </text>
        <text x={84} y={8} textAnchor="middle" className="desk-status">
          {model.pending ? T.bench.waiting(model.pending) : T.bench.nothingWaiting}
        </text>
      </g>

      <g transform={`translate(${shelf.x} ${shelf.y})`} className="shelf">
        <rect x={-84} y={-42} width={168} height={84} />
        <path d="M-84 24H84" />
        <text y={-52} textAnchor="middle" className="desk-status">
          {T.bench.shelf(model.closed)}
        </text>
      </g>

      <AnimatePresence initial={false}>
        {model.slips.map(({ approval, from, at }) => (
          <motion.g
            key={approval.id}
            className="slip"
            initial={{ x: from.x, y: from.y, opacity: 0 }}
            animate={{ x: at.x, y: at.y, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={slide}
          >
            <rect x={-20} y={-26} width={40} height={52} transform="rotate(-5)" />
            <path d="M-11 -11H11M-11 -1H11M-11 9H3" transform="rotate(-5)" />
          </motion.g>
        ))}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {model.files.map(({ task, at }) => (
          <motion.g
            key={task.id}
            className={`dossier ${task.status}`}
            initial={{ x: lead.x, y: lead.y, opacity: 0 }}
            animate={{ x: at.x, y: at.y, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={slide}
          >
            <title>{`${fileRef(task)} ${task.title}`}</title>
            <path d="M-26 -17h18l5 6h29v6h-52z" />
            <rect x={-26} y={-11} width={52} height={28} />
            <text y={7} textAnchor="middle">
              {fileRef(task)}
            </text>
          </motion.g>
        ))}
      </AnimatePresence>

      {/* Notes passed between seats. */}
      <AnimatePresence>
        {model.flights.map(({ id, from, to }) => (
          <motion.g
            key={id}
            className="note-fly"
            initial={{ x: from.x, y: from.y, opacity: 0 }}
            animate={{
              x: [from.x, (from.x + to.x) / 2, to.x],
              y: [from.y, Math.min(from.y, to.y) - 50, to.y],
              opacity: [0, 1, 1, 0],
            }}
            transition={{ duration: 1.1, ease: "easeInOut" }}
            onAnimationComplete={() => onFlightDone(id)}
          >
            <rect x={-11} y={-8} width={22} height={16} />
            <path d="M-11 -8l11 8l11-8" />
          </motion.g>
        ))}
      </AnimatePresence>

      {/* The seal coming down. */}
      <AnimatePresence>
        {model.stamps.map((stamp) => (
          <motion.g
            key={stamp.id}
            className={`scene-stamp ${stamp.approved ? "" : "declined"}`}
            style={{ x: seal.x - 8, y: seal.y - 4 }}
            initial={{ scale: 2.3, opacity: 0, rotate: -6 }}
            animate={{ scale: [2.3, 0.93, 1], opacity: [0, 1, 1], rotate: -6 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.3, 0.8, 0.3, 1] }}
            onAnimationComplete={() => setTimeout(() => onStampDone(stamp.id), 1100)}
          >
            <rect x={-46} y={-16} width={92} height={32} strokeWidth={2} />
            <rect x={-50} y={-20} width={100} height={40} strokeWidth={1} />
            <text y={5} textAnchor="middle">
              {stamp.approved ? T.seal.sealed : T.seal.declined}
            </text>
          </motion.g>
        ))}
      </AnimatePresence>
    </svg>
  );
}

/** Where the usage board hangs: on the wall above the snacks, left of the first picture. */
const BOARD = { x: 198, y: 8, width: 160, height: 76 };

/** A moment as the board writes it: the hour if it is today, the date as well if it is not. */
function boardTime(iso: string): string {
  const at = new Date(iso);
  if (at.toDateString() === new Date().toDateString()) return clock(iso);
  return `${at.toLocaleDateString(dateLocale, { day: "numeric", month: "short" })} ${clock(iso)}`;
}

/**
 * The chalkboard on the wall: today's tokens, what is left of the daily budget, and what the tool
 * has said about the account's own allowance. Only what is known is written; nothing is guessed.
 */
function Board({ usage, onOpen }: { usage: BudgetState; onOpen?: (() => void) | undefined }) {
  const B = T.bench.board;
  const compact = new Intl.NumberFormat(dateLocale, { notation: "compact", maximumFractionDigits: 1 });
  const plain = (n: number) => n.toLocaleString(dateLocale);
  const { limitUsd, spentUsd } = usage;
  const share = limitUsd ? Math.min(1, spentUsd / limitUsd) : 0;
  const left = limitUsd === null ? null : Math.max(0, limitUsd - spentUsd);

  // An allowance whose renewal time has passed says nothing about now, unless it said there was room.
  const said = usage.allowance;
  const renewed = !!said?.resetAt && new Date(said.resetAt).getTime() <= Date.now();
  const allowance = said && renewed && said.status !== "ok" ? null : said;
  const renews = allowance?.resetAt && !renewed ? boardTime(allowance.resetAt) : null;
  const percent = allowance?.used != null ? Math.round(allowance.used * 100) : null;
  const line = !allowance
    ? B.limitUnknown
    : allowance.status === "spent"
      ? B.limitSpent
      : percent !== null
        ? B.limitShare(100 - percent)
        : allowance.status === "warning"
          ? B.limitLow
          : B.limitOk;
  const window = (allowance?.window && B.windows[allowance.window]) || B.account;
  const tip = [
    B.tipTokens(plain(usage.inputTokens), plain(usage.outputTokens)),
    B.tipCost(money(spentUsd)),
    left === null ? B.tipNoBudget : B.tipBudget(money(left), money(limitUsd!)),
    !allowance
      ? B.tipUnknown
      : allowance.status === "spent"
        ? B.tipSpent(window)
        : percent !== null
          ? B.tipShare(window, percent)
          : allowance.status === "warning"
            ? B.tipLow(window)
            : B.tipOk(window),
    renews && B.tipRenews(renews),
    allowance && percent === null && allowance.status === "ok" && B.tipNote,
    onOpen && B.tipOpen,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <g
      transform={`translate(${BOARD.x} ${BOARD.y})`}
      className={`board ${usage.level} ${allowance ? `limit-${allowance.status}` : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${B.label}. ${tip.replaceAll("\n", ". ")}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen?.();
      }}
    >
      <title>{tip}</title>
      <rect width={BOARD.width} height={BOARD.height} className="board-frame" />
      <rect x={3} y={3} width={BOARD.width - 6} height={BOARD.height - 6} className="board-slate" />
      <rect x={24} y={BOARD.height} width={BOARD.width - 48} height={3} className="board-frame" />
      <text x={11} y={18} className="board-small">
        {B.today}
      </text>
      <text x={BOARD.width - 11} y={18} textAnchor="end" className="board-small">
        {money(spentUsd)}
      </text>
      <text x={11} y={39} className="board-figure">
        {compact.format(usage.inputTokens + usage.outputTokens)}
        <tspan className="board-small" dx={5}>
          {B.tokens}
        </tspan>
      </text>
      {left !== null && (
        <>
          <rect x={11} y={46.5} width={52} height={5} className="board-bar" />
          <rect x={11} y={46.5} width={52 * share} height={5} className="board-bar-fill" />
        </>
      )}
      <text x={left === null ? 11 : BOARD.width - 11} y={52} textAnchor={left === null ? "start" : "end"} className="board-small board-budget">
        {left === null ? B.noBudget : left === 0 ? B.budgetSpent : B.left(money(left))}
      </text>
      <text x={11} y={66} className="board-small board-limit">
        {line}
      </text>
      {renews && (
        <text x={BOARD.width - 11} y={66} textAnchor="end" className="board-small board-limit">
          {B.renews(renews)}
        </text>
      )}
    </g>
  );
}

function Desk({ actor, onOpen }: { actor: Actor; onOpen(agentId: string): void }) {
  const { agent, view, seat, pose, lastLine } = actor;
  const working = pose === "working";
  const half = actor.lead ? 104 : 84;
  const status = AGENT_STATUS[agent.status].label;

  return (
    <motion.g
      className={`desk ${agent.status}`}
      initial={{ x: seat.x, y: seat.y - 14, opacity: 0 }}
      animate={{ x: seat.x, y: seat.y, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={slide}
      role="button"
      tabIndex={0}
      aria-label={`${view.who}, ${status}`}
      onClick={() => onOpen(agent.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(agent.id);
      }}
    >
      {/* What the browser shows on hover: who, doing what, on which file. */}
      <title>{[view.who, status, actor.file, lastLine].filter(Boolean).join("\n")}</title>
      <rect x={-half - 5} y={-45} width={half * 2 + 10} height={90} className="desk-focus" />
      <rect x={-half} y={-40} width={half * 2} height={80} className="desk-top" />

      {/* Desk lamp: the status light. */}
      <motion.circle
        cx={-half + 16}
        cy={-24}
        r={15}
        className="lamp-glow"
        animate={working ? { opacity: [0.2, 0.55, 0.2] } : { opacity: pose === "idle" || pose === "off_duty" ? 0 : 0.35 }}
        transition={working ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.4 }}
      />
      <rect x={-half + 11} y={-29} width={10} height={10} className="lamp" />

      <g transform={`translate(${-half + 34} -16) scale(0.95)`} className="emblem">
        <EmblemMarks role={view.role} mono={view.mono} />
      </g>

      {/* The page being written. */}
      <g transform={`translate(${half - 44} 0)`}>
        <rect x={-28} y={-30} width={56} height={60} className="sheet" />
        {[0, 1, 2, 3, 4].map((row) => (
          <motion.path
            key={row}
            d={`M-20 ${-20 + row * 10}H${row === 4 ? 2 : 20}`}
            className="sheet-line"
            initial={false}
            animate={
              working
                ? { pathLength: [0, 1], opacity: [0.2, 0.9] }
                : { pathLength: 1, opacity: pose === "off_duty" ? 0.15 : 0.4 }
            }
            transition={
              working
                ? { duration: 0.7, delay: row * 0.35, repeat: Infinity, repeatDelay: 1.2, ease: "easeOut" }
                : { duration: 0.3 }
            }
          />
        ))}
      </g>

      <AnimatePresence>
        {(pose === "asking" || pose === "error") && (
          <motion.g
            className={`flag ${agent.status}`}
            // Raised beside the seat, clear of a character standing behind the desk.
            initial={{ x: -74, y: -40, opacity: 0 }}
            animate={{ x: -74, y: [-62, -67, -62], opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ y: { duration: 1.6, repeat: Infinity, ease: "easeInOut" }, default: { duration: 0.25 } }}
          >
            <rect x={-14} y={-14} width={28} height={28} />
            <text y={6} textAnchor="middle">
              {pose === "asking" ? "?" : "!"}
            </text>
          </motion.g>
        )}
      </AnimatePresence>

      <text y={58} textAnchor="middle" className="desk-name">
        {view.who}
      </text>
      <text y={73} textAnchor="middle" className="desk-status">
        {status.toLocaleUpperCase(dateLocale)}
      </text>
      {working && lastLine && (
        <text y={87} textAnchor="middle" className="desk-line">
          {lastLine.length > 36 ? lastLine.slice(0, 35) + "…" : lastLine}
        </text>
      )}
    </motion.g>
  );
}
