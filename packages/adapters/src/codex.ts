import { spawn, execFile, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { parseLimit } from "./claude-code.js";
import { launch, started, viaShell } from "./launch.js";
import type { Adapter, AgentSession, SessionEvent, StartOptions } from "./types.js";

/**
 * What is remembered about a Codex conversation between turns and restarts:
 * Codex names its own threads, and reports token use as a running total.
 */
interface Thread {
  threadId: string;
  inputTokens: number;
  outputTokens: number;
}

const MAX_SHOWN = 6000;
const clip = (text: string) => (text.length > MAX_SHOWN ? text.slice(0, MAX_SHOWN) + "\n…" : text);

/** TOML for a `-c key=value` override: JSON strings, arrays and inline tables are valid TOML values. */
const toml = (value: unknown): string =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(",")}}`
    : JSON.stringify(value);

/**
 * Translate one line of `codex exec --json` into session events. `usage` is
 * the thread's running total, or null on a line that carries none; the caller
 * turns it into what this turn used. Exported for tests.
 */
export function parseCodexLine(line: string): { events: SessionEvent[]; threadId?: string; usage?: { input: number; output: number }; failed?: boolean } {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return { events: line.trim() ? [{ type: "output", stream: "stdout", chunk: line + "\n" }] : [] };
  }
  const item = msg?.item;
  switch (msg?.type) {
    case "thread.started":
      return { events: [], threadId: typeof msg.thread_id === "string" ? msg.thread_id : undefined };
    case "turn.completed": {
      const usage = msg.usage ?? {};
      return {
        events: [],
        usage: {
          input: (usage.input_tokens ?? 0) + (usage.cache_write_input_tokens ?? 0),
          output: usage.output_tokens ?? 0,
        },
      };
    }
    case "turn.failed":
    case "error": {
      const message = String(msg.error?.message ?? msg.message ?? "Codex turn failed");
      const limit = parseLimit(message.replace(/’/g, "'"));
      return { events: [{ type: "error", message, ...(limit && { limit }) }], failed: true };
    }
    case "item.started":
      if (item?.type === "command_execution") {
        const command = String(item.command ?? "");
        return { events: [{ type: "output", stream: "stdout", chunk: `[Bash] ${command.slice(0, 200)}\n`, tool: { id: String(item.id), name: "Bash", input: { command: clip(command) } } }] };
      }
      if (item?.type === "mcp_tool_call") {
        const name = `mcp__${item.server}__${item.tool}`;
        return { events: [{ type: "output", stream: "stdout", chunk: `[${name}]\n`, tool: { id: String(item.id), name, input: (item.arguments as Record<string, unknown>) ?? {} } }] };
      }
      return { events: [] };
    case "item.completed":
      if (item?.type === "agent_message" && item.text) {
        return { events: [{ type: "output", stream: "stdout", chunk: item.text + "\n" }, { type: "text", text: String(item.text) }] };
      }
      if (item?.type === "command_execution") {
        return { events: [{ type: "output", stream: "stdout", chunk: "", result: { id: String(item.id), ok: item.exit_code === 0, text: clip(String(item.aggregated_output ?? "")) } }] };
      }
      if (item?.type === "mcp_tool_call") {
        const text = item.error?.message ?? (item.result?.content ?? []).map((part: any) => part?.text ?? "").join("");
        return { events: [{ type: "output", stream: "stdout", chunk: "", result: { id: String(item.id), ok: item.status === "completed", text: clip(String(text)) } }] };
      }
      if (item?.type === "file_change") {
        const changes = (item.changes ?? []).map((change: any) => `${change.kind} ${change.path}`);
        return {
          events: [
            { type: "output", stream: "stdout", chunk: `[Edit] ${changes.join(", ").slice(0, 200)}\n`, tool: { id: String(item.id), name: "Edit", input: { changes } } },
            { type: "output", stream: "stdout", chunk: "", result: { id: String(item.id), ok: item.status !== "failed", text: changes.join("\n") } },
          ],
        };
      }
      // Notices (a model swap, a config warning) arrive as error items; they are not failures.
      if (item?.type === "error" && item.message) return { events: [{ type: "output", stream: "stderr", chunk: String(item.message) + "\n" }] };
      return { events: [] };
    default:
      return { events: [] };
  }
}

/** One word of the hook's command line, quoted for the shell Codex hands it to. */
function hookWord(word: string): string {
  if (process.platform === "win32") return /[\s"]/.test(word) ? `"${word.replace(/"/g, '\\"')}"` : word;
  return /[^\w@%+=:,./-]/.test(word) ? `'${word.replace(/'/g, "'\\''")}'` : word;
}

/**
 * Runs the user's own `codex` CLI headless: one `codex exec` per turn, the
 * conversation carried on with `resume`.
 *
 * Codex cannot hold a command back for the user's seal the way Claude Code
 * can: in this mode it never asks. What confines it is its own sandbox, which
 * lets it write only in the working folder. The network is left open because
 * the agent reaches the team through `peritos`, on this machine.
 */
export class CodexAdapter implements Adapter {
  readonly id = "codex" as const;

  /** `stateFile` keeps the thread of each conversation; without it a restart starts conversations anew. */
  constructor(
    private readonly bin = "codex",
    private readonly stateFile?: string,
  ) {}

  private threads(): Record<string, Thread> {
    if (!this.stateFile || !existsSync(this.stateFile)) return {};
    try {
      return JSON.parse(readFileSync(this.stateFile, "utf8")) as Record<string, Thread>;
    } catch {
      return {};
    }
  }

  private keep(sessionId: string, thread: Thread): void {
    if (!this.stateFile) return;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify({ ...this.threads(), [sessionId]: thread }), { mode: 0o600 });
  }

  check() {
    return new Promise<Awaited<ReturnType<Adapter["check"]>>>((resolve) => {
      execFile(...started(this.bin, ["--version"]), { timeout: 10_000, ...viaShell(this.bin) }, (err, stdout) => {
        const check = {
          tool: "codex" as const,
          required: false,
          found: !err,
          version: err ? null : stdout.trim(),
          installHint: err ? "Install Codex: npm install -g @openai/codex, then run codex login" : null,
        };
        if (err) return resolve(check);
        // Codex answers with its exit code: 0 signed in, 1 not.
        execFile(...started(this.bin, ["login", "status"]), { timeout: 15_000, ...viaShell(this.bin) }, (failed) => {
          const code = (failed as (Error & { code?: unknown }) | null)?.code;
          resolve({ ...check, ...(failed === null ? { signedIn: true } : code === 1 ? { signedIn: false } : {}) });
        });
      });
    });
  }

  start(options: StartOptions): AgentSession {
    const listeners: Array<(event: SessionEvent) => void> = [];
    const emit = (event: SessionEvent) => listeners.forEach((listener) => listener(event));
    let thread: Thread | null = (options.resume && options.sessionId && this.threads()[options.sessionId]) || null;
    const waiting: string[] = [];
    let child: ChildProcess | null = null;
    let stopped = false;

    const config: string[] = ["sandbox_workspace_write.network_access=true"];
    if (options.systemPrompt) config.push(`developer_instructions=${toml(options.systemPrompt)}`);
    for (const [name, server] of Object.entries(options.connectors ?? {})) {
      const key = `mcp_servers.${name}`;
      if ("url" in server) config.push(`${key}.url=${toml(server.url)}`, `${key}.http_headers=${toml(server.headers)}`);
      else config.push(`${key}.command=${toml(server.command)}`, `${key}.args=${toml(server.args)}`, `${key}.env=${toml(server.env)}`);
    }

    // Codex cannot ask before a command, but it can show each call to a hook first: the bridge's own
    // command, run as `hook`, holds the risky ones for the user's seal. Unknown settings are ignored by
    // Codex, so where hooks do not run this changes nothing.
    const hook = options.permissionBridge
      ? [options.permissionBridge.command, ...options.permissionBridge.args.slice(0, -1), "hook"].map(hookWord).join(" ")
      : null;
    if (hook) config.push(`hooks.PreToolUse=[{matcher=".*",hooks=[{type="command",command=${toml(hook)},timeout=604800}]}]`);

    const turn = (text: string) => {
      const args = ["exec", "--json", "--skip-git-repo-check", "-C", options.cwd, "-s", "workspace-write"];
      if (hook) args.push("--dangerously-bypass-hook-trust");
      // A model name meant for another tool would be refused: only Codex's own are passed on.
      if (options.model && /^(gpt|o\d|codex)/i.test(options.model)) args.push("-m", options.model);
      for (const entry of config) args.push("-c", entry);
      if (thread) args.push("resume", thread.threadId);
      args.push("-");
      const how = launch(this.bin, args);
      const running = spawn(how.file, how.args, { shell: how.shell, cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ["pipe", "pipe", "pipe"] });
      child = running;
      let ended = false;
      let failed = false;
      let complaint = "";
      const end = (input: number, output: number) => {
        if (ended) return;
        ended = true;
        emit({ type: "turn_end", inputTokens: input, outputTokens: output, costUsd: 0 });
      };
      createInterface({ input: running.stdout! }).on("line", (line) => {
        const parsed = parseCodexLine(line);
        if (parsed.threadId) {
          thread = { threadId: parsed.threadId, inputTokens: thread?.threadId === parsed.threadId ? thread.inputTokens : 0, outputTokens: thread?.threadId === parsed.threadId ? thread.outputTokens : 0 };
          if (options.sessionId) this.keep(options.sessionId, thread);
        }
        // Codex says a failure twice, as an error and as a failed turn: once is enough.
        const again = parsed.failed && failed;
        if (parsed.failed) failed = true;
        if (!again) parsed.events.forEach(emit);
        if (parsed.usage) {
          // Codex counts for the whole thread: what this turn used is the difference.
          const input = Math.max(0, parsed.usage.input - (thread?.inputTokens ?? 0));
          const output = Math.max(0, parsed.usage.output - (thread?.outputTokens ?? 0));
          if (thread) {
            thread = { ...thread, inputTokens: parsed.usage.input, outputTokens: parsed.usage.output };
            if (options.sessionId) this.keep(options.sessionId, thread);
          }
          end(input, output);
        }
      });
      running.stderr!.on("data", (data: Buffer) => {
        complaint = (complaint + data.toString()).slice(-2000);
        emit({ type: "output", stream: "stderr", chunk: data.toString() });
      });
      running.on("error", (err) => {
        emit({ type: "error", message: `Cannot run ${this.bin}: ${err.message}` });
        end(0, 0);
      });
      running.on("exit", (code) => {
        if (child === running) child = null;
        if (stopped) return;
        if (!ended) {
          // It went without saying how the turn ended: say what it left on the way out.
          if (!failed) {
            const message = complaint.trim().split("\n").pop() || `Codex stopped with code ${code}`;
            const limit = parseLimit(message.replace(/’/g, "'"));
            emit({ type: "error", message, ...(limit && { limit }) });
          }
          end(0, 0);
        }
        const next = waiting.shift();
        if (next !== undefined) turn(next);
      });
      running.stdin!.end(text);
    };

    return {
      onEvent: (listener) => void listeners.push(listener),
      send(text) {
        if (stopped) return;
        if (child) waiting.push(text);
        else turn(text);
      },
      stop() {
        return new Promise<void>((resolve) => {
          const done = () => {
            emit({ type: "exit", code: 0 });
            resolve();
          };
          if (stopped) return resolve();
          stopped = true;
          waiting.length = 0;
          const running = child;
          if (!running || running.exitCode !== null || running.signalCode !== null) return done();
          running.once("exit", done);
          running.kill("SIGTERM");
        });
      },
    };
  }
}
