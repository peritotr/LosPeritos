import type { Adapter, AgentSession, SessionEvent, StartOptions } from "./types.js";

/**
 * A scripted agent for tests and demo mode. It spends no tokens.
 * A message starting with `/ask` makes it ask a question, `/approve` makes it
 * request an approval, `/fail` makes it error; anything else is echoed.
 */
export class FakeAdapter implements Adapter {
  readonly id = "fake" as const;

  /** Options of every session started, for tests. */
  readonly starts: StartOptions[] = [];

  constructor(private readonly costPerTurnUsd = 0.01) {}

  async check() {
    return { tool: "claude" as const, required: true, found: true, version: "fake", installHint: null };
  }

  start(options: StartOptions): AgentSession {
    this.starts.push(options);
    const listeners: Array<(event: SessionEvent) => void> = [];
    const emit = (event: SessionEvent) => listeners.forEach((listener) => listener(event));
    let stopped = false;
    const cost = this.costPerTurnUsd;

    return {
      onEvent: (listener) => void listeners.push(listener),
      send(text) {
        setImmediate(() => {
          if (stopped) return;
          emit({ type: "output", stream: "stdout", chunk: `> ${text}\n` });
          if (text.startsWith("/fail")) {
            emit({ type: "error", message: "Fake failure" });
            return;
          }
          if (text.startsWith("/ask")) {
            emit({ type: "question", body: "Which option should I take?", options: ["A", "B"] });
          } else if (text.startsWith("/approve")) {
            emit({
              type: "approval",
              kind: "deploy",
              title: "Deploy to staging",
              detail: "Fake deploy for demo mode.",
              steps: ["build", "upload", "check"],
              reversible: true,
            });
          } else {
            emit({ type: "text", text: `Echo: ${text}` });
          }
          emit({ type: "turn_end", inputTokens: 10, outputTokens: 20, costUsd: cost });
        });
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        emit({ type: "exit", code: 0 });
      },
    };
  }
}
