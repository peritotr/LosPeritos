import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
    let calls = 0;
    /** A tool call and, a moment later, how it ended. */
    const tool = async (name: string, input: Record<string, unknown>, result: string) => {
      const id = `demo-${++calls}`;
      if (stepMs) await new Promise((done) => setTimeout(done, stepMs));
      if (stopped) return;
      emit({ type: "output", stream: "stdout", chunk: `[${name}] ${JSON.stringify(input)}\n`, tool: { id, name, input } });
      if (stepMs) await new Promise((done) => setTimeout(done, stepMs));
      emit({ type: "output", stream: "stdout", chunk: "", result: { id, ok: true, text: result } });
    };
    const type = async (...lines: string[]) => {
      for (const line of lines) {
        if (stepMs) await new Promise((done) => setTimeout(done, stepMs));
        if (stopped) return;
        emit({ type: "output", stream: "stdout", chunk: line + "\n" });
      }
    };
    // The briefing tells the demo which kind of bureau it is playing in.
    const brief = options.systemPrompt ?? "";
    const kind = brief.includes("marketing specialists") ? "marketing" : brief.includes("writers and editors") ? "content" : "software";
    /** Outside a software bureau the work is a document, so the demo leaves one behind. */
    const writeDemoFile = (title: string): string[] => {
      if (kind === "software") return [];
      const name = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "draft";
      const path = join("demo", `${name}.md`);
      mkdirSync(join(options.cwd, "demo"), { recursive: true });
      writeFileSync(
        join(options.cwd, path),
        `# ${title}\n\nA sample document from the **demo agent**. A real perito would write the finished piece here.\n\n` +
          "## Summary\n\n- First point\n- Second point\n- Third point\n\n" +
          "| Item | Status | Note |\n| --- | --- | --- |\n| Headline | Draft | 58 of 60 characters |\n| Description | Draft | 148 of 155 characters |\n",
      );
      return [path];
    };
    let title = "Draft";
    const handIn = () =>
      bridge({
        command: "task.done",
        report: {
          done: ["Played out the scripted demo task"],
          tested: ["Nothing: this is the fake agent"],
          notVerified: ["Everything a real agent would have built"],
          files: writeDemoFile(title),
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
        const jobs: Record<typeof kind, Array<[title: string, specialty: string, description: string]>> = {
          software: [
            ["Build the sign-up form", "developer", "Fields, validation, submit."],
            ["Write the sign-up tests", "tester", "Cover the happy path and bad input. [demo:ask]"],
            ["Publish the preview", "designer", "Put the preview build online. [demo:approve]"],
          ],
          marketing: [
            ["Keyword plan for the spring campaign", "seo", "Twenty keywords with intent and difficulty."],
            ["Search ad copy", "copywriter", "Three headlines and two descriptions per ad group. [demo:ask]"],
            ["Social calendar for April", "social", "Three posts a week, with captions."],
          ],
          content: [
            ["Outline the launch article", "researcher", "Sources, angle and section headings."],
            ["Write the newsletter", "writer", "Four hundred words, one call to action. [demo:ask]"],
            ["Script the product video", "scriptwriter", "Sixty seconds, with a shot list."],
          ],
        };
        const tasks = jobs[kind];
        for (const [title, specialty, description] of tasks) {
          await bridge({ command: "task.create", title, specialty, description });
          await type("…");
        }
        emit({ type: "text", text: "I split the job into three dossiers and handed them out." });
      } else if (text.startsWith("Your task #") && url) {
        title = text.split("\n")[0]!.replace(/^Your task #\d+: /, "");
        await type("Opening the dossier…");
        await tool("Read", { file_path: "notes/brief.md" }, "# Brief\nWhat the user asked for, in their words.");
        await tool(
          "Edit",
          { file_path: "notes/plan.md", old_string: "- [ ] first draft", new_string: "- [x] first draft\n- [ ] review" },
          "The file notes/plan.md has been updated.",
        );
        await tool("Bash", { command: "npm test" }, "12 passing\n0 failing");
        await type("Running checks…");
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
