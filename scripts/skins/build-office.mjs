// Builds the "office" floor skin from the Pixel Office asset pack by 2dPig (CC0),
// plus the office dogs drawn in pets.mjs.
// The pack ships one still drawing per character, so this cuts each one out and
// derives two extra frames from it (a breath and a small hop) to animate with.
//   node scripts/skins/build-office.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PETS, renderPet } from "./pets.mjs";
import { readPng, writePng } from "./png.mjs";

const dir = fileURLToPath(new URL("../../apps/ui/public/skins/office/", import.meta.url));
const sheet = readPng(dir + "source/PixelOfficeAssets.png");

// Bounding boxes of the five characters on the 256×160 source sheet.
const CHARACTERS = [
  { x: 2, y: 105, w: 15, h: 23 },
  { x: 19, y: 104, w: 19, h: 24 },
  { x: 40, y: 107, w: 13, h: 21 },
  { x: 3, y: 132, w: 17, h: 23 },
  { x: 22, y: 132, w: 17, h: 23 },
];
const CELL = { w: 20, h: 26 };
const FEET_ROWS = 3;
const FRAMES = ["stand", "breathe", "hop"];

const clips = {
  idle: { row: 0, frames: [0, 1], secondsPerFrame: 0.9 },
  working: { row: 0, frames: [0, 1], secondsPerFrame: 0.22 },
  asking: { row: 0, frames: [0, 2], secondsPerFrame: 0.3 },
  awaiting_seal: { row: 0, frames: [0, 1], secondsPerFrame: 0.9 },
  error: { row: 0, frames: [0], secondsPerFrame: 1 },
  off_duty: null,
};

const characters = CHARACTERS.map((box, index) => {
  const out = Buffer.alloc(CELL.w * FRAMES.length * CELL.h * 4);
  const left = Math.floor((CELL.w - box.w) / 2);
  const top = CELL.h - box.h; // feet on the bottom edge
  FRAMES.forEach((frame, f) => {
    for (let y = 0; y < box.h; y++) {
      const feet = y >= box.h - FEET_ROWS;
      // breathe: everything above the feet sinks a pixel; hop: the whole figure rises one.
      const dy = frame === "breathe" && !feet ? 1 : frame === "hop" ? -1 : 0;
      if (frame === "breathe" && y === box.h - FEET_ROWS - 1) continue; // the row the body sinks into
      for (let x = 0; x < box.w; x++) {
        const from = ((box.y + y) * sheet.w + box.x + x) * 4;
        if (sheet.data[from + 3] === 0) continue;
        const to = ((top + y + dy) * CELL.w * FRAMES.length + f * CELL.w + left + x) * 4;
        sheet.data.copy(out, to, from, from + 4);
      }
    }
  });
  const src = `character-${index + 1}.png`;
  writePng(dir + src, CELL.w * FRAMES.length, CELL.h, out);
  return { src, frameWidth: CELL.w, frameHeight: CELL.h, clips };
});

// The office dogs are this project's own drawings (see pets.mjs), not part of the pack.
const pets = Object.fromEntries(
  Object.entries(PETS).map(([key, pet]) => {
    const art = renderPet(pet);
    const src = `pet-${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}.png`;
    writePng(dir + src, art.width * art.frames, art.height, art.rgba);
    return [key, { src, frameWidth: art.width, frameHeight: art.height, walk: [0, 1], rest: [2], secondsPerFrame: 0.18 }];
  }),
);

fs.writeFileSync(
  dir + "skin.json",
  JSON.stringify(
    {
      name: "Pixel Office",
      license: "CC0",
      source: "https://2dpig.itch.io/pixel-office",
      scale: 3,
      characters,
      pets,
      // Furniture, plants and pets, cut straight from the source sheet: [x, y, width, height].
      props: {
        sheet: "source/PixelOfficeAssets.png",
        items: {
          plant: [170, 65, 14, 19],
          sofaWarm: [120, 121, 33, 16],
          sofaCool: [120, 83, 33, 16],
          table: [85, 47, 26, 16],
          // A perito's desk: a partition behind (two end pieces), a table in front, a computer on it.
          partitionLeft: [171, 44, 20, 17],
          partitionRight: [230, 44, 20, 17],
          desk: [115, 47, 40, 16],
          computer: [233, 106, 15, 19],
          coffeeMachine: [159, 91, 7, 11],
          mug: [169, 95, 8, 7],
          vending: [159, 123, 24, 34],
          snackShelf: [184, 126, 24, 31],
          cooler: [147, 140, 9, 17],
          // On the back wall.
          window: [59, 96, 26, 21],
          door: [98, 120, 16, 31],
          clock: [159, 108, 19, 6],
          calendar: [234, 81, 17, 11],
          picture: [239, 94, 11, 8],
          binGreen: [116, 143, 9, 14],
          binBlue: [136, 143, 9, 14],
        },
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${characters.length} character sheets and skin.json to ${dir}`);
