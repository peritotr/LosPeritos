/**
 * The dancer of the sıra gecesi, drawn here as a pixel map so she can be tuned by hand. She
 * belongs to no skin and no bureau: she comes in when the night has gathered, dances on the
 * carpet with the Lead Perito, and leaves with the lanterns. Original art for this project (MIT),
 * in the proportions of the characters she dances among.
 */
const PALETTE: Record<string, string> = {
  O: "#1a1c2c", // outline, as in the pack
  H: "#2a1a1f", // hair
  S: "#e8b999", // skin
  s: "#cb9478", // skin in shade
  M: "#b4635a", // mouth
  R: "#35b3b0", // costume: turquoise, to stand out on the red carpet
  r: "#1f7f86", // costume, in the folds
  G: "#f2c14e", // coins and trim
};

/** Head and arms, in the two shapes the dance goes between: hands above the head, and arms out wide. */
const ARMS: [string[], string[]] = [
  [
    "..S..........S..",
    "..S...OOOO...S..",
    "..S..OHHHHO..S..",
    "..S.OHGGGGHO.S..",
    "...SOHSSSSHOS...",
    "...SOSOSSOSOS...",
    "...SOSSMMSSOS...",
    "....SOSSSSOS....",
    "....SRRGGRRS....",
  ],
  [
    "................",
    "......OOOO......",
    ".....OHHHHO.....",
    "....OHGGGGHO....",
    "....OHSSSSHO....",
    "S...OSOSSOSO...S",
    "S...OSSMMSSO...S",
    ".S...OSSSSO...S.",
    "..SSSRRGGRRSSS..",
  ],
];

/** From the chest down: the same in every shape, but the hips never keep still. */
const BODY = [
  ".....RRRRRR.....",
  ".....SSSSSS.....",
  ".....sSSSSs.....",
  "....GGGGGGGG....",
  "....RGRGGRGR....",
  "....RRRRRRRR....",
  "...RRRrRRrRRR...",
  "...RRRrRRrRRR...",
  "..RRRRrRRrRRRR..",
  "..RRRrRRRRrRRR..",
  ".RRRRrRRRRrRRRR.",
  ".RRRrRRRRRRrRRR.",
  ".GGGGGGGGGGGGGG.",
  "....SS....SS....",
];

export const DANCER_HEIGHT = ARMS[0].length + BODY.length;

/**
 * Draws the dancer with her feet at (x, y). `seconds` moves her; with `still` she holds one pose,
 * for people who have asked their system for less motion.
 */
export function drawDancer(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, seconds: number, still: boolean): void {
  const arms = ARMS[still ? 0 : Math.floor(seconds * 2.4) % 2]!;
  const rows = [...arms, ...BODY];
  const left = Math.round(x - 8 * scale);
  const top = Math.round(y - rows.length * scale);
  rows.forEach((row, index) => {
    // The shimmy: from the waist down each row leans a pixel to one side, in a wave that runs down the skirt.
    const below = index - arms.length;
    const lean = still || below < 1 || index === rows.length - 1 ? 0 : Math.round(Math.sin(seconds * 9 - below * 0.55));
    for (let column = 0; column < row.length; column++) {
      const colour = PALETTE[row[column]!];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(left + (column + lean) * scale, top + index * scale, scale, scale);
    }
  });
  if (still) return;
  // The coins on her belt catch the lantern light, one after another.
  ctx.fillStyle = "#fff3c4";
  const glint = Math.floor(seconds * 8) % 8;
  ctx.fillRect(left + (4 + glint) * scale, top + (arms.length + 3) * scale, scale, scale);
}
