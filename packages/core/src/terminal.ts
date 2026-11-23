/**
 * Real terminals for the user: a shell in a bureau's folder (or a task's
 * working folder), kept running by the core so that leaving the screen and
 * coming back finds it as it was.
 */
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Terminal } from "@losperitos/protocol";

/** How much of what a terminal printed is kept for a screen that attaches later. */
const KEPT_CHARS = 200_000;

interface Pty {
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}
type Spawn = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }) => Pty;

let spawnPty: Spawn | null | undefined;
/** The pseudo-terminal library is native and optional: without it there are no terminals, and the rest works. */
function library(): Spawn | null {
  if (spawnPty !== undefined) return spawnPty;
  try {
    const require = createRequire(import.meta.url);
    const found = require("node-pty") as { spawn: Spawn };
    // npm unpacks the helper that starts the shell without its execute bit.
    const helper = join(dirname(require.resolve("node-pty/package.json")), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    if (existsSync(helper)) {
      try {
        chmodSync(helper, 0o755);
      } catch {
        // Read-only install: it either already runs or the spawn below says why not.
      }
    }
    spawnPty = found.spawn;
  } catch {
    spawnPty = null;
  }
  return spawnPty;
}

interface Running {
  info: Terminal;
  pty: Pty;
  kept: string;
  watchers: Set<(message: TerminalMessage) => void>;
}
export type TerminalMessage = { type: "data"; data: string } | { type: "exit"; code: number };

export class Terminals {
  private readonly running = new Map<string, Running>();

  get available(): boolean {
    return library() !== null;
  }

  list(workspaceId: string): Terminal[] {
    return [...this.running.values()].filter((item) => item.info.workspaceId === workspaceId).map((item) => item.info);
  }

  open(workspaceId: string, cwd: string, title: string, cols: number, rows: number, now: Date): Terminal {
    const spawn = library();
    if (!spawn) throw new Error("Terminals are not available in this build.");
    const windows = process.platform === "win32";
    const shell = windows ? (process.env.COMSPEC ?? "cmd.exe") : (process.env.SHELL ?? "/bin/zsh");
    const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => typeof pair[1] === "string"));
    // The app's own switches are not the shell's business.
    for (const name of Object.keys(env)) if (name.startsWith("ELECTRON_") || name.startsWith("LOSPERITOS_")) delete env[name];
    const pty = spawn(shell, windows ? [] : ["-l"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    const info: Terminal = { id: randomUUID(), workspaceId, title, cwd, alive: true, exitCode: null, createdAt: now.toISOString() };
    const entry: Running = { info, pty, kept: "", watchers: new Set() };
    this.running.set(info.id, entry);
    pty.onData((data) => {
      entry.kept = (entry.kept + data).slice(-KEPT_CHARS);
      for (const watcher of entry.watchers) watcher({ type: "data", data });
    });
    pty.onExit(({ exitCode }) => {
      entry.info = { ...entry.info, alive: false, exitCode };
      for (const watcher of entry.watchers) watcher({ type: "exit", code: exitCode });
    });
    return info;
  }

  /** Follow a terminal: what it printed so far arrives first. Returns how to stop following. */
  attach(id: string, watcher: (message: TerminalMessage) => void): (() => void) | null {
    const entry = this.running.get(id);
    if (!entry) return null;
    if (entry.kept) watcher({ type: "data", data: entry.kept });
    if (!entry.info.alive) watcher({ type: "exit", code: entry.info.exitCode ?? 0 });
    entry.watchers.add(watcher);
    return () => entry.watchers.delete(watcher);
  }

  write(id: string, data: string): void {
    const entry = this.running.get(id);
    if (entry?.info.alive) entry.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.running.get(id);
    if (!entry?.info.alive) return;
    try {
      entry.pty.resize(Math.max(2, Math.min(500, Math.floor(cols))), Math.max(1, Math.min(300, Math.floor(rows))));
    } catch {
      // The shell went away between the check and the call.
    }
  }

  close(id: string): Terminal | null {
    const entry = this.running.get(id);
    if (!entry) return null;
    this.running.delete(id);
    if (entry.info.alive) {
      try {
        entry.pty.kill();
      } catch {
        // Already gone.
      }
    }
    return entry.info;
  }

  closeAll(workspaceId?: string): void {
    for (const [id, entry] of this.running) if (!workspaceId || entry.info.workspaceId === workspaceId) this.close(id);
  }
}
