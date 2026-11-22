# LosPeritos

A desktop workspace for running a team of coding agents on your own machine.
"Los peritos" is Spanish for "the experts".

You open a project folder and give the lead agent a job. The lead splits the
work, hands parts to up to 8 agents, and each agent works on its own git
branch. Risky steps (merge, deploy) wait for your approval. Agents run on your
own Claude Code or Codex account. No sign-in, no telemetry; data stays in
`<folder>/.losperitos/`.

**Status:** phase 2. The core daemon runs a lead and up to 7 team members per workspace over a local HTTP + WebSocket API. Each task gets its own git branch and worktree, and is merged only after you approve. The desktop shell and the UI are not built yet.

## Layout

| Path | Purpose |
|---|---|
| `packages/protocol` | API and event types shared by the core and the UI |
| `packages/core` | Local daemon: orchestrator, tasks, approvals, budget |
| `packages/adapters` | Agent CLI adapters (Claude Code, Codex) |
| `packages/git` | Branches, worktrees, diff and merge |
| `packages/storage` | Reading and writing `.losperitos/` |
| `packages/cli` | `peritos` CLI that agents use to message each other |
| `apps/desktop` | Electron shell |
| `apps/ui` | React interface |
| `fixtures` | Fake agent and sample workspace for tests and demo mode |
| `docs/design-prompt.md` | Design brief for the interface (Turkish) |

## Development

```bash
npm install
npm test            # build + tests (uses the fake agent, spends no tokens)
npm run core:fake   # daemon on http://127.0.0.1:7420 with scripted agents
npm run core        # daemon with your own Claude Code CLI
```

The API token is written to `~/.losperitos/token.json` (`~/.losperitos-demo/` in fake mode). Send it as `Authorization: Bearer <token>`; the WebSocket at `/events` takes `?token=`. Routes and event shapes are in `packages/protocol/src/index.ts`.

## How a job flows

1. You message the lead. Small jobs it does itself; larger ones it splits with `peritos task create`.
2. Each task goes to a team member, who works in `.losperitos/worktrees/task-<n>` on branch `peritos/task-<n>-<title>`.
3. The member commits and runs `peritos task done` with a report: done, tested, not verified.
4. That raises a merge approval. Approving merges the branch into the branch you had checked out and removes the worktree; if the merge conflicts it is aborted and the approval stays pending.

Agents reach the core through the `peritos` CLI (`packages/cli`), which the core puts on their `PATH` with a per-agent token.

**Trust modes.** In a `full` workspace agents may edit files and run any shell command in your folder, with your user's permissions. In a `restricted` workspace they can only read and call `peritos`. Rules such as "never merge or push yourself" are instructions to the agent, not a sandbox.

`node scripts/smoke-claude.mjs` and `node scripts/e2e-claude.mjs` check the adapter and the whole flow against your real `claude` CLI; both spend real usage.

In fake mode a message starting with `/ask`, `/approve` or `/fail` makes the agent ask a question, request an approval or fail; anything else is echoed.

## License

MIT
