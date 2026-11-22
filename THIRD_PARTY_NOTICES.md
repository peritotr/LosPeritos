# Third-party notices

LosPeritos is MIT licensed. It includes or depends on the following work by
others.

## Art

| Work | Author | Licence | Where |
|---|---|---|---|
| [Pixel Office Asset Pack](https://2dpig.itch.io/pixel-office) | 2dPig | CC0 1.0 | `apps/ui/public/skins/office/` |

The portrait of Alpaslan Yılmaz in the README is an original drawing
(`scripts/portrait.mjs`).

The characters' extra animation frames are derived from that pack by
`scripts/skins/build-office.mjs`. The two dogs, the room backdrop and the
perito emblems are original to this project.

## Fonts

| Font | Licence |
|---|---|
| Barlow, Barlow Condensed (Jeremy Tribby), via `@fontsource` | SIL Open Font License 1.1 |

## Libraries shipped in the app

| Library | Licence |
|---|---|
| Electron | MIT |
| React, React DOM | MIT |
| Motion | MIT |
| Lucide | ISC |
| Zod | MIT |
| ws | MIT |

Their full licence texts are in each package under `node_modules/` after
`npm install`. Build-time tools (TypeScript, Vite, esbuild, Electron Packager)
are not shipped in the app.
