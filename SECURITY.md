# Security

LosPeritos starts AI agents that read, write and run things on your computer.
That is its purpose, and it is also its risk. This page says what protects you
and what does not.

## What the app does

- **Listens only on your machine.** The core serves HTTP and WebSocket on
  `127.0.0.1`. Every request needs a token stored in `~/.losperitos/token.json`
  (readable only by you). Each agent gets its own token, valid while it runs.
- **Sends nothing anywhere itself.** No telemetry, no update check, no
  account. The agent tool you use (Claude Code) talks to its own provider as
  it always does.
- **Holds merges for you.** A task's branch reaches your checked-out branch
  only when you seal it.
- **Holds risky commands for you.** See below.

## The permission bridge

Agents are started with the agent CLI's permission system pointed at
LosPeritos (`peritos mcp`). A tool call that the CLI will not run on its own
is passed to the app, shown to you as a seal request, and held until you
decide. If the app cannot be reached, the answer is no.

- In a **full** trust project, file edits and ordinary commands run without
  asking. Commands beginning with a prefix in `RISKY_COMMANDS`
  (`packages/adapters/src/claude-code.ts`) are held.
- In a **restricted** project, every edit and every command is held.

## What this does not protect against

- **It is not a sandbox.** Agents run as you, with your files and your
  credentials in reach.
- **Prefix matching can be sidestepped.** `git -C . push`, a shell alias, or a
  script written and then executed are not recognised as risky.
- **Prompt injection.** Text an agent reads (a web page, an issue, a file in
  the repository) can try to steer it. The seal on risky commands limits the
  damage; it does not remove the risk.
- **Attachments and imported issues** are handed to agents as they are.

Use it on projects under version control, with a remote you can restore from.
Prefer restricted mode for code you did not write.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
**Report a vulnerability** button on the repository's Security tab, which
opens a private advisory.
