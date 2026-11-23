import type { Agent, Approval, Message, Task, Workspace } from "@losperitos/protocol";
import type { Actions, State } from "./store";
import type { Updates } from "./updates";

export type Route =
  | { screen: "bench" | "files" | "code" | "docs" | "mail" | "archive" | "ledger" | "settings" | "setup" }
  | { screen: "file"; id: string }
  | { screen: "perito"; id: string }
  /** `id` selects one seal or question. */
  | { screen: "awaiting"; id?: string };

/** What every screen receives: live data for the open bureau, and how to act. */
export interface Ctx {
  state: State;
  actions: Actions;
  bureau: Workspace;
  /** Agents, files and messages of the open bureau. */
  agents: Agent[];
  tasks: Task[];
  messages: Message[];
  approvals: Approval[];
  go(route: Route): void;
  /** Switch to another bureau. */
  openBureau(workspaceId: string): void;
  /** Show a short confirmation at the bottom of the window. */
  note(text: string): void;
  /** Seal requests the user put off with "Not now"; they stay pending. */
  deferred: ReadonlySet<string>;
  defer(approvalId: string): void;
  theme: "light" | "dark";
  setTheme(theme: "light" | "dark"): void;
  /** The plain view: fewer screens and controls, for someone new to the app. */
  /** Whether a newer release is out, and the switch for asking. */
  updates: Updates;
  simple: boolean;
  setSimple(simple: boolean): void;
}

export const pendingApprovals = (approvals: Approval[]) => approvals.filter((a) => a.status === "pending");
export const openQuestions = (messages: Message[]) =>
  messages.filter((m) => m.question && m.question.answer === null);
