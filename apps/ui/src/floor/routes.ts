import { FLOOR, type Point } from "./model";

/**
 * Walking routes across the floor. A perito who needs you leaves the desk and
 * queues in front of your seal desk; when you have answered, it walks back.
 *
 * Routes follow the aisles so nobody walks through furniture: out of the desk
 * into the aisle in front of its row, across to a gap in the next row, down,
 * and on to the queue.
 */

/** How far a walker travels per second, in floor units. */
export const WALK_SPEED = 170;

const ROW_1 = FLOOR.seats[0]!.y;
const ROW_2 = FLOOR.seats[4]!.y;
/** The aisle in front of a row of desks: just below the desks' front edge. */
const aisle = (rowY: number) => rowY + 58;
/** Where the second row leaves room to pass between its desks. */
const ROW_2_GAPS = [455, 745];
/** Feet of the first perito in the queue; the rest line up to the right. */
const QUEUE: Point = { x: FLOOR.seal.x - 118, y: FLOOR.seal.y - 48 };
const QUEUE_STEP = 46;

const nearest = (x: number, options: number[]) =>
  options.reduce((best, option) => (Math.abs(option - x) < Math.abs(best - x) ? option : best));

export const queueSpot = (place: number): Point => ({ x: QUEUE.x + place * QUEUE_STEP, y: QUEUE.y });

/** The points a perito passes, from where it stands at its desk to its place in the queue. */
export function routeToQueue(stand: Point, seat: Point, place: number): Point[] {
  const route: Point[] = [stand];
  if (seat.y < ROW_1) {
    // The lead: out front, then down through the middle of the first row.
    route.push({ x: stand.x, y: aisle(seat.y) }, { x: FLOOR.lead.x, y: aisle(seat.y) }, { x: FLOOR.lead.x, y: aisle(ROW_1) });
  } else if (seat.y === ROW_1) {
    route.push({ x: stand.x, y: aisle(ROW_1) });
  }
  if (seat.y <= ROW_1) {
    const gap = nearest(route.at(-1)!.x, ROW_2_GAPS);
    route.push({ x: gap, y: aisle(ROW_1) }, { x: gap, y: aisle(ROW_2) });
  } else {
    route.push({ x: stand.x, y: aisle(ROW_2) });
  }
  const spot = queueSpot(place);
  route.push({ x: spot.x, y: aisle(ROW_2) }, spot);
  return route;
}

export function routeLength(route: Point[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
  return total;
}

/** The point `distance` along the route, clamped to its ends. */
export function pointAlong(route: Point[], distance: number): Point {
  let left = Math.max(0, distance);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const leg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= leg) {
      const t = leg === 0 ? 0 : left / leg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= leg;
  }
  return route.at(-1)!;
}
