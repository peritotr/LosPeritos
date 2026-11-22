import type { AgentCommandInput } from "@losperitos/protocol";
import type { Adapter, AgentSession, SessionEvent, StartOptions } from "./types.js";

/**
 * A scripted agent for tests and demo mode. It spends no tokens.
 *
 * Slash commands: `/ask` asks a question, `/approve` requests an approval,
 * `/fail` errors, and `/team` (lead, with the bridge up) splits a demo job
 * into three tasks. A team member plays out its task and hands it in; a task
 * description containing `[demo:ask]` or `[demo:approve]` makes it stop for
 * the user first. Anything else is echoed.
 */
export class FakeAdapter implements Adapter {
  readonly id = "fake" as const;

  /** Options of every session started, for tests. */
  readonly starts: StartOptions[] = [];

  /**
   * @param demoStepMs turns on the scripted team demo, pausing this long
   *   between output lines; null (the default) keeps the agent a plain echo.
   */
  constructor(
    private readonly costPerTurnUsd = 0.01,
    private readonly demoStepMs: number | null = null,
  ) {}

  async check() {
    return { tool: "claude" as const, required: true, found: true, version: "fake", installHint: null };
  }

  start(options: StartOptions): AgentSession {
    this.starts.push(options);
    const listeners: Array<(event: SessionEvent) => void> = [];
    const emit = (event: SessionEvent) => listeners.forEach((listener) => listener(event));
    const cost = this.costPerTurnUsd;
    const stepMs = this.demoStepMs ?? 0;
    // The demo needs the bridge to reach the core.
    const url = this.demoStepMs === null ? undefined : options.env?.LOSPERITOS_URL;
    const token = options.env?.LOSPERITOS_AGENT_TOKEN;
    let stopped = false;
    /** A member that stopped for the user finishes its task on the next message. */
    let finishOnNextMessage = false;

    /** What the real agent does through the `peritos` CLI. */
    const bridge = async (command: AgentCommandInput) => {
      const response = await fetch(`${url}/agent`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const body = (await response.json()) as { message?: string; error?: { message: string } };
      emit({ type: "output", stream: "stdout", chunk: `${body.message ?? body.error?.message}\n` });
    };
    const type = async (...lines: string[]) => {
      for (const line of lines) {
        if (stepMs) await new Promise((done) => setTimeout(done, stepMs));
        if (stopped) return;
        emit({ type: "output", stream: "stdout", chunk: line + "\n" });
      }
    };
    const handIn = () =>
      bridge({
        command: "task.done",
        report: {
          done: ["Played out the scripted demo task"],
          tested: ["Nothing: this is the fake agent"],
          notVerified: ["Everything a real agent would have built"],
        },
      });

    const turn = async (text: string) => {
      emit({ type: "output", stream: "stdout", chunk: `> ${text.split("\n")[0]}\n` });
      if (text.startsWith("/limit")) {
        // Pretend the account's usage limit is spent, lifting in a moment.
        emit({ type: "error", message: "Usage limit reached", limit: { resetAt: new Date(Date.now() + 60).toISOString() } });
        return;
      }
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
      } else if (text.startsWith("/team") && url) {
        await type("Reading the brief…", "Splitting the job into three dossiers…");
        const tasks: Array<[title: string, specialty: string, description: string]> = [
          ["Build the sign-up form", "developer", "Fields, validation, submit."],
          ["Write the sign-up tests", "tester", "Cover the happy path and bad input. [demo:ask]"],
          ["Publish the preview", "designer", "Put the preview build online. [demo:approve]"],
        ];
        for (const [title, specialty, description] of tasks) {
          await bridge({ command: "task.create", title, specialty, description });
          await type("…");
        }
        emit({ type: "text", text: "I split the job into three dossiers and handed them out." });
      } else if (text.startsWith("Your task #") && url) {
        await type("Opening the dossier…", "Reading the code…", "Drafting the change…", "Running checks…");
        if (text.includes("[demo:ask]")) {
          finishOnNextMessage = true;
          await bridge({
            command: "ask",
            body: "Should the tests also cover the password-reset flow?",
            options: ["Yes, cover it", "No, sign-up only"],
            recommended: "No, sign-up only",
          });
        } else if (text.includes("[demo:approve]")) {
          finishOnNextMessage = true;
          await bridge({
            command: "approval",
            kind: "deploy",
            title: "Publish the preview build",
            detail: "Uploads the current build to the preview address so it can be reviewed.",
            steps: ["Build", "Upload", "Health check"],
            reversible: true,
          });
        } else {
          await bridge({ command: "send", to: "lead", body: "The form is in place; handing it in." });
          await bridge({ command: "lesson", text: "Validate form input on the server as well as in the browser." });
          await handIn();
        }
      } else if (finishOnNextMessage && url) {
        finishOnNextMessage = false;
        await type("Continuing…", "Finishing up…");
        await handIn();
      } else if (url && (text.startsWith("Message from") || text.startsWith("Task #"))) {
        emit({ type: "text", text: "Noted." });
      } else {
        emit({ type: "text", text: `Echo: ${text}` });
      }
      emit({ type: "turn_end", inputTokens: 10, outputTokens: 20, costUsd: cost });
    };

    return {
      onEvent: (listener) => void listeners.push(listener),
      send(text) {
        setImmediate(() => {
          if (stopped) return;
          turn(text).catch((err: Error) => emit({ type: "error", message: err.message }));
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
