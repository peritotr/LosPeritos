// Berlin and Luna, the office dogs, drawn here as pixel maps so they can be
// tuned by hand. Both face left. Original art for this project (MIT).
//
// Each dog has a body, legs, and two pairs of leg columns that lift in turn to
// make a walk. A third frame lays the body on the ground for a rest.

export const PETS = {
  // Berlin: a white French bulldog. Bat ears with pink insides, flat grey muzzle, stub tail.
  frenchBulldog: {
    palette: { F: "#f5f2ea", S: "#cfcbc2", D: "#b9b4ab", K: "#17181a", E: "#e3a79b", W: "#ffffff" },
    body: [
      "..FF...FF.........",
      "..FEF.FEF.........",
      "..FFFFFFF.........",
      ".FFKFFFFFF..FFFFF.",
      "DDDFFFFFFFFFFFFFFF",
      "KDDFFFFFFFFFFFFFFS",
      ".DDWFFFFFFFFFFFFFS",
      "..WWWFFFFFFFFFFFS.",
      "..WWWFFFFFFFFFFS..",
      "...FFFFSSSSSFFFS..",
    ],
    legs: ["...FF.FF....FF.FF.", "...FF.FF....FF.FF.", "...SS.SS....SS.SS."],
    // [first column, last column] of each leg; pair A lifts on one frame, pair B on the other.
    pairA: [[3, 4], [15, 16]],
    pairB: [[6, 7], [12, 13]],
  },
  // Luna: an English setter. White with black flecks, black drooping ear, feathered tail and legs.
  englishSetter: {
    palette: { W: "#f5f2ea", G: "#cfcbc2", B: "#2a2a2d", K: "#17181a" },
    body: [
      ".....WWWW.................",
      "....WWWWWW................",
      "...WWKWWBBB...............",
      "KWWWWWWWBBBB..............",
      ".WWWWWWWBBBBW.............",
      "...GGWWWBBBWWWWWWWWWWWWWWWWWWWW",
      "......WWWBBWWWBWWWWWBWWWWWGWGW.",
      "......WWWWWWWWWWBWWWWWWGG.G....",
      "......WBWWWWBWWWWWWBWWWG..",
      "......WWWWWWWWWBWWWWWWW...",
      "......WWWGGGGGGGGWWWWWG...",
    ],
    legs: [
      "......WW.GW.....WW.GW.....",
      "......WW.GW.....WW.GW.....",
      "......WW.GW.....WW.GW.....",
      "......WW.GW.....WW.GW.....",
      "......GG.GG.....GG.GG.....",
    ],
    pairA: [[6, 7], [19, 20]],
    pairB: [[9, 10], [16, 17]],
  },
};

/** Drawn around every pet so a white coat still reads on a pale floor. */
const OUTLINE = "#39404c";

const hex = (color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

/**
 * Render one pet as a strip of three frames: walk A, walk B, rest.
 * Returns { width, height, frames, rgba } with the feet on the bottom edge.
 */
export function renderPet(pet) {
  // One spare pixel on every side for the outline.
  const artWidth = Math.max(...[...pet.body, ...pet.legs].map((row) => row.length));
  const artHeight = pet.body.length + pet.legs.length;
  const width = artWidth + 2;
  const height = artHeight + 2;
  const frames = 3;
  const rgba = Buffer.alloc(width * frames * height * 4);
  const offset = (frame, x, y) => (y * width * frames + frame * width + x) * 4;
  const put = (frame, artX, artY, char) => {
    const color = pet.palette[char];
    const x = artX + 1;
    const y = artY + 1;
    if (!color || x < 1 || x > artWidth || y < 1 || y > artHeight) return;
    const at = offset(frame, x, y);
    const [r, g, b] = hex(color);
    rgba[at] = r;
    rgba[at + 1] = g;
    rgba[at + 2] = b;
    rgba[at + 3] = 255;
  };
  const rows = (frame, lines, top, skip = () => false) =>
    lines.forEach((line, dy) => [...line].forEach((char, x) => !skip(x, dy) && put(frame, x, top + dy, char)));
  const inPair = (pair, x) => pair.some(([from, to]) => x >= from && x <= to);

  [pet.pairA, pet.pairB].forEach((lifted, frame) => {
    rows(frame, pet.body, 0);
    // A lifted leg loses its bottom row, so the paw hangs a pixel off the ground.
    rows(frame, pet.legs, pet.body.length, (x, dy) => dy === pet.legs.length - 1 && inPair(lifted, x));
  });
  // Rest: the body lies on the ground with only the paws showing.
  const drop = pet.legs.length - 1;
  rows(2, pet.body, drop);
  rows(2, pet.legs.slice(-1), artHeight - 1);

  for (let frame = 0; frame < frames; frame++) {
    const filled = (x, y) => x >= 0 && x < width && y >= 0 && y < height && rgba[offset(frame, x, y) + 3] === 255;
    const edge = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!filled(x, y) && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) edge.push([x, y]);
      }
    }
    const [r, g, b] = hex(OUTLINE);
    // 254 marks outline pixels so they are not mistaken for fill while scanning; fixed below.
    for (const [x, y] of edge) rgba.set([r, g, b, 254], offset(frame, x, y));
  }
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 254) rgba[i] = 255;
  return { width, height, frames, rgba };
}
