# Floor skins

A skin is the art the bureau floor draws its characters with. The app looks
for one at `skins/office/skin.json`; without it, it uses a placeholder drawn
in code.

`office/` currently holds the Pixel Office pack by 2dPig (CC0). Its character
sheets and `skin.json` are generated from `office/source/PixelOfficeAssets.png`
by `node scripts/skins/build-office.mjs`; edit that script rather than the
generated files. The Lead Perito is this project's own pixel drawing (MIT),
kept as an editable map in `scripts/skins/lead.mjs` and listed under `lead` in
`skin.json`; a skin without `lead` gives the lead one of its `characters`. The two office dogs are this project's own pixel drawings
(MIT), kept as editable maps in `scripts/skins/pets.mjs`; their names and
lanes are in `apps/ui/src/floor/decor.ts`. Furniture and plants are listed under `props` in
`skin.json` as rectangles of the source sheet; where they stand on the floor
is set in `apps/ui/src/floor/decor.ts`.

To install a pack:

1. Create `skins/office/` and copy the sprite sheet PNGs into it.
2. Add the pack's licence text as `skins/office/LICENSE`. Only commit art whose
   licence allows redistribution (CC0 is the simplest); see `docs/animation.md`.
3. Write `skins/office/skin.json` describing the sheets:

```json
{
  "name": "MetroCity",
  "license": "CC0",
  "source": "https://jik-a-4.itch.io/metrocity-free-topdown-character-pack",
  "scale": 3,
  "characters": [
    {
      "src": "character-1.png",
      "frameWidth": 16,
      "frameHeight": 32,
      "clips": {
        "idle":          { "row": 0, "frames": [7],       "secondsPerFrame": 1 },
        "working":       { "row": 0, "frames": [3, 4],    "secondsPerFrame": 0.3 },
        "asking":        { "row": 0, "frames": [0, 1, 2], "secondsPerFrame": 0.35 },
        "awaiting_seal": { "row": 0, "frames": [0],       "secondsPerFrame": 1 },
        "error":         { "row": 0, "frames": [0],       "secondsPerFrame": 1 },
        "off_duty":      null
      }
    }
  ]
}
```

A sheet may also carry `"walk"`, a clip played while the figure is on the move
between desks; without it the figure plays its `asking` clip as it goes.

`row` and `frames` count from 0 on a grid of `frameWidth` × `frameHeight`
cells. Every pose needs a clip or `null` (not drawn). The frame numbers above
are an example; read them off the sheet you install. List several sheets under
`characters` to give peritos different looks.
