import type { ToolCheck, TrustMode } from "@losperitos/protocol";

export type SessionEvent =
  /** Raw terminal-style output for the live view. */
  | { type: "output"; stream: "stdout" | "stderr"; chunk: string }
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
  | { type: "error"; message: string }
  /** The underlying process is gone. */
  | { type: "exit"; code: number | null };

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
  /**
   * How tool calls that need the user's approval reach the core: a command that
   * speaks MCP over stdio and offers an `approve` tool. Without it such calls are refused.
   */
  permissionBridge?: { command: string; args: string[]; env: Record<string, string> };
  /** Folders outside `cwd` the agent may read, e.g. where attachments are kept. */
  addDirs?: string[];
  /** Extra environment for the agent process, on top of the core's own. */
  env?: Record<string, string>;
}

export interface Adapter {
  readonly id: "claude-code" | "codex" | "fake";
  check(): Promise<ToolCheck>;
  start(options: StartOptions): AgentSession;
}
