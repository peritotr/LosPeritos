// The Lead Perito, drawn here as a pixel map so it can be tuned by hand. It is
// the floor-sized figure of the portrait in scripts/portrait.mjs: Alpaslan
// Yılmaz, to whose memory the project is dedicated, sits at the head of every
// bureau. Original art for this project (MIT); the outline and proportions
// follow the Pixel Office characters it stands among.

export const LEAD = {
  palette: {
    O: "#1a1c2c", // outline, as in the pack
    H: "#33271f", // hair
    h: "#54402f", // hair, catching the light
    S: "#e8b999", // skin
    s: "#cb9478", // skin in shade
    G: "#1d2126", // sunglasses
    g: "#6f8196", // a glint on the lens
    M: "#b4635a", // mouth
    J: "#6f737c", // jacket
    j: "#565a63", // jacket in shade
    L: "#9fb1d2", // lanyard
    W: "#eef0f2", // collar
    T: "#333c57", // trousers
    B: "#566c86", // shoes
  },
  rows: [
    "....OOOOOOOO....",
    "..OOHHHhHHHHOO..",
    ".OHHhHHHHHHhHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHHHHHHHHHHHO.",
    ".OHHSSSSSSSSHHO.",
    ".OHSSSSSSSSSSHO.",
    "OsGGGGGGGGGGGGsO",
    "OsGgGGGSSGgGGGsO",
    ".OSGGGGSSGGGGSO.",
    ".OSSSSSssSSSSSO.",
    ".OSSSSMMMMSSSSO.",
    "..OSSSSSSSSSSO..",
    "...OOsSSSSsOO...",
    "..OJJLWWWWLJJO..",
    ".OJJJJLWWLJJJJO.",
    ".OJjJJJLLJJJjJO.",
    ".OSOJJJLLJJJOSO.",
    "..OOjJJJJJJjOO..",
    "...OOOOOOOOOO...",
    "...OTTO..OTTO...",
    "...OTTO..OTTO...",
    "..OBBBO..OBBBO..",
    "..OOOOO..OOOOO..",
  ],
};
