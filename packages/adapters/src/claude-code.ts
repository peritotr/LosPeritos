import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import type { Adapter, AgentSession, SessionEvent, StartOptions } from "./types.js";

/**
 * Translate one line of `claude --output-format stream-json` into session
 * events. Exported for tests; unknown line types are ignored.
 */
export function parseStreamLine(line: string): SessionEvent[] {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return line.trim() ? [{ type: "output", stream: "stdout", chunk: line + "\n" }] : [];
  }
  if (msg?.type === "assistant") {
    const events: SessionEvent[] = [];
    for (const block of msg.message?.content ?? []) {
      if (block.type === "text" && block.text) {
        events.push({ type: "output", stream: "stdout", chunk: block.text + "\n" });
        events.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        const input = JSON.stringify(block.input ?? {});
        const shown = input.length > 200 ? input.slice(0, 200) + "…" : input;
        events.push({ type: "output", stream: "stdout", chunk: `[${block.name}] ${shown}\n` });
      }
    }
    return events;
  }
  if (msg?.type === "result") {
    const events: SessionEvent[] = [];
    if (msg.is_error) {
      events.push({ type: "error", message: String(msg.result ?? msg.subtype ?? "Agent turn failed") });
    }
    const usage = msg.usage ?? {};
    events.push({
      type: "turn_end",
      inputTokens:
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0),
      outputTokens: usage.output_tokens ?? 0,
      costUsd: msg.total_cost_usd ?? 0,
    });
    return events;
  }
  return [];
}

/** Runs the user's own `claude` CLI headless, one long-lived process per agent. */
export class ClaudeCodeAdapter implements Adapter {
  readonly id = "claude-code" as const;

  constructor(private readonly bin = "claude") {}

  check() {
    return new Promise<Awaited<ReturnType<Adapter["check"]>>>((resolve) => {
      execFile(this.bin, ["--version"], { timeout: 10_000 }, (err, stdout) => {
        resolve({
          tool: "claude",
          required: true,
          found: !err,
          version: err ? null : stdout.trim(),
          installHint: err ? "Install Claude Code: https://claude.com/claude-code" : null,
        });
      });
    });
  }

  start(options: StartOptions): AgentSession {
    const args = [
      "--print",
      "--verbose",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      // Headless, an unanswered permission prompt is a denial. A trusted
      // workspace may edit files and run any shell command; a restricted one
      // can read, and run only the `peritos` CLI.
      "--permission-mode", options.trustMode === "full" ? "acceptEdits" : "default",
      "--allowedTools", options.trustMode === "full" ? "Bash" : "Bash(peritos *)",
    ];
    if (options.systemPrompt) args.push("--append-system-prompt", options.systemPrompt);
    for (const dir of options.addDirs ?? []) args.push("--add-dir", dir);

    const child = spawn(this.bin, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const listeners: Array<(event: SessionEvent) => void> = [];
    const emit = (event: SessionEvent) => listeners.forEach((listener) => listener(event));
    let lastCostUsd = 0;

    createInterface({ input: child.stdout }).on("line", (line) => {
      for (const event of parseStreamLine(line)) {
        if (event.type === "turn_end") {
          // The CLI reports cumulative session cost; report the turn's share.
          const total = event.costUsd;
          emit({ ...event, costUsd: Math.max(0, total - lastCostUsd) });
          lastCostUsd = total;
        } else {
          emit(event);
        }
      }
    });
    child.stderr.on("data", (data: Buffer) =>
      emit({ type: "output", stream: "stderr", chunk: data.toString() }),
    );
    child.on("error", (err) => emit({ type: "error", message: `Cannot run ${this.bin}: ${err.message}` }));
    child.on("exit", (code) => emit({ type: "exit", code }));

    return {
      onEvent: (listener) => void listeners.push(listener),
      send(text) {
        const line = JSON.stringify({ type: "user", message: { role: "user", content: text } });
        child.stdin.write(line + "\n");
      },
      stop() {
        return new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          child.once("exit", () => resolve());
          child.stdin.end();
          child.kill("SIGTERM");
        });
      },
    };
  }
}
