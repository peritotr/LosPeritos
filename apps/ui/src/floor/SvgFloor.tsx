import { AnimatePresence, motion } from "motion/react";
import { T, dateLocale } from "../strings";
import { AGENT_STATUS, EmblemMarks, fileRef } from "../ui";
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
}

export function SvgFloor({ model, onOpen, onFlightDone, onStampDone }: FloorProps) {
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
