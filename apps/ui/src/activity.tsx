/**
 * An agent's live output: what it says as plain lines, and each tool it uses
 * (a command, a file read or changed) as a block that opens to show the detail.
 */
import { useEffect, useRef } from "react";
import { Check, ChevronRight, FilePen, FileText, Globe, LoaderCircle, Search, Terminal, Wrench, X, type LucideIcon } from "lucide-react";
import type { Activity, ToolActivity } from "./store";
import { T } from "./strings";
import { I } from "./ui";

const ICON: Record<string, LucideIcon> = {
  Bash: Terminal, Read: FileText, Write: FilePen, Edit: FilePen, MultiEdit: FilePen, NotebookEdit: FilePen,
  Grep: Search, Glob: Search, WebFetch: Globe, WebSearch: Globe,
};

const str = (value: unknown) => (typeof value === "string" ? value : "");
/** The last two segments are enough to recognise a file. */
const shortPath = (path: string) => path.split("/").slice(-2).join("/");

/** One line that says what the call is about. */
function subject(tool: ToolActivity): string {
  const input = tool.input;
  if (tool.name === "Bash") return str(input.command).split("\n")[0]!;
  const path = str(input.file_path) || str(input.notebook_path) || str(input.path);
  if (tool.name === "Grep" || tool.name === "Glob") return [str(input.pattern), path && shortPath(path)].filter(Boolean).join(" · ");
  if (path) return shortPath(path);
  const first = Object.values(input).find((value) => typeof value === "string");
  return str(first).split("\n")[0]!.slice(0, 120);
}

const MAX_LINES = 120;
function Lines({ text, kind }: { text: string; kind: "add" | "del" | "out" }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <>
      {lines.slice(0, MAX_LINES).map((line, index) => (
        <span key={index} className={`tl ${kind}`}>
          {(kind === "add" ? "+ " : kind === "del" ? "− " : "") + line + "\n"}
        </span>
      ))}
      {lines.length > MAX_LINES && <span className="tl out">{T.tools.more(lines.length - MAX_LINES) + "\n"}</span>}
    </>
  );
}

function Detail({ tool }: { tool: ToolActivity }) {
  const input = tool.input;
  const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [input];
  return (
    <pre className="tool-body">
      {tool.name === "Bash" ? (
        <span className="tl cmd">{"$ " + str(input.command) + "\n"}</span>
      ) : tool.name === "Edit" || tool.name === "MultiEdit" ? (
        edits.map((edit, index) => (
          <span key={index}>
            <Lines text={str(edit.old_string)} kind="del" />
            <Lines text={str(edit.new_string)} kind="add" />
          </span>
        ))
      ) : tool.name === "Write" ? (
        <Lines text={str(input.content)} kind="add" />
      ) : tool.name === "Read" ? null : (
        <span className="tl out">{JSON.stringify(input, null, 2) + "\n"}</span>
      )}
      {tool.result?.text && tool.name !== "Edit" && tool.name !== "Write" && <Lines text={tool.result.text} kind="out" />}
      {tool.result && !tool.result.ok && (tool.name === "Edit" || tool.name === "Write") && <Lines text={tool.result.text} kind="out" />}
    </pre>
  );
}

function Tool({ tool }: { tool: ToolActivity }) {
  const label = T.tools.names[tool.name as keyof typeof T.tools.names] ?? tool.name;
  const failed = tool.result?.ok === false;
  return (
    <details className={`tool ${failed ? "failed" : ""}`}>
      <summary>
        <I icon={ChevronRight} size={12} />
        <I icon={ICON[tool.name] ?? Wrench} size={13} />
        <span className="tool-name">{label}</span>
        <span className="tool-subject ellipsis grow">{subject(tool)}</span>
        <span className="tool-state" title={!tool.result ? T.tools.running : failed ? T.tools.failed : T.tools.done}>
          <I icon={!tool.result ? LoaderCircle : failed ? X : Check} size={13} />
        </span>
      </summary>
      <Detail tool={tool} />
    </details>
  );
}

export function TerminalOutput({ entries, fallback }: { entries: Activity[] | undefined; fallback: string | null }) {
  const end = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries?.length]);
  const shown: Activity[] = entries?.length ? entries : fallback ? [{ kind: "line", text: fallback }] : [];
  return (
    <div className="term-out">
      {shown.length === 0 && <span className="out">{T.bench.noOutput}</span>}
      {shown.map((entry, index) =>
        entry.kind === "tool" ? (
          <Tool key={entry.id} tool={entry} />
        ) : (
          <span key={index} className={/^(>|■)/.test(entry.text) ? "cmd" : /error|failed/i.test(entry.text) ? "bad" : "out"}>
            {entry.text + "\n"}
          </span>
        ),
      )}
      <span ref={end} />
    </div>
  );
}
