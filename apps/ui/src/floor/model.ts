import type { Agent, Approval, Task } from "@losperitos/protocol";
import type { Flight, FloorStamp } from "../store";
import { perito, type Perito } from "../ui";

/**
 * The bureau floor as plain data: who sits where, in what pose, and where
 * every file lies. It knows nothing about drawing, so any renderer (the SVG
 * one today, sprites or Rive later) can be built on the same model.
 *
 * Coordinates are in floor units on a `FLOOR.width × FLOOR.height` plane;
 * points are the centres of things.
 */

export interface Point {
  x: number;
  y: number;
}

export const FLOOR = {
  width: 1200,
  height: 680,
  // The top margin leaves headroom for a character standing behind the lead's desk.
  lead: { x: 600, y: 124 } as Point,
  seats: [
    { x: 165, y: 294 },
    { x: 455, y: 294 },
    { x: 745, y: 294 },
    { x: 1035, y: 294 },
    { x: 310, y: 452 },
    { x: 600, y: 452 },
    { x: 890, y: 452 },
  ] as Point[],
  /** The user's desk, where files wait for the seal. */
  seal: { x: 600, y: 606 } as Point,
  /** Where closed files are shelved. */
  shelf: { x: 1035, y: 606 } as Point,
};

/** What a perito is visibly doing. A renderer maps each pose to an animation. */
export type Pose = "idle" | "working" | "asking" | "awaiting_seal" | "error" | "off_duty";

const POSE: Record<Agent["status"], Pose> = {
  idle: "idle",
  working: "working",
  asking: "asking",
  awaiting_approval: "awaiting_seal",
  error: "error",
  stopped: "off_duty",
};

export interface Actor {
  agent: Agent;
  view: Perito;
  seat: Point;
  lead: boolean;
  pose: Pose;
  /** The newest line of output, for a caption while working. */
  lastLine: string;
}

export type FilePlace = "lead" | "desk" | "seal" | "shelf";

export interface FloorFile {
  task: Task;
  at: Point;
  place: FilePlace;
}

export interface FloorModel {
  actors: Actor[];
  /** Seats nobody has taken yet. */
  vacant: Point[];
  /** One line of command from the lead to each seat; live when that seat has a file. */
  wires: Array<{ to: Point; live: boolean }>;
  files: FloorFile[];
  /** Requests that are not a file merge (publish, command), lying on the seal desk. */
  slips: Array<{ approval: Approval; from: Point; at: Point }>;
  /** Notes in the air right now. */
  flights: Array<{ id: string; from: Point; to: Point }>;
  stamps: FloorStamp[];
  pending: number;
  closed: number;
}

export interface FloorInput {
  agents: Agent[];
  tasks: Task[];
  approvals: Approval[];
  flights: Flight[];
  stamps: FloorStamp[];
  output: Record<string, string[]>;
}

export function buildFloor({ agents, tasks, approvals, flights, stamps, output }: FloorInput): FloorModel {
  const lead = agents.find((agent) => agent.role === "lead");
  const members = agents.filter((agent) => agent.role === "member").slice(0, FLOOR.seats.length);

  const seatOf = (id: string): Point | undefined => {
    if (id === "user") return FLOOR.seal;
    if (id === lead?.id) return FLOOR.lead;
    const index = members.findIndex((member) => member.id === id);
    return index === -1 ? undefined : FLOOR.seats[index];
  };

  const actor = (agent: Agent, seat: Point): Actor => ({
    agent,
    view: perito(agent, agents),
    seat,
    lead: agent.role === "lead",
    pose: POSE[agent.status],
    lastLine: output[agent.id]?.at(-1) ?? "",
  });

  const pending = approvals.filter((approval) => approval.status === "pending");
  // A file stays under the seal while its stamp is coming down.
  const sealing = new Set(stamps.map((stamp) => stamp.taskId));
  const closed = tasks.filter((task) => task.status === "done");
  const shelved = closed.slice(-4);
  const queued = tasks.filter((task) => task.status === "queued" || task.status === "draft");
  const awaiting = tasks.filter((task) => task.status === "awaiting_approval");

  const place = (task: Task): Omit<FloorFile, "task"> | null => {
    if (sealing.has(task.id)) return { place: "seal", at: FLOOR.seal };
    switch (task.status) {
      case "draft":
      case "queued": {
        const index = queued.indexOf(task);
        return { place: "lead", at: { x: FLOOR.lead.x + 132 + index * 12, y: FLOOR.lead.y + index * 5 } };
      }
      case "in_progress":
      case "in_review": {
        const seat = task.assigneeId ? seatOf(task.assigneeId) : undefined;
        return seat ? { place: "desk", at: { x: seat.x + 108, y: seat.y + 8 } } : null;
      }
      case "awaiting_approval":
        return { place: "seal", at: { x: FLOOR.seal.x - 16 + awaiting.indexOf(task) * 18, y: FLOOR.seal.y - 4 } };
      case "done": {
        const slot = shelved.indexOf(task);
        return slot === -1 ? null : { place: "shelf", at: { x: FLOOR.shelf.x - 54 + slot * 36, y: FLOOR.shelf.y - 2 } };
      }
      case "cancelled":
        return null;
    }
  };

  return {
    actors: [...(lead ? [actor(lead, FLOOR.lead)] : []), ...members.map((member, index) => actor(member, FLOOR.seats[index]!))],
    vacant: FLOOR.seats.slice(members.length),
    wires: FLOOR.seats.map((to, index) => ({ to, live: !!members[index]?.taskId })),
    files: tasks.flatMap((task) => {
      const at = place(task);
      return at ? [{ task, ...at }] : [];
    }),
    slips: pending
      .filter((approval) => {
        const task = approval.taskId ? tasks.find((t) => t.id === approval.taskId) : undefined;
        return !task || task.status !== "awaiting_approval";
      })
      .map((approval, index) => ({
        approval,
        from: seatOf(approval.agentId) ?? FLOOR.lead,
        at: { x: FLOOR.seal.x - 30 + index * 18, y: FLOOR.seal.y - 2 - index * 3 },
      })),
    flights: flights.flatMap((flight) => {
      const from = seatOf(flight.from);
      const to = seatOf(flight.to);
      return from && to ? [{ id: flight.id, from, to }] : [];
    }),
    stamps,
    pending: pending.length,
    closed: closed.length,
  };
}
