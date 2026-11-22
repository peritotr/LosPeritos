// The portrait of Alpaslan Yılmaz shown in the README, drawn by hand as a
// pixel map so it can be adjusted. Run: node scripts/portrait.mjs
import { fileURLToPath } from "node:url";
import { writePng } from "./skins/png.mjs";

const PALETTE = {
  H: "#33271f", // hair
  h: "#54402f", // hair, catching the light
  S: "#e8b999", // skin
  s: "#cb9478", // skin in shade
  G: "#1d2126", // sunglasses
  g: "#6f8196", // a glint on the lens
  M: "#b4635a", // mouth
  J: "#6f737c", // jacket
  L: "#9fb1d2", // lanyard
  W: "#eef0f2", // collar
};
const ROWS = [
  "................................",
  "................................",
  "...........HHHHHHHHHH...........",
  ".........HHHhHHHHhHHHHH.........",
  "........HHhHHHHHHHHHhHHH........",
  ".......HHHHHHhHHHHHHHHHHH.......",
  ".......HHHHHHHHHHHhHHHHHH.......",
  "......HHHHHHHHHHHHHHHHHHHH......",
  "......HHHHSSSSSSSSSSSSHHHH......",
  "......HHHSSSSSSSSSSSSSSHHH......",
  "......HHSSSSSSSSSSSSSSSSHH......",
  "......HHSSSSSSSSSSSSSSSSHH......",
  ".....sGGGGGGGGGGGGGGGGGGGGs.....",
  ".....sSGGGGGGGGSSGGGGGGGGSs.....",
  ".....sSGGgGGGGGSSGGgGGGGGSs.....",
  "......SGGGGGGGGSSGGGGGGGGS......",
  "......SSGGGGGGSSSSGGGGGGSS......",
  "......SSSSSSSSSssSSSSSSSSS......",
  "......SSSSSSSSSssSSSSSSSSS......",
  ".......SSSSSSSssssSSSSSSS.......",
  ".......SSSSSSSSSSSSSSSSSS.......",
  "........SSSSSMMMMMMSSSSS........",
  "........SSSSSSMMMMSSSSSS........",
  ".........SSSSSSSSSSSSSS.........",
  "..........SSSSSSSSSSSS..........",
  "...........ssSSSSSSss...........",
  "...........ssssssssss...........",
  "........JJLWssssssssWLJJ........",
  "......JJJJLLWWssssWWLLJJJJ......",
  "....JJJJJJJLLWWWWWWLLJJJJJJJ....",
  "...JJJJJJJJJLLWWWWLLJJJJJJJJJ...",
  "..JJJJJJJJJJJLLLLLLJJJJJJJJJJJ..",
];

const SIZE = ROWS.length;
const BORDER = 2; // art pixels of frame around the picture
const SCALE = 8;
const BACKGROUND = "#dbe5ee";
const FRAME = "#416180";
const OUTLINE = "#2a2f38";

const hex = (color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
const side = SIZE + BORDER * 2;
const art = Array.from({ length: side }, (_, y) =>
  Array.from({ length: side }, (_, x) => {
    const inside = x >= BORDER && y >= BORDER && x < side - BORDER && y < side - BORDER;
    return inside ? (PALETTE[ROWS[y - BORDER][x - BORDER]] ?? null) : FRAME;
  }),
);
// A dark line around the figure, wherever it meets the background.
const figure = (x, y) => x >= BORDER && y >= BORDER && x < side - BORDER && y < side - BORDER && art[y][x] !== null;
const pixels = art.map((row, y) =>
  row.map((color, x) =>
    color ?? ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => figure(x + dx, y + dy)) ? OUTLINE : BACKGROUND),
  ),
);

const width = side * SCALE;
const rgba = Buffer.alloc(width * width * 4);
for (let y = 0; y < width; y++) {
  for (let x = 0; x < width; x++) {
    const [r, g, b] = hex(pixels[Math.floor(y / SCALE)][Math.floor(x / SCALE)]);
    rgba.set([r, g, b, 255], (y * width + x) * 4);
  }
}
const out = fileURLToPath(new URL("../docs/alpaslan-yilmaz.png", import.meta.url));
writePng(out, width, width, rgba);
console.log(`Wrote ${out} (${width}×${width})`);
