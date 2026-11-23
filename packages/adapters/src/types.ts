import type { ToolCall, ToolCheck, ToolOutcome, TrustMode } from "@losperitos/protocol";

export type SessionEvent =
  /**
   * Output for the live view. A tool call carries `tool` beside its one-line
   * `chunk`; how it ended arrives later as `result`, with an empty chunk.
   */
  | { type: "output"; stream: "stdout" | "stderr"; chunk: string; tool?: ToolCall; result?: ToolOutcome }
  /** A complete assistant message for the team chat. */
  | { type: "text"; text: string }
  /** The agent asks the user something and waits. */
  | { type: "question"; body: string; options: string[]; recommended?: string }
  /** The agent wants to do something that needs the user's approval. */
  | {
      type: "approval";
      kind: "merge" | "deploy" | "command" | "other";
      title: string;
      detail: string;
      steps: string[];
      reversible: boolean;
    }
  /** The current turn finished; the agent is idle again. */
  | { type: "turn_end"; inputTokens: number; outputTokens: number; costUsd: number }
  /** `limit` is set when the failure is the account's usage limit, with the reset time if known. */
  | { type: "error"; message: string; limit?: { resetAt: string | null } }
  /** The underlying process is gone. */
  | { type: "exit"; code: number | null };

/** One MCP server as Claude Code's `--mcp-config` describes it. */
export type McpServer =
  | { command: string; args: string[]; env: Record<string, string> }
  | { type: "http"; url: string; headers: Record<string, string> };

export interface AgentSession {
  /** Start a turn with a user message. */
  send(text: string): void;
  stop(): Promise<void>;
  onEvent(listener: (event: SessionEvent) => void): void;
}

export interface StartOptions {
  cwd: string;
  trustMode: TrustMode;
  systemPrompt?: string;
  /** Conversation id to start under, or to pick up again when `resume` is set. */
  sessionId?: string;
  resume?: boolean;
  /** Model alias for this agent; the tool's own default when absent. */
  model?: string;
  /**
   * How tool calls that need the user's approval reach the core: a command that
   * speaks MCP over stdio and offers an `approve` tool. Without it such calls are refused.
   */
  permissionBridge?: { command: string; args: string[]; env: Record<string, string> };
  /**
   * Outside services to offer as MCP servers, by the name their tools carry.
   * They may hold secrets, so they are handed over in a file only the user can read.
   */
  connectors?: Record<string, McpServer>;
  /** Folders outside `cwd` the agent may read, e.g. where attachments are kept. */
  addDirs?: string[];
  /**
   * Folders the agent may read but must not write to with its file tools.
   * Shell commands are not held back by this; it is a guard, not a sandbox.
   */
  readOnlyDirs?: string[];
  /** Extra environment for the agent process, on top of the core's own. */
  env?: Record<string, string>;
}

export interface Adapter {
  readonly id: "claude-code" | "codex" | "fake";
  check(): Promise<ToolCheck>;
  start(options: StartOptions): AgentSession;
}
