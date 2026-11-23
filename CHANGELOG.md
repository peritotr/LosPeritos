# Changelog

## Unreleased

**The floor**
- Peritos walk between their desk and yours: a figure on the move lifts one
  leg, then the other, rather than gliding.
- The floor can be drawn larger, up to three times, and scrolls inside its
  frame; the choice is remembered.

**One conversation over every bureau**
- With more than one bureau open, the correspondence panel can show them all
  at once: each message carries its bureau's name, questions and seals are
  answered where they stand, and a message can be written to any bureau's lead.

**Documents**
- A Documents screen gathers what there is to read about a bureau: the
  notebook its team keeps, the Markdown files of the project folder, and the
  lessons you have admitted.
- The team can keep pages in the notebook (`peritos page`): a plan, a decision
  and its reasons, findings worth keeping. A page is the bureau's own, not a
  file of the project, and you can delete it.

**Several repositories in one folder**
- When a folder holds several git repositories rather than being one, a task
  can name the one it works in and gets its own branch there; the lead is told
  which repositories there are, and the form for a new file offers them. The
  Code screen shows one repository at a time.

**Files in the code panel**
- The Code screen has the project's files as a tree, a box that narrows it by
  name, and a search inside the files; a file opens read-only, at the line
  that was found. Files git ignores are left out.

**Updates that install themselves**
- From this release on, the Mac app fetches a newer release in the background
  and installs it when you restart; the side bar says when one is ready.
  Nothing changes while you work, and Settings still turns the daily check off.
  Earlier releases only tell you and link to the download.

**Signing in to a connector**
- A connector whose server asks for a sign-in in the browser can now be
  connected: "Sign in" opens the provider's own page, and the app keeps the
  tokens with the connector's other secrets and renews them. The password
  never passes through the app.
- A fal template for image, video and sound generation.

## 0.3.0 — 2026-11-23

**Update notice**
- The app asks GitHub once a day whether a newer release is out and says so
  in the side bar, with a link to the download. Nothing installs by itself,
  nothing else is sent, and Settings turns the check off.

**Code panel**
- A software bureau under git has a Code screen: the checked-out branch, what
  is not yet committed, the other branches with how far ahead each is (a task's
  branch opens its file), and recent commits with what each changed. It reads
  only; committing and merging stay with the team and the seal.

**A plain view**
- New installs open in a plain view: the side bar shows the bench, the files
  and what awaits you; the archive, the ledger, connectors, trust mode and
  the finer controls of the files are tucked away. "Show everything" brings
  them back, and Settings switches between the two. Nothing is switched off,
  and those who used the app before keep the full view.

**Drafts that hold**
- A member working in a draft cannot edit the project folder with its file
  tools: the folder is read-only to it, and drafts are kept apart from the
  project, with the machine's own state.
- If files in the project change anyway while such a task runs, the seal and
  the chat name them. They are shown, not undone, because the user may have
  made those changes.

**A team that does not go quiet**
- A team member that stops with its task still open is reminded once to
  report or to ask. If it stops again, the user is asked in its name, with
  what it last said, so the task shows among the things waiting.
- Members are told to ask for what they need when something outside their
  control stops them, rather than end with a message.

**The Lead Perito**
- The lead at the head of every bureau floor is now the figure of Alpaslan
  Yılmaz, drawn from the portrait in the README. The pictures in the README
  were taken again.

**Video, sound and PDF**
- A file a task handed in opens in place when it is a video (mp4, m4v, webm,
  mov), a sound (mp3, m4a, wav, ogg) or a PDF, up to 256 MB.

**Connectors**
- A bureau can be given outside services as MCP servers, from Settings: a
  command on this machine or an HTTP address, with its secrets. Secrets are
  kept on the machine in a file only the user can read, never in the project
  folder, and are not shown again.
- Every call to a connector waits for a seal unless the tool has been marked
  as free to use; agents are told which services they can reach.
- Settings lists the tools a connector's server offers, each with a tick for
  "may be used without asking", and shows which ones the server says only read.
- A sealed connector call can be remembered: "do not ask again" frees that one
  tool by name.
- Adding, changing or removing a connector reaches the team at once: agents
  restart on the same conversation when their turn in hand is over.
- A Replicate template fills the form for image and video generation with
  Replicate's own MCP package: looking models up is free to use, every call
  that makes something waits for a seal. Agents save what a service made into
  their working folder, so it arrives as a file of the task.

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
