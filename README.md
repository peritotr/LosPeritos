<p align="center"><img src="docs/logo.jpeg" alt="LosPeritos" width="320"></p>

# LosPeritos

A desktop workspace for running a team of coding agents on your own machine.
"Los peritos" is Spanish for "the experts".

You open a project folder and give the lead agent a job. The lead splits the
work, hands parts to up to 8 agents, and each agent works on its own git
branch. Risky steps (merge, deploy) wait for your approval. Agents run on your
own Claude Code or Codex account. No sign-in, no telemetry; data stays in
`<folder>/.losperitos/`.

**Status:** early. `npm run package` builds a standalone app for your own machine; there are no signed, downloadable releases yet. The core runs a lead and up to 7 team members per workspace; each task gets its own git branch and worktree and is merged only after you approve.

## Layout

| Path | Purpose |
|---|---|
| `packages/protocol` | API and event types shared by the core and the UI |
| `packages/core` | Local daemon: orchestrator, tasks, approvals, budget |
| `packages/adapters` | Agent CLI adapters (Claude Code, Codex) |
| `packages/git` | Branches, worktrees, diff and merge |
| `packages/storage` | Reading and writing `.losperitos/` |
| `packages/cli` | `peritos` CLI that agents use to message each other |
| `apps/desktop` | Electron shell: starts the core in-process, opens the UI, native folder picker |
| `apps/ui` | React interface (Vite + Motion): The Bench with its live floor, Files, Correspondence, Awaiting you, Archive, Ledger, Settings, Setup |
| `fixtures` | Fake agent and sample workspace for tests and demo mode |
| `docs/design-prompt.md` | Design brief for the interface (Turkish) |
| `docs/animation.md` | How the floor is animated; vetted libraries, art and agent skills |

## Development

```bash
npm install
npm run desktop:demo  # the desktop app with scripted agents; spends nothing
npm run desktop       # the desktop app with your own Claude Code CLI
npm run dev           # core + UI in a browser at http://localhost:5173, scripted agents
npm run dev -- --real # the same with your own Claude Code CLI
npm test            # build + tests (uses the fake agent, spends no tokens)
npm run core:fake   # daemon on http://127.0.0.1:7420 with scripted agents
npm run core        # daemon with your own Claude Code CLI
```

The API token is written to `~/.losperitos/token.json` (`~/.losperitos-demo/` in fake mode). Send it as `Authorization: Bearer <token>`; the WebSocket at `/events` takes `?token=`. Routes and event shapes are in `packages/protocol/src/index.ts`.

## Building the app

```bash
npm run package
```

This writes `apps/desktop/release/LosPeritos-<platform>-<arch>/` with the app inside, and on macOS a `.dmg` next to it. The app carries everything it needs except the agent tools themselves: `git` and Claude Code must be installed on the machine.

The build is for the platform you run it on, and it is not code-signed or notarised. It opens normally on the machine that built it; on another Mac, Gatekeeper will refuse it until the user allows it under System Settings → Privacy & Security, and Windows SmartScreen shows a similar warning. Publishing releases needs an Apple Developer ID and a Windows signing certificate.

## Languages

The interface ships in English and Turkish; pick one under Settings → Appearance. All wording lives in `apps/ui/src/locales/`. To add a language, copy `en.ts`, translate it, and register it in `apps/ui/src/strings.ts`; the compiler flags any missing key. Keep the Spanish roots untranslated: Perito, Peritos, LosPeritos.

## How a job flows

1. You message the lead. Small jobs it does itself; larger ones it splits with `peritos task create`.
2. Each task goes to a team member, who works in `.losperitos/worktrees/task-<n>` on branch `peritos/task-<n>-<title>`.
3. The member commits and runs `peritos task done` with a report: done, tested, not verified.
4. That raises a merge approval. Approving merges the branch into the branch you had checked out and removes the worktree; if the merge conflicts it is aborted and the approval stays pending.

Agents reach the core through the `peritos` CLI (`packages/cli`), which the core puts on their `PATH` with a per-agent token.

**Trust modes.** In a `full` workspace agents edit files and run ordinary shell commands in your folder without asking. Commands that publish, deploy, destroy or reach other machines (`git push`, `rm -rf`, `npm publish`, `ssh`, deploy tools; the list is `RISKY_COMMANDS` in `packages/adapters/src/claude-code.ts`) are held until you seal them, as is every merge. In a `restricted` workspace every edit and every command is held. Held calls reach you through a permission bridge (`peritos mcp`) that the agent's CLI must go through, so this is enforced rather than requested. It is still a safety net, not a sandbox: commands are matched by prefix, so an unusual spelling such as `git -C . push` is not caught.

**Staying on the job.** Each agent keeps one conversation, so after a restart the lead picks up where it left off; a team member starts a fresh conversation with every new task. An agent that hits the account's usage limit is marked as waiting, not failed, and carries on by itself when the limit resets (or tries every 20 minutes when the tool does not say when that is). The lead can mark a task `--effort small` or `large`, which runs that team member on a cheaper or a bigger model. The desktop app keeps the computer awake while any agent is working.

Answering a question with "don't ask again" files the answer as a lesson, and accepted lessons are given to every agent started afterwards.

`scripts/smoke-claude.mjs`, `e2e-claude.mjs`, `e2e-permission.mjs` and `e2e-resume.mjs` check the adapter, the whole flow, the permission bridge and conversation resume against your real `claude` CLI; each spends a little real usage.

In fake mode a message starting with `/ask`, `/approve` or `/fail` makes the agent ask a question, request an approval or fail; anything else is echoed.

## License

MIT
