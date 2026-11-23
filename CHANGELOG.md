# Changelog

## Unreleased

- Messages from the team are shown as formatted text in the chat, not with raw
  Markdown marks.
- Marketing and content bureaus no longer show the GitHub import, and the
  brief box gives an example that fits the kind of bureau.
- Setup says what happens outside git for each kind of bureau.

## 0.2.0 — 2026-11-23

**Kinds of bureau**
- Software, Marketing and Content, chosen when a folder is opened and
  changeable in Settings. The kind sets the team's roles, how the lead and
  members are briefed, and the wording on screen.
- Reports list the files a task produced, with a preview for Markdown, CSV,
  text and images. A document bureau opens a file on its output instead of a
  list of changes.
- Outside git, marketing and content bureaus work in a draft folder per task;
  its files are copied into the project only when sealed.

**Watching the work**
- Each tool an agent uses is a block that opens: a command with its output, an
  edit as removed and added lines, a written file as its content.
- Seals and system notes written by the core are shown in the interface
  language.

**Getting started and managing files**
- A five-card tour on first use, and starter jobs for an empty bureau.
- Labels on files, with a filter.
- A rough cost shown before a file is handed out, learned from the bureau's
  own closed files.
- Admit all proposed lessons at once.

## 0.1.0 — 2026-11-23

The first version that works end to end.

**The team**
- A lead and up to seven team members per project, each task on its own git
  branch and worktree, merged only when sealed.
- Tasks written by the lead or by you, with priority, effort, dependencies,
  drafts, cancelling, and a pause on handing out work.
- Import of open GitHub issues as drafts.
- Reports with done, tested and not-verified lists.

**Control**
- Risky commands are held for approval through a permission bridge; restricted
  projects hold every edit and command.
- Questions with a suggested answer; "don't ask again" keeps an answer as a
  lesson; accepted lessons are given to every agent.
- A daily budget per project.

**Staying on the job**
- Conversations survive a restart.
- An agent that hits the usage limit waits and resumes by itself.
- Cheaper or bigger models for small or large tasks.
- The desktop app keeps the computer awake while agents work.

**The app**
- The Bench with a live, furnished bureau floor; Files; Correspondence as a
  panel on every screen, with attachments; Awaiting you; Archive; Ledger;
  Settings; Setup; a command palette.
- "While you were away" summary.
- English and Turkish; light and dark.
- macOS desktop app, signed and notarised when built with a Developer ID.

**Known limits**
- macOS on Apple silicon only; Claude Code only.
- Usage-limit handling is tested against a simulated limit only.
