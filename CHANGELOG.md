# Changelog

## Unreleased

- Kinds of bureau: Software, Marketing and Content, chosen when a folder is
  opened and changeable in Settings. The kind sets the team's roles, how the
  lead and members are briefed, and the wording on screen.
- Reports list the files a task produced, with a preview for Markdown, CSV,
  text and images.
- Outside git, marketing and content bureaus work in a draft folder per task;
  its files are copied into the project only when sealed.

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
