import type { Agent, Approval, Message, Task, Workspace } from "@losperitos/protocol";
import type { Actions, State } from "./store";

export type Route =
  | { screen: "bench" | "files" | "mail" | "archive" | "ledger" | "settings" | "setup" }
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
  /** Show a short confirmation at the bottom of the window. */
  note(text: string): void;
  /** Seal requests the user put off with "Not now"; they stay pending. */
  deferred: ReadonlySet<string>;
  defer(approvalId: string): void;
  theme: "light" | "dark";
  setTheme(theme: "light" | "dark"): void;
}

export const pendingApprovals = (approvals: Approval[]) => approvals.filter((a) => a.status === "pending");
export const openQuestions = (messages: Message[]) =>
  messages.filter((m) => m.question && m.question.answer === null);
