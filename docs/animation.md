# Animation and visuals

How the floor is animated, what it can be extended with, and which outside
libraries, art and agent skills are safe to use in this MIT repository.
Licences and versions below were read from each project's own pages on
2026-11-23; re-check before relying on them.

## How it is built

| Layer | File | Job |
|---|---|---|
| Model | `apps/ui/src/floor/model.ts` | Turns live state into plain data: who sits where, in which pose, where each file lies. No drawing. |
| Furniture and files | `apps/ui/src/floor/SvgFloor.tsx` | Desks, files, notes and the stamp, as SVG animated with Motion. |
| Characters and set dressing | `apps/ui/src/floor/SpriteLayer.tsx` | Sprite characters, a lounge, plants and pets on a canvas under the SVG. Off by default; "Characters" in the floor header turns it on. |
| Layout of set dressing | `apps/ui/src/floor/decor.ts` | Where each prop stands, where off-duty peritos sit, where the pets go. |
| The room | `apps/ui/src/floor/backdrop.ts` | Back wall, plank floor, rugs and wall decoration, painted once per theme. Colours and rug positions are constants at the top of the file. The dark theme dims the same room. |
| Skin | `apps/ui/src/floor/skin.ts` | Loads art from `public/skins/office/`, or draws a placeholder. |

A new renderer (PixiJS, Rive) only needs to consume `FloorModel`. The poses a
character can be in are `idle`, `working`, `asking`, `awaiting_seal`, `error`
and `off_duty`.

A perito with a question or a seal request leaves its desk, walks the aisles to your seal desk and queues there holding a sign; it walks back once you have dealt with it. Work that ends earns a cheer and a burst of confetti, and so does a fresh seal. Routes are in `apps/ui/src/floor/routes.ts`.

Off-duty peritos sit on the lounge sofas (four at most). Two office dogs,
Berlin and Luna, stroll the front of the floor; they are drawn in
`scripts/skins/pets.mjs` and configured in `decor.ts`. Not built yet:
real walk cycles (walking reuses the hop frame, because the installed pack has one drawing per character) and per-tool poses such as reading versus typing.

When the skin has a `desk` prop, each perito's desk is drawn from art
(partition, table, computer) and the SVG keeps only the labels, flags and
click area; without it the SVG outline is the desk. The seal desk and the
archive shelf are always SVG.

## Libraries

| Library | Licence | Use it for | Notes |
|---|---|---|---|
| `motion` | MIT | UI and SVG animation | In use. |
| Canvas 2D (built in) | — | Sprite characters | In use. The reference project below runs a whole office this way. |
| `pixi.js` + `@pixi/react` | MIT | Many sprites, particles, camera | Worth adding only if the canvas layer gets slow or needs effects. |
| `@rive-app/react-webgl2` | MIT | Hand-animated vector characters with state machines | Art must be made in the Rive editor; free-plan exports show a Rive splash screen. |
| `@lottiefiles/dotlottie-react` | MIT | One-off flourishes (confetti on a closed file) | Plays clips; not for state-driven scenes. |
| `gsap` | Custom "no charge" licence, not open source | — | Avoid as a dependency of an MIT project. |
| Spine runtimes | Requires each user to own a Spine licence | — | Avoid. |

## Reference project

[pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) (MIT code) shows
Claude Code agents as pixel characters in an office, using React and Canvas 2D:
16 px tiles, 16×32 character frames, states idle / walk / type. Its engine code
and furniture manifest format may be reused under MIT. Its bundled furniture
art has no stated licence, so do not copy the PNGs without asking the author.

## Art

Only commit art whose licence allows redistribution. Record each pack in
`public/skins/<name>/LICENSE`.

| Pack | Licence | What it is |
|---|---|---|
| [MetroCity Free Topdown Character Pack](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) | CC0 | Top-down characters with four-direction running. Base of pixel-agents' characters. |
| [Pixel Office Asset Pack (2dPig)](https://2dpig.itch.io/pixel-office) | CC0 | Five characters plus office furniture, computers, plants. PNG and Aseprite. **Installed** as the `office` skin. One still drawing per character, so `scripts/skins/build-office.mjs` derives a breath and a hop frame from each. |
| [Kenney](https://kenney.nl/assets) packs, e.g. RPG Urban Pack, Roguelike Indoors, Roguelike Characters | CC0 | Tiles, furniture, characters. Whether the characters have sit or type frames was not confirmed. |

Do not commit: LimeZu Modern Interiors / Modern Office and the Donarg (retropi-art)
Office Interior Tileset (both forbid redistribution), "Little Bits: Office" (no
formal licence), Rive Marketplace files without attribution (CC BY), or
collections of LottieFiles animations (Lottie Simple License).

## Agent skills

Skills are instruction packs for coding agents such as Claude Code. These are
published by the library authors themselves. Read a skill before installing
it: it shapes what the agent does in this repository.

| Skill | Licence | Install |
|---|---|---|
| Motion `/motion` skill and docs server | MIT | `npx motion-ai` |
| [pixijs/pixijs-skills](https://github.com/pixijs/pixijs-skills) | MIT | `npx skills add https://github.com/pixijs/pixijs-skills` |
| [rive-app/skills](https://github.com/rive-app/skills) | MIT | `/plugin marketplace add rive-app/skills`, then `/plugin install rive@rive` |
| [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill) | MIT | `npx skills add LottieFiles/motion-design-skill` |
| [greensock/gsap-skills](https://github.com/greensock/gsap-skills) | MIT (the skill; `gsap` itself is not) | Only if GSAP is adopted. |

Community packs (frankxai/awesome-motion-design-agent-skills,
iart-ai/web-animation-skills, freshtechbro/claudedesignskills) exist but carry
off-topic content, promotion or unreviewed scripts; review before use.
