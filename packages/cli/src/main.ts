#!/usr/bin/env node
/**
 * `peritos` — how an agent talks to the LosPeritos core.
 * The core starts each agent with LOSPERITOS_URL and LOSPERITOS_AGENT_TOKEN set.
 */
import { parseArgs } from "node:util";
import type { AgentCommandInput } from "@losperitos/protocol";
import { runPermissionBridge } from "./mcp.js";

const USAGE = `Usage:
  peritos task create --title <t> [--description <d>] [--specialty <s>]   (lead)
  peritos task list
  peritos task done --done <text>... [--tested <text>...] [--not-verified <text>...]
  peritos send --to <agent name|lead|user> <message>
  peritos ask <question> [--option <o>...] [--recommend <o>]
  peritos approval --title <t> [--kind deploy|command|other] [--detail <d>] [--step <s>...] [--irreversible]
  peritos lesson <text>`;

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
      done: { type: "string", multiple: true },
      tested: { type: "string", multiple: true },
      "not-verified": { type: "string", multiple: true },
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
    default:
      fail(USAGE);
  }
}

const url = process.env.LOSPERITOS_URL;
const token = process.env.LOSPERITOS_AGENT_TOKEN;
if (!url || !token) fail("peritos only works inside an agent started by LosPeritos.");

if (process.argv[2] === "mcp") {
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
