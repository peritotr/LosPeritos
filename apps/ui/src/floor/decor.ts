import type { Point } from "./model";

/**
 * Where the floor's set dressing stands, in floor units. Each point is the
 * bottom centre of the drawing. Names refer to props in the active skin; a
 * prop the skin does not have is simply not drawn.
 *
 * The two top corners form a lounge: the Lead Perito's desk sits between them
 * and nothing else uses that strip.
 */
export const DECOR: Array<{ prop: string } & Point> = [
  // Left lounge.
  { prop: "vending", x: 76, y: 152 },
  { prop: "snackShelf", x: 156, y: 152 },
  { prop: "cooler", x: 216, y: 152 },
  { prop: "sofaWarm", x: 322, y: 152 },
  { prop: "plant", x: 412, y: 152 },
  // Right lounge.
  { prop: "plant", x: 790, y: 152 },
  { prop: "sofaCool", x: 882, y: 152 },
  { prop: "table", x: 1006, y: 152 },
  { prop: "coffeeMachine", x: 992, y: 110 },
  { prop: "mug", x: 1020, y: 110 },
  { prop: "binGreen", x: 1096, y: 152 },
  { prop: "binBlue", x: 1130, y: 152 },
  // By the archive shelf.
  { prop: "plant", x: 1160, y: 652 },
];

/**
 * A perito's desk, as offsets from the seat's centre to each piece's bottom
 * centre. Drawn back to front: partition, the perito, then the desk and its
 * computer, so the desk hides the legs of whoever stands behind it.
 */
export const DESK = {
  partitionLeft: { x: -30, y: -19 },
  partitionRight: { x: 30, y: -19 },
  figure: { x: -22, y: 4 },
  desk: { x: 0, y: 40 },
  computer: { x: 29, y: -2 },
};

/** Where peritos who are off duty sit, two to a sofa. More than four are not shown. */
export const LOUNGE_SEATS: Point[] = [
  { x: 298, y: 158 },
  { x: 346, y: 158 },
  { x: 858, y: 158 },
  { x: 906, y: 158 },
];

/**
 * The office dogs. Each strolls back and forth along its lane and lies down
 * for a rest at either end. `kind` names a pet sheet in the active skin; a
 * dog whose kind the skin lacks is not drawn. Rename them, or add your own.
 */
export const DOGS = [
  // Berlin, a French bulldog: short strolls, long naps by the archive shelf.
  { name: "Berlin", kind: "frenchBulldog", from: 770, to: 925, y: 660, secondsPerLap: 44, restSeconds: 15 },
  // Luna, an English setter: always on the move along the front of the floor.
  { name: "Luna", kind: "englishSetter", from: 80, to: 395, y: 660, secondsPerLap: 24, restSeconds: 4 },
];
