import { spawn, execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Adapter, AgentSession, SessionEvent, StartOptions } from "./types.js";

/**
 * Translate one line of `claude --output-format stream-json` into session
 * events. Exported for tests; unknown line types are ignored.
 */
/**
 * Recognise the CLI's "usage limit" failure and work out when it lifts.
 * Its wording has changed between versions, so several forms are accepted:
 * a Unix time after a bar, or a clock time after "reset(s) (at)".
 */
export function parseLimit(message: string, now = new Date()): { resetAt: string | null } | undefined {
  if (!/usage limit|hit your limit|limit reached|out of (extra )?usage/i.test(message)) return undefined;
  const epoch = /\|(\d{10})\b/.exec(message);
  if (epoch) return { resetAt: new Date(Number(epoch[1]) * 1000).toISOString() };
  const clock = /reset(?:s)?(?: at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(message);
  if (clock) {
    let hour = Number(clock[1]);
    const half = clock[3]?.toLowerCase();
    if (half === "pm" && hour < 12) hour += 12;
    if (half === "am" && hour === 12) hour = 0;
    const at = new Date(now);
    at.setHours(hour, Number(clock[2] ?? 0), 0, 0);
    // A time already past today means tomorrow.
    if (at <= now) at.setDate(at.getDate() + 1);
    return { resetAt: at.toISOString() };
  }
  return { resetAt: null };
}

const MAX_SHOWN = 6000;
const clip = (text: string) => (text.length > MAX_SHOWN ? text.slice(0, MAX_SHOWN) + "\n…" : text);
/** Keep a tool's arguments small enough to send to every window. */
function clipValues(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === "string" ? clip(value) : value]),
  );
}

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
        events.push({
          type: "output",
          stream: "stdout",
          chunk: `[${block.name}] ${shown}\n`,
          ...(block.id && { tool: { id: block.id, name: String(block.name), input: clipValues(block.input ?? {}) } }),
        });
      }
    }
    return events;
  }
  if (msg?.type === "user") {
    // Tool results come back as the "user" side of the conversation.
    const events: SessionEvent[] = [];
    const content = msg.message?.content;
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type !== "tool_result" || !block.tool_use_id) continue;
      const text = Array.isArray(block.content)
        ? block.content.map((part: any) => (part?.type === "text" ? part.text : "")).join("")
        : String(block.content ?? "");
      events.push({
        type: "output",
        stream: "stdout",
        chunk: "",
        result: { id: block.tool_use_id, ok: !block.is_error, text: clip(text) },
      });
    }
    return events;
  }
  if (msg?.type === "result") {
    const events: SessionEvent[] = [];
    if (msg.is_error) {
      const message = String(msg.result ?? msg.subtype ?? "Agent turn failed");
      const limit = parseLimit(message);
      events.push({ type: "error", message, ...(limit && { limit }) });
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

/** A person may take a long time to answer; never give up on them. */
const APPROVAL_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Commands that publish, deploy, destroy or reach other machines. Even in a
 * fully trusted workspace these wait for the user's seal. Matching is by
 * prefix, so it is a safety net, not a sandbox: `git -C . push` slips past.
 */
export const RISKY_COMMANDS = [
  "git push", "git merge", "git reset --hard", "git clean", "git rebase",
  "rm -rf", "rm -fr", "sudo",
  "npm publish", "pnpm publish", "yarn publish",
  "vercel", "netlify", "firebase deploy", "fly deploy", "wrangler deploy", "wrangler publish",
  "gh release", "gh pr merge", "gh repo delete",
  "docker push", "kubectl apply", "kubectl delete", "terraform apply", "terraform destroy",
  "ssh", "scp", "rsync",
  "fastlane", "eas submit", "xcrun altool", "xcrun notarytool",
];

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
    if (options.sessionId) args.push(options.resume ? "--resume" : "--session-id", options.sessionId);
    if (options.model) args.push("--model", options.model);
    if (options.systemPrompt) args.push("--append-system-prompt", options.systemPrompt);
    for (const dir of options.addDirs ?? []) args.push("--add-dir", dir);
    /** Where the connectors' configuration was written, to be removed when the agent ends. */
    let secretDir: string | null = null;
    if (options.connectors && Object.keys(options.connectors).length > 0) {
      // A file rather than an argument: arguments can be read by any process of this user.
      secretDir = mkdtempSync(join(tmpdir(), "losperitos-mcp-"));
      const file = join(secretDir, "connectors.json");
      writeFileSync(file, JSON.stringify({ mcpServers: options.connectors }), { mode: 0o600 });
      args.push("--mcp-config", file);
    }
    if (options.permissionBridge) {
      args.push(
        "--mcp-config",
        JSON.stringify({ mcpServers: { peritos: { ...options.permissionBridge, timeout: APPROVAL_TIMEOUT_MS } } }),
        "--permission-prompt-tool",
        "mcp__peritos__approve",
      );
      // An "ask" rule wins over the broad Bash allowance above, so these always go to the user.
      if (options.trustMode === "full") {
        args.push("--settings", JSON.stringify({ permissions: { ask: RISKY_COMMANDS.map((prefix) => `Bash(${prefix}:*)`) } }));
      }
    }

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
    const forget = () => secretDir && rmSync(secretDir, { recursive: true, force: true });
    child.on("exit", forget);
    child.on("error", forget);

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
