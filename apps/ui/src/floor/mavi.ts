import { DOGS, LOUNGE_SEATS } from "./decor";
import type { Point } from "./model";

/**
 * Mavi, the youngest in the office, drawn here as a pixel map so she can be tuned by hand. She
 * belongs to no skin and does no work: she plays ball with one of the dogs, then goes and sits on
 * the sofa on that side with her tablet, then finds the other dog. Original art for this project
 * (MIT), smaller than the characters she walks among.
 */
const PALETTE: Record<string, string> = {
  O: "#1a1c2c", // eyes, as dark as the pack's outline
  H: "#3a2418", // hair: long, dark brown, parted in the middle
  h: "#57382a", // hair where the light falls
  S: "#f0c4a4", // skin
  M: "#c9706a", // mouth
  P: "#f3a9c6", // shirt: pink
  p: "#b9a6e8", // shirt: the lilac in it
  L: "#6f8fc9", // shorts
  W: "#f6f3ec", // shoes
  T: "#2a2f3a", // the tablet
  B: "#9fe3ff", // its screen
};

const HEAD = [
  "...HHhHHH...",
  "..HHhHHhHH..",
  "..HHSHHSHH..",
  "..HSSSSSSH..",
  "..HSOSSOSH..",
  "..HSSSSSSH..",
  "..HHSMMSHH..",
];

/** On her feet, in the two steps of a walk. */
const STANDING: [string[], string[]] = [
  [...HEAD, ".HHPPPpPPHH.", ".HSPPpPPPSH.", "..SPpPPPPS..", "...PPPPpP...", "...LLLLLL...", "...LL..LL...", "...SS..SS...", "...SS..SS...", "..WWW..WWW.."],
  [...HEAD, ".HHPPPpPPHH.", ".HSPPpPPPSH.", "..SPpPPPPS..", "...PPPPpP...", "...LLLLLL...", "...LL..LL...", "...SS..SS...", "...SS..WWW..", "..WWW......."],
];

/** One arm up, for throwing the ball and for clapping along. */
const ARM_UP = [...HEAD.slice(0, 5), "..HSSSSSSH.S", "..HHSMMSHH.S", ".HHPPPpPPHS.", ".HSPPpPPP...", "..SPpPPPP...", "...PPPPpP...", "...LLLLLL...", "...LL..LL...", "...SS..SS...", "...SS..SS...", "..WWW..WWW.."];

/** On a sofa, knees forward, the tablet held up in both hands. */
const SITTING = [...HEAD, ".HHPPPpPPHH.", ".HSTTTTTTSH.", "..STBBBBTS..", "...TBBBBT...", "..LLTTTTLL..", "..LLL..LLL..", "..SS....SS..", "..WW....WW.."];

/** Floor units a second: a child's pace, quicker than the peritos'. */
const SPEED = 95;
/** One round: with a dog first, then on the sofa. */
const ROUND = 110;
const PLAY = 50;

/** The two ends of the office she moves between: a dog, a way up the side, and a sofa. */
const SIDES = [
  // Luna's end. Up the left wall, clear of the desks.
  { dog: "Luna", beside: -48, down: [{ x: 18, y: 190 }, { x: 18, y: 648 }] as Point[], seat: 1, floor: { x: 322, y: 182 } },
  // Berlin's end. Down the right wall, then in above the archive shelf.
  { dog: "Berlin", beside: 48, down: [{ x: 1182, y: 190 }, { x: 1182, y: 548 }, { x: 940, y: 548 }, { x: 940, y: 648 }] as Point[], seat: 3, floor: { x: 882, y: 182 } },
];

/** Where she stands to play: beside the dog, on the side away from your desk, and never behind the archive shelf. */
const beside = (side: (typeof SIDES)[number], dogX: number): Point => ({ x: Math.max(24, Math.min(936, dogX + side.beside)), y: 648 });

/** Where a dog is on its own lane, errands aside. */
function dogAt(name: string, seconds: number): { x: number; y: number; resting: boolean } {
  const dog = DOGS.find((one) => one.name === name)!;
  const walk = (dog.secondsPerLap - 2 * dog.restSeconds) / 2;
  const t = seconds % dog.secondsPerLap;
  const outbound = t < walk + dog.restSeconds;
  const sinceTurn = outbound ? t : t - walk - dog.restSeconds;
  const progress = outbound ? Math.min(1, t / walk) : 1 - Math.min(1, sinceTurn / walk);
  return { x: dog.from + (dog.to - dog.from) * progress, y: dog.y, resting: sinceTurn >= walk };
}

export interface Mavi {
  at: Point;
  round: number;
  phase: "play" | "sofa";
  /** The corners still ahead of her on the way she is going. */
  path: Point[];
  facingRight: boolean;
  moving: boolean;
}

export function newMavi(): Mavi {
  return { at: { x: 0, y: 0 }, round: -1, phase: "play", path: [], facingRight: false, moving: false };
}

/** The sofa seat she takes on a side, or the rug in front of it if peritos off duty have filled the sofas that far. */
function seatOn(side: (typeof SIDES)[number], lounging: number): Point {
  const seat = LOUNGE_SEATS[side.seat]!;
  return lounging > side.seat ? side.floor : { x: seat.x, y: seat.y - 6 };
}

/**
 * Moves her on by `elapsed` seconds. `lounging` is how many sofa seats the peritos are using.
 * With `still` she just sits on a sofa, for people who have asked their system for less motion.
 */
export function stepMavi(mavi: Mavi, seconds: number, elapsed: number, lounging: number, still: boolean): { sitting: boolean; ball: Point | null; throwing: boolean } {
  const round = Math.floor(seconds / ROUND);
  const side = SIDES[round % 2]!;
  const seat = seatOn(side, lounging);
  if (still) {
    mavi.at = seat;
    mavi.moving = false;
    return { sitting: true, ball: null, throwing: false };
  }
  const phase = seconds % ROUND < PLAY ? "play" : "sofa";
  if (mavi.round === -1) {
    // The floor has just opened: she is found where the hour puts her, not on the way.
    const dog = dogAt(side.dog, seconds);
    mavi.at = phase === "play" ? beside(side, dog.x) : seat;
    mavi.round = round;
    mavi.phase = phase;
  }
  if (round !== mavi.round || phase !== mavi.phase) {
    if (phase === "sofa") mavi.path = [...side.down].reverse();
    else {
      // From the last sofa along the aisle under the lounges, and down this side.
      const last = SIDES[(round + 1) % 2]!;
      mavi.path = [{ x: seatOn(last, lounging).x, y: 190 }, ...side.down];
    }
    if (phase === "sofa") mavi.path.push({ x: seat.x, y: 190 });
    mavi.round = round;
    mavi.phase = phase;
  }

  const dog = dogAt(side.dog, seconds);
  const goal = mavi.path[0] ?? (phase === "play" ? beside(side, dog.x) : seat);
  const dx = goal.x - mavi.at.x;
  const dy = goal.y - mavi.at.y;
  const far = Math.hypot(dx, dy);
  const step = SPEED * elapsed;
  mavi.moving = far > 1.5;
  if (far <= step) {
    mavi.at = { ...goal };
    mavi.path.shift();
  } else {
    mavi.at = { x: mavi.at.x + (dx / far) * step, y: mavi.at.y + (dy / far) * step };
  }
  if (Math.abs(dx) > 1) mavi.facingRight = dx > 0;

  const arrived = !mavi.moving && mavi.path.length === 0;
  if (phase === "sofa") return { sitting: arrived, ball: null, throwing: false };
  if (!arrived || !dog.resting) return { sitting: false, ball: null, throwing: false };
  // The dog has stopped: the ball goes over to it and comes back, in an arc.
  mavi.facingRight = dog.x > mavi.at.x;
  const swing = (seconds * 0.9) % 1;
  const there = swing < 0.5 ? swing * 2 : 2 - swing * 2;
  return {
    sitting: false,
    throwing: swing < 0.12,
    ball: { x: mavi.at.x + (dog.x - mavi.at.x) * (0.25 + 0.6 * there), y: mavi.at.y - 26 - Math.sin(there * Math.PI) * 30 },
  };
}

/** Draws her with her feet (or the sofa's edge) at (x, y). */
export function drawMavi(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  seconds: number,
  look: { sitting: boolean; moving: boolean; facingRight: boolean; armUp: boolean },
): number {
  const rows = look.sitting ? SITTING : look.armUp ? ARM_UP : STANDING[look.moving ? Math.floor(seconds * 6) % 2 : 0]!;
  const left = Math.round(x - 6 * scale);
  const top = Math.round(y - rows.length * scale);
  // The tablet's screen changes as she plays.
  const screen = ["#9fe3ff", "#c8f7a8", "#ffd6f0"][Math.floor(seconds * 1.5) % 3]!;
  rows.forEach((row, index) => {
    for (let column = 0; column < row.length; column++) {
      const key = row[look.facingRight ? row.length - 1 - column : column]!;
      const colour = key === "B" ? screen : PALETTE[key];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(left + column * scale, top + index * scale, scale, scale);
    }
  });
  return top;
}

/** The ball she throws for the dogs. */
export function drawBall(ctx: CanvasRenderingContext2D, at: Point, scale: number): void {
  ctx.fillStyle = "#f2c14e";
  ctx.fillRect(Math.round(at.x - scale), Math.round(at.y - scale), 2 * scale, 2 * scale);
  ctx.fillStyle = "#fff3c4";
  ctx.fillRect(Math.round(at.x - scale), Math.round(at.y - scale), scale, scale);
}
