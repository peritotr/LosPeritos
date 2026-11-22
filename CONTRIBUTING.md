# Contributing to LosPeritos

Thanks for looking. This is a young project with a small surface; most things
can be understood by reading one file.

## Setting up

You need Node.js 22 or newer and git.

```bash
npm install
npx install-electron   # only if you will run the desktop app
```

| Command | What it does |
|---|---|
| `npm test` | Builds the packages and runs the tests. Uses the fake agent; spends nothing. |
| `npm run typecheck:ui` | Type-checks the interface. |
| `npm run dev` | Core plus UI in a browser at http://localhost:5173, with scripted agents. |
| `npm run dev -- --real` | The same with your own Claude Code CLI. |
| `npm run desktop:demo` | The desktop app with scripted agents. |
| `npm run desktop` | The desktop app with your own Claude Code CLI. |
| `npm run package` | A standalone app for this machine's platform. |

In the demo, **Run the demo job** plays a scripted job. In the chat, a message
to the lead starting with `/ask`, `/approve`, `/fail` or `/limit` makes the
fake agent ask a question, request a seal, fail, or hit a usage limit.

## Where things live

- **The contract** between core and UI is `packages/protocol/src/index.ts`.
  Change it first, then both sides.
- **All product logic** is in `packages/core/src/core.ts`. The UI and the
  desktop shell hold none.
- **Interface wording** is in `apps/ui/src/locales/`. Nothing user-facing is
  written in a component. To add a language, copy `en.ts`, translate it, and
  register it in `apps/ui/src/strings.ts`; a missing key fails the type check.
  Keep *Perito*, *Peritos* and *LosPeritos* untranslated.
- **The floor** is described in [docs/animation.md](docs/animation.md):
  `floor/model.ts` turns state into plain data, the renderers draw it.
- **Art** lives in `apps/ui/public/skins/`. Only add art whose licence allows
  redistribution, and put the licence next to it.

## Tests

Anything in the core should come with a test in `packages/core/src/`. Tests
run against the fake agent and a temporary folder, and must not need the
network or a real agent.

Four scripts check behaviour against a real `claude` CLI. They spend a little
real usage, so they are not part of `npm test`; run the relevant one when you
touch the adapter:

| Script | Checks |
|---|---|
| `scripts/smoke-claude.mjs` | A two-turn conversation and cost accounting |
| `scripts/e2e-claude.mjs` | Lead → task → branch → merge on seal |
| `scripts/e2e-permission.mjs` | A risky command is held and can be refused |
| `scripts/e2e-resume.mjs` | A conversation survives a restart |

## Pull requests

- Keep a change to one thing, and say in the description what you verified and
  what you could not.
- Run `npm test` and `npm run typecheck:ui`.
- If you change what a user sees, add the wording to every locale. An
  untranslated English string in another locale is fine if you say so.
- Changes to what agents may do without asking (`RISKY_COMMANDS`, trust modes,
  the permission bridge) need a test and a line in the pull request explaining
  the effect on safety.

## Building and signing

`npm run package` writes `apps/desktop/release/` with the app and, on macOS, a
`.dmg`. The build is for the platform it runs on.

On macOS the build is signed when a *Developer ID Application* certificate is
in the keychain, and notarised when notary credentials are stored under the
profile name `LosPeritos`:

```bash
xcrun notarytool store-credentials LosPeritos
```

`LP_SIGN_IDENTITY` and `LP_NOTARY_PROFILE` override the certificate and the
profile. Without a certificate the build is left unsigned: it opens on the
machine that built it, and Gatekeeper refuses it elsewhere until the user
allows it in System Settings. Windows builds are not signed yet.

The app icon is `apps/desktop/assets/icon.png`; `node scripts/make-icons.mjs`
regenerates the `.icns` and `.ico` from it. `node scripts/screenshots.mjs`
regenerates the screenshots in `docs/`.
