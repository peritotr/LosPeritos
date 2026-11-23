#!/usr/bin/env node
/**
 * `peritos` — how an agent talks to the LosPeritos core.
 * The core starts each agent with LOSPERITOS_URL and LOSPERITOS_AGENT_TOKEN set.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { AgentCommandInput } from "@losperitos/protocol";
import { runPermissionBridge } from "./mcp.js";

const USAGE = `Usage:
  peritos task create --title <t> [--description <d>] [--specialty <s>] [--effort small|normal|large] [--priority low|normal|high] [--after <n>...] [--label <tag>...]   (lead)
  peritos task list
  peritos task done --done <text>... [--tested <text>...] [--not-verified <text>...] [--file <path>...]
  peritos send --to <agent name|lead|user> <message>
  peritos ask <question> [--option <o>...] [--recommend <o>]
  peritos approval --title <t> [--kind deploy|command|other] [--detail <d>] [--step <s>...] [--irreversible]
  peritos lesson <text>
  peritos page --title <t> (--file <markdown file> | <markdown text>)
  peritos pages [<title>]
  peritos bureaus`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function build(argv: string[]): AgentCommandInput {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      title: { type: "string" },
      description: { type: "string" },
      specialty: { type: "string" },
      effort: { type: "string" },
      priority: { type: "string" },
      after: { type: "string", multiple: true },
      label: { type: "string", multiple: true },
      repo: { type: "string" },
      done: { type: "string", multiple: true },
      tested: { type: "string", multiple: true },
      "not-verified": { type: "string", multiple: true },
      file: { type: "string", multiple: true },
      to: { type: "string" },
      option: { type: "string", multiple: true },
      recommend: { type: "string" },
      kind: { type: "string" },
      detail: { type: "string" },
      step: { type: "string", multiple: true },
      irreversible: { type: "boolean" },
    },
  });
  const [group, ...rest] = positionals;
  const text = rest.join(" ");
  switch (group === "task" ? `task.${rest[0]}` : group) {
    case "task.create":
      return {
        command: "task.create",
        title: values.title ?? "",
        description: values.description,
        specialty: values.specialty,
        effort: values.effort as "small" | "normal" | "large" | undefined,
        priority: values.priority as "low" | "normal" | "high" | undefined,
        after: values.after?.map(Number),
        labels: values.label,
        repo: values.repo,
      };
    case "task.list":
      return { command: "task.list" };
    case "task.done":
      return {
        command: "task.done",
        report: {
          done: values.done ?? [],
          tested: values.tested ?? [],
          notVerified: values["not-verified"] ?? [],
          files: values.file,
        },
      };
    case "send":
      return { command: "send", to: values.to ?? "", body: text };
    case "ask":
      return { command: "ask", body: text, options: values.option, recommended: values.recommend };
    case "approval":
      return {
        command: "approval",
        kind: values.kind as "deploy" | "command" | "other" | undefined,
        title: values.title ?? "",
        detail: values.detail,
        steps: values.step,
        reversible: !values.irreversible,
      };
    case "lesson":
      return { command: "lesson", text };
    case "page": {
      const [file] = values.file ?? [];
      let body = text;
      if (file) {
        try {
          body = readFileSync(file, "utf8");
        } catch {
          fail(`Cannot read ${file}`);
        }
      }
      return { command: "page", title: values.title ?? "", body };
    }
    case "bureaus":
      return { command: "bureaus" };
    case "pages":
      return { command: "pages", title: text || undefined };
    default:
      fail(USAGE);
  }
}

const url = process.env.LOSPERITOS_URL;
const token = process.env.LOSPERITOS_AGENT_TOKEN;
if (!url || !token) fail("peritos only works inside an agent started by LosPeritos.");

if (process.argv[2] === "hook") {
  // Called by the agent tool before a tool runs, with the call as JSON on stdin (Codex's PreToolUse hook).
  // Silence lets the call through; a refusal is said in the form the tool expects.
  await runHook(url, token);
} else if (process.argv[2] === "mcp") {
  // Not a one-shot command: serve permission requests until the agent's CLI closes the pipe.
  runPermissionBridge(url, token);
} else {
  await runCommand(url, token);
}

async function runCommand(url: string, token: string): Promise<void> {
let command: AgentCommandInput;
try {
  command = build(process.argv.slice(2));
} catch (err) {
  fail(`${(err as Error).message}\n\n${USAGE}`);
}

try {
  const response = await fetch(`${url}/agent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await response.json()) as { message?: string; error?: { message: string } };
  if (!response.ok) fail(`Error: ${body.error?.message ?? response.statusText}`);
  console.log(body.message);
} catch (err) {
  fail(`Cannot reach LosPeritos: ${(err as Error).message}`);
}
}

async function runHook(url: string, token: string): Promise<void> {
  let call: { tool_name?: unknown; tool_input?: unknown };
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    call = JSON.parse(Buffer.concat(chunks).toString() || "{}") as typeof call;
  } catch {
    return; // Not a call we can read: leave it to the tool's own guard.
  }
  const tool = typeof call.tool_name === "string" ? call.tool_name : "";
  if (!tool) return;
  const input = call.tool_input !== null && typeof call.tool_input === "object" ? (call.tool_input as Record<string, unknown>) : {};
  let decision = "approved";
  try {
    const response = await fetch(`${url}/agent/hook`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tool, input }),
    });
    if (response.ok) decision = ((await response.json()) as { decision?: string }).decision ?? "approved";
  } catch {
    return; // The core cannot be reached: the sandbox is still there.
  }
  if (decision === "rejected") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "The user refused this. Do not try it another way; say what you wanted to do and stop." },
      }) + "\n",
    );
  }
}
