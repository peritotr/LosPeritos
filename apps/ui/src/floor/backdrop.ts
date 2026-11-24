import { FLOOR } from "./model";
import type { FloorSkin, Prop } from "./skin";

/**
 * The room itself: back wall, plank floor and rugs. It is painted once into
 * an off-screen canvas per theme and then blitted every frame, because it
 * never changes while the floor is open.
 *
 * Everything is laid out on the art's pixel grid (`skin.scale` floor units per
 * pixel) so it sits crisply beside the sprites.
 */

/** Where the wall meets the floor, in floor units. Lounge furniture stands in front of it. */
const WALL_HEIGHT = 99;

const COLORS = {
  wall: "#e9e7e1",
  wallLine: "#d2d6d9",
  wallTrim: "#b8c0c8",
  baseboard: "#6b7683",
  planks: ["#d8c4a2", "#d0bb97", "#dcc9a9"],
  joint: "#b9a27e",
};

/** A rug: fill, darker border, and a thin line just inside it. */
interface Rug {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  border: string;
  line: string;
}

const RUGS: Rug[] = [
  // Under the desks: marks out the work area.
  { x: 36, y: 222, width: 1128, height: 330, fill: "#bcc9d5", border: "#8fa3b6", line: "#a9b9c8" },
  // The two lounges.
  { x: 246, y: 132, width: 204, height: 42, fill: "#c9795f", border: "#a85f49", line: "#d99680" },
  { x: 762, y: 132, width: 306, height: 42, fill: "#6f93b5", border: "#557a9c", line: "#8eadc9" },
  // Under the seal desk: the one spot in the accent colour.
  { x: 432, y: 558, width: 336, height: 108, fill: "#416180", border: "#2c455d", line: "#5980a6" },
];

/** Decoration hung on the wall: prop name and the bottom centre it hangs from. */
const WALL_ART: Array<{ prop: string; x: number; y: number }> = [
  { prop: "window", x: 471, y: 84 },
  { prop: "window", x: 729, y: 84 },
  { prop: "clock", x: 600, y: 36 },
  // Moved along to leave the wall above the snacks to the usage board (drawn by the SVG layer).
  { prop: "picture", x: 388, y: 72 },
  { prop: "picture", x: 882, y: 72 },
  { prop: "calendar", x: 1002, y: 66 },
  { prop: "door", x: 1170, y: WALL_HEIGHT },
];

function paint(ctx: CanvasRenderingContext2D, skin: FloorSkin, dark: boolean) {
  const px = skin.scale;
  const { width, height } = FLOOR;
  ctx.imageSmoothingEnabled = false;

  // Wall: panelled, with a trim along the top and a baseboard.
  ctx.fillStyle = COLORS.wall;
  ctx.fillRect(0, 0, width, WALL_HEIGHT);
  ctx.fillStyle = COLORS.wallLine;
  for (let y = 6 * px; y < WALL_HEIGHT - 2 * px; y += 6 * px) ctx.fillRect(0, y, width, px);
  ctx.fillStyle = COLORS.wallTrim;
  ctx.fillRect(0, 0, width, 2 * px);
  ctx.fillStyle = COLORS.baseboard;
  ctx.fillRect(0, WALL_HEIGHT - 2 * px, width, 2 * px);

  // Floor: rows of planks with staggered joints and a little variation in tone.
  const plankHeight = 8 * px;
  const plankLength = 40 * px;
  for (let row = 0, y = WALL_HEIGHT; y < height; row++, y += plankHeight) {
    const shift = ((row * 17) % 40) * px;
    for (let column = -1, x = -shift; x < width; column++, x += plankLength) {
      ctx.fillStyle = COLORS.planks[(row * 7 + column * 13 + 100) % COLORS.planks.length]!;
      ctx.fillRect(x, y, plankLength, plankHeight);
      ctx.fillStyle = COLORS.joint;
      ctx.fillRect(x, y, px, plankHeight);
    }
    ctx.fillStyle = COLORS.joint;
    ctx.fillRect(0, y, width, px);
  }

  for (const rug of RUGS) {
    ctx.fillStyle = rug.border;
    ctx.fillRect(rug.x, rug.y, rug.width, rug.height);
    ctx.fillStyle = rug.fill;
    ctx.fillRect(rug.x + px, rug.y + px, rug.width - 2 * px, rug.height - 2 * px);
    ctx.strokeStyle = rug.line;
    ctx.lineWidth = px;
    ctx.strokeRect(rug.x + 3.5 * px, rug.y + 3.5 * px, rug.width - 7 * px, rug.height - 7 * px);
  }

  for (const art of WALL_ART) {
    const prop: Prop | undefined = skin.props[art.prop];
    if (!prop) continue;
    const w = prop.width * px;
    const h = prop.height * px;
    ctx.drawImage(prop.image, prop.x, prop.y, prop.width, prop.height, Math.round(art.x - w / 2), art.y - h, w, h);
  }

  // After hours: the same room with the lights down, so it sits in the dark theme.
  if (dark) {
    ctx.fillStyle = "rgba(14, 22, 32, 0.52)";
    ctx.fillRect(0, 0, width, height);
  }
}

const cache = new WeakMap<FloorSkin, Partial<Record<"light" | "dark", HTMLCanvasElement>>>();

/** The painted room for this skin and theme, built on first use. */
export function backdrop(skin: FloorSkin, dark: boolean): HTMLCanvasElement {
  const key = dark ? "dark" : "light";
  const bySkin = cache.get(skin) ?? {};
  cache.set(skin, bySkin);
  if (!bySkin[key]) {
    const canvas = document.createElement("canvas");
    canvas.width = FLOOR.width;
    canvas.height = FLOOR.height;
    paint(canvas.getContext("2d")!, skin, dark);
    bySkin[key] = canvas;
  }
  return bySkin[key];
}
