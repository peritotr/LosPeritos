/**
 * The files a task handed in, and a look inside them. Marketing and content
 * bureaus are read here rather than in a diff: their work is documents.
 */
import { useEffect, useState, type ReactNode } from "react";
import { FileText, Film, Image as ImageIcon, Music, Table, X } from "lucide-react";
import type { Task, TaskFile } from "@losperitos/protocol";
import type { Ctx } from "./context";
import { T } from "./strings";
import { Corners, I } from "./ui";

const text = (file: TaskFile) =>
  new TextDecoder().decode(Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0)));

/** Bold, italic, code and links inside one line. Links are shown, not followed. */
function inline(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match.index > last) out.push(line.slice(last, match.index));
    const key = match.index;
    if (match[1] !== undefined) out.push(<code key={key}>{match[1]}</code>);
    else if (match[2] !== undefined) out.push(<strong key={key}>{match[2]}</strong>);
    else if (match[3] !== undefined) out.push(<em key={key}>{match[3]}</em>);
    else out.push(<u key={key} title={match[5]}>{match[4]}</u>);
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

function DataTable({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <div className="preview-table">
      <table>
        <thead>
          <tr>{head?.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, index) => (
            <tr key={index}>{row.map((cell, at) => <td key={at}>{inline(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Enough Markdown for briefs, plans and copy: headings, lists, tables, quotes, code. */
/** `breaks` keeps single line breaks, as chat messages mean them. */
export function Markdown({ source, breaks = false }: { source: string; breaks?: boolean }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  const isList = (line: string) => /^\s*([-*+]|\d+[.)])\s+/.test(line);
  for (let at = 0; at < lines.length; ) {
    const line = lines[at]!;
    const key = at;
    if (!line.trim()) {
      at++;
    } else if (line.startsWith("```")) {
      const code: string[] = [];
      for (at++; at < lines.length && !lines[at]!.startsWith("```"); at++) code.push(lines[at]!);
      at++;
      blocks.push(<pre key={key}>{code.join("\n")}</pre>);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const Tag = (["h3", "h4", "h5", "h6", "h6", "h6"] as const)[level - 1]!;
      blocks.push(<Tag key={key}>{inline(line.replace(/^#+\s+/, ""))}</Tag>);
      at++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      at++;
    } else if (line.includes("|") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[at + 1] ?? "")) {
      const rows = [cells(line)];
      for (at += 2; at < lines.length && lines[at]!.includes("|"); at++) rows.push(cells(lines[at]!));
      blocks.push(<DataTable key={key} rows={rows} />);
    } else if (isList(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      for (; at < lines.length && isList(lines[at]!); at++) items.push(lines[at]!.replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={key}>{items.map((item, index) => <li key={index}>{inline(item)}</li>)}</List>);
    } else if (line.startsWith(">")) {
      const quote: string[] = [];
      for (; at < lines.length && lines[at]!.startsWith(">"); at++) quote.push(lines[at]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key}>{inline(quote.join(" "))}</blockquote>);
    } else {
      const para: string[] = [];
      for (; at < lines.length && lines[at]!.trim() && !/^(#{1,6}\s|```|>)/.test(lines[at]!) && !isList(lines[at]!); at++) {
        para.push(lines[at]!);
      }
      blocks.push(<p key={key}>{inline(para.join(breaks ? "\n" : " "))}</p>);
    }
  }
  return <div className="markdown">{blocks}</div>;
}

/** Quoted fields may hold commas, quotes and line breaks. */
function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at]!;
    if (quoted) {
      if (char === '"' && source[at + 1] === '"') (field += '"'), at++;
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") (row.push(field), (field = ""));
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[at + 1] === "\n") at++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  return rows;
}

const MAX_ROWS = 200;

/** One file shown by its kind: a picture, a formatted page, a table, or plain text. */
export function FileBody({ file }: { file: TaskFile }) {
  if (file.mime.startsWith("image/")) {
    return <img className="preview-image" src={`data:${file.mime};base64,${file.data}`} alt={file.path} />;
  }
  if (file.mime === "text/markdown") return <Markdown source={text(file)} />;
  if (file.mime === "text/csv") {
    const rows = parseCsv(text(file));
    return (
      <>
        <DataTable rows={rows.slice(0, MAX_ROWS + 1)} />
        {rows.length > MAX_ROWS + 1 && <p className="muted">{T.files.moreRows(rows.length - 1 - MAX_ROWS)}</p>}
      </>
    );
  }
  if (file.mime.startsWith("text/") || file.mime === "application/json") return <pre>{text(file)}</pre>;
  return <p className="muted">{T.files.noPreview}</p>;
}

/** Files shown from their bytes rather than read as text. */
const mediaKind = (path: string): "video" | "audio" | "pdf" | null =>
  /\.(mp4|m4v|webm|mov)$/i.test(path) ? "video" : /\.(mp3|m4a|wav|ogg)$/i.test(path) ? "audio" : /\.pdf$/i.test(path) ? "pdf" : null;

const iconFor = (path: string) =>
  /\.(png|jpe?g|gif|webp|svg)$/i.test(path)
    ? ImageIcon
    : /\.csv$/i.test(path)
      ? Table
      : mediaKind(path) === "video"
        ? Film
        : mediaKind(path) === "audio"
          ? Music
          : FileText;

function Media({ kind, url, path }: { kind: "video" | "audio" | "pdf"; url: string; path: string }) {
  if (kind === "video") return <video className="preview-video" src={url} controls preload="metadata" />;
  if (kind === "audio") return <audio className="preview-audio" src={url} controls preload="metadata" />;
  return <iframe className="preview-pdf" src={url} title={path} />;
}

/**
 * The files a task handed in; choosing one opens it underneath. `wide` is the
 * document bureau's own column: the first file is open from the start.
 */
export function ReportFiles({ ctx, task, wide = false }: { ctx: Ctx; task: Task; wide?: boolean }) {
  const files = task.report?.files ?? [];
  const [chosen, setOpen] = useState<string | null>(null);
  const open = chosen && files.includes(chosen) ? chosen : wide ? (files[0] ?? null) : null;
  const [file, setFile] = useState<TaskFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** An address for the bytes of the open video, sound or PDF. */
  const [media, setMedia] = useState<string | null>(null);
  const kind = open ? mediaKind(open) : null;
  useEffect(() => {
    setFile(null);
    setError(null);
    setMedia(null);
    if (!open) return;
    let current = true;
    if (kind) {
      let made: string | null = null;
      ctx.actions.taskMedia(task.id, open).then(
        (blob) => current && setMedia((made = URL.createObjectURL(blob))),
        (err: Error) => current && setError(err.message),
      );
      return () => {
        current = false;
        if (made) URL.revokeObjectURL(made);
      };
    }
    ctx.actions.taskFile(task.id, open).then(
      (loaded) => current && setFile(loaded),
      (err: Error) => current && setError(err.message),
    );
    return () => {
      current = false;
    };
  }, [task.id, open, task.updatedAt]);
  if (files.length === 0) return wide ? <p className="muted">{T.files.noOutput}</p> : null;
  return (
    <section className={wide ? "output-wide" : undefined}>
      {!wide && (
        <h5>
          <I icon={FileText} size={14} />
          {T.files.output}
        </h5>
      )}
      <div className="output-files">
        {files.map((path) => (
          <button key={path} className="output-file mono" aria-pressed={open === path} onClick={() => setOpen(open === path && !wide ? null : path)}>
            <I icon={iconFor(path)} size={14} />
            <span className="ellipsis">{path}</span>
          </button>
        ))}
      </div>
      {open && (
        <figure className="preview blueprint">
          <Corners />
          <header>
            <span className="mono grow ellipsis">{open}</span>
            {!wide && (
              <button className="btn btn-ghost" aria-label={T.files.closePreview} onClick={() => setOpen(null)}>
                <I icon={X} size={14} />
              </button>
            )}
          </header>
          <div className="preview-body">
            {error ? (
              <p className="err">{error}</p>
            ) : kind && media ? (
              <Media kind={kind} url={media} path={open} />
            ) : file ? (
              <FileBody file={file} />
            ) : (
              <p className="muted">{T.files.loading}</p>
            )}
          </div>
        </figure>
      )}
    </section>
  );
}
