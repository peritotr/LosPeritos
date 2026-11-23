/**
 * The code panel of a software bureau: where its repository stands. Branch,
 * recent commits, the branches the team works on, and what is not yet committed.
 * It reads; it does not commit, switch or merge. Those stay with the seal.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, GitBranch, GitCommitHorizontal, RefreshCw, Search } from "lucide-react";
import type { RepoState, TaskFile } from "@losperitos/protocol";
import { FileBody } from "./preview";
import type { Ctx } from "./context";
import { DiffView } from "./screens-work";
import { T } from "./strings";
import { Corners, Empty, I, PageHead, ago } from "./ui";

/** What is shown on the right: the uncommitted changes, or one commit. */
type Chosen = { kind: "working" } | { kind: "commit"; hash: string } | { kind: "file"; path: string; line?: number };

/** Folders and files of one level of the tree, folders first. */
function level(files: string[], under: string): { folders: string[]; here: string[] } {
  const folders = new Set<string>();
  const here: string[] = [];
  for (const file of files) {
    if (!file.startsWith(under)) continue;
    const rest = file.slice(under.length);
    const cut = rest.indexOf("/");
    if (cut === -1) here.push(file);
    else folders.add(under + rest.slice(0, cut + 1));
  }
  return { folders: [...folders].sort(), here };
}

function Tree({ files, under, open, toggle, pick, chosen }: {
  files: string[];
  under: string;
  open: ReadonlySet<string>;
  toggle(folder: string): void;
  pick(path: string): void;
  chosen: string | null;
}) {
  const { folders, here } = level(files, under);
  const depth = under.split("/").length - 1;
  const pad = { paddingLeft: 8 + depth * 14 };
  return (
    <>
      {folders.map((folder) => (
        <div key={folder}>
          <button className="code-row" style={pad} aria-expanded={open.has(folder)} onClick={() => toggle(folder)}>
            <I icon={open.has(folder) ? ChevronDown : ChevronRight} size={12} />
            <I icon={Folder} size={14} />
            <span className="mono ellipsis">{folder.slice(under.length, -1)}</span>
          </button>
          {open.has(folder) && <Tree files={files} under={folder} open={open} toggle={toggle} pick={pick} chosen={chosen} />}
        </div>
      ))}
      {here.map((file) => (
        <button key={file} className="code-row" style={{ paddingLeft: pad.paddingLeft + 16 }} aria-pressed={chosen === file} onClick={() => pick(file)}>
          <I icon={FileText} size={14} />
          <span className="mono ellipsis">{file.slice(under.length)}</span>
        </button>
      ))}
    </>
  );
}

/** The project's files: a tree to walk, a box that narrows it by name, and a search inside the files. */
function Files({ ctx, repo, chosen, pick, tick }: { ctx: Ctx; repo: string | null; chosen: string | null; pick(path: string, line?: number): void; tick: number }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [words, setWords] = useState("");
  const [hits, setHits] = useState<Array<{ path: string; line: number; text: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setHits(null);
    ctx.actions.repoFiles(ctx.bureau.id, repo).then(
      (list) => current && (setFiles(list.files), setMore(list.more)),
      (err: Error) => current && setError(err.message),
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id, repo, tick]);
  const toggle = (folder: string) => {
    const next = new Set(open);
    if (!next.delete(folder)) next.add(folder);
    setOpen(next);
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (words.trim().length < 2) return setHits(null);
    ctx.actions.repoSearch(ctx.bureau.id, words, repo).then(setHits, (err: Error) => setError(err.message));
  };
  const named = words.trim() ? (files ?? []).filter((file) => file.toLowerCase().includes(words.trim().toLowerCase())).slice(0, 60) : null;
  return (
    <section className="panel blueprint">
      <Corners />
      <h5>{T.code.files}</h5>
      <form className="row" onSubmit={search}>
        <input
          className="input grow"
          value={words}
          onChange={(event) => (setWords(event.target.value), setHits(null))}
          placeholder={T.code.searchPlaceholder}
          aria-label={T.code.searchPlaceholder}
        />
        <button className="btn btn-secondary" disabled={words.trim().length < 2} title={T.code.searchInside}>
          <I icon={Search} size={14} />
        </button>
      </form>
      {error && <p className="err">{error}</p>}
      <div className="code-tree">
        {hits ? (
          <>
            <p className="muted">{T.code.hits(hits.length)}</p>
            {hits.map((hit, index) => (
              <button key={index} className="code-row code-commit" onClick={() => pick(hit.path, hit.line)}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="mono muted ellipsis" style={{ display: "block" }}>
                    {hit.path}:{hit.line}
                  </span>
                  <span className="mono ellipsis" style={{ display: "block" }}>
                    {hit.text.trim()}
                  </span>
                </span>
              </button>
            ))}
          </>
        ) : named ? (
          <>
            {named.map((file) => (
              <button key={file} className="code-row" aria-pressed={chosen === file} onClick={() => pick(file)}>
                <I icon={FileText} size={14} />
                <span className="mono ellipsis">{file}</span>
              </button>
            ))}
            <p className="muted">{named.length === 0 ? T.code.noName : T.code.enterToSearch}</p>
          </>
        ) : files ? (
          <Tree files={files} under="" open={open} toggle={toggle} pick={pick} chosen={chosen} />
        ) : (
          <p className="muted">{T.code.loading}</p>
        )}
        {more && !hits && <p className="muted">{T.code.treeCut}</p>}
      </div>
    </section>
  );
}

/** One file of the project, read-only; a line found by the search is marked. */
function FileView({ ctx, repo, path, line }: { ctx: Ctx; repo: string | null; path: string; line?: number }) {
  const [file, setFile] = useState<TaskFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setFile(null);
    setError(null);
    ctx.actions.repoFile(ctx.bureau.id, path, repo).then(
      (loaded) => current && setFile(loaded),
      (err: Error) => current && setError(err.message),
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id, repo, path]);
  useEffect(() => {
    if (file && line) document.querySelector(".code-text .hit")?.scrollIntoView({ block: "center" });
  }, [file, line]);
  if (error) return <p className="err">{error}</p>;
  if (!file) return <p className="muted">{T.code.loading}</p>;
  if (file.mime !== "text/plain" && file.mime !== "application/json") {
    return (
      <figure className="preview blueprint">
        <Corners />
        <div className="preview-body">
          <FileBody file={file} />
        </div>
      </figure>
    );
  }
  const lines = new TextDecoder().decode(Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))).split("\n");
  return (
    <figure className="diff-file blueprint">
      <Corners />
      <div className="diff-lines code-text">
        {lines.map((text, index) => (
          <div key={index} className={`diff-line ${index + 1 === line ? "add hit" : ""}`}>
            <span>{index + 1}</span>
            <span />
            <span>{text}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Code(ctx: Ctx) {
  // A folder that holds several repositories shows one at a time.
  const names = ctx.bureau.repos.map((item) => item.path).filter((name) => name !== ".");
  const [named, setNamed] = useState<string | null>(null);
  const which = names.length ? (named && names.includes(named) ? named : names[0]!) : null;
  const [repo, setRepo] = useState<RepoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen>({ kind: "working" });
  const [diff, setDiff] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // A file closing usually means a merge: look again.
  const closed = useMemo(() => ctx.tasks.filter((task) => task.status === "done").length, [ctx.tasks]);

  useEffect(() => {
    let current = true;
    setError(null);
    ctx.actions.repo(ctx.bureau.id, which).then(
      (state) => current && setRepo(state),
      (err: Error) => current && (setRepo(null), setError(err.message)),
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id, which, tick, closed]);

  const commit = chosen.kind === "commit" ? chosen.hash : null;
  useEffect(() => {
    if (chosen.kind === "file") return;
    let current = true;
    setDiff(null);
    setDiffError(null);
    ctx.actions.repoDiff(ctx.bureau.id, commit, which).then(
      (text) => current && setDiff(text),
      (err: Error) => current && setDiffError(err.message),
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id, which, commit, chosen.kind, tick, closed]);

  const head = (
    <PageHead kicker={T.code.kicker(ctx.bureau.name)} title={T.code.title}>
      {names.length > 1 && (
        <select
          className="input"
          style={{ width: "auto" }}
          value={which ?? ""}
          aria-label={T.code.repo}
          onChange={(event) => (setNamed(event.target.value), setChosen({ kind: "working" }))}
        >
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      {repo && (
        <span className="tag">
          <I icon={GitBranch} size={12} /> {repo.branch}
        </span>
      )}
      <button className="btn btn-secondary" onClick={() => setTick(tick + 1)}>
        <I icon={RefreshCw} size={14} />
        {T.code.refresh}
      </button>
    </PageHead>
  );
  if (error) {
    return (
      <>
        {head}
        <Empty icon={GitBranch} title={T.code.noRepo}>
          {T.code.noRepoBody}
        </Empty>
      </>
    );
  }
  if (!repo) {
    return (
      <>
        {head}
        <p className="muted">{T.code.loading}</p>
      </>
    );
  }
  const others = repo.branches.filter((branch) => branch.name !== repo.branch);
  const picked = repo.commits.find((item) => item.hash === commit);
  return (
    <>
      {head}
      <div className="code">
        <div className="code-side">
          <section className="panel blueprint">
            <Corners />
            <button className="code-row" aria-pressed={chosen.kind === "working"} onClick={() => setChosen({ kind: "working" })}>
              <strong className="grow">{T.code.working}</strong>
              <span className="count">{repo.changes.length}</span>
            </button>
            {repo.changes.slice(0, 40).map((file) => (
              <div key={file.path} className="code-file mono">
                <span className="code-status">{file.status.trim() || "·"}</span>
                <span className="ellipsis">{file.path}</span>
              </div>
            ))}
            {repo.changes.length > 40 && <p className="muted">{T.code.more(repo.changes.length - 40)}</p>}
            {repo.changes.length === 0 && <p className="muted">{T.code.clean}</p>}
          </section>

          {others.length > 0 && (
            <section className="panel blueprint">
              <Corners />
              <h5>{T.code.branches}</h5>
              {others.map((branch) => {
                const task = ctx.tasks.find((item) => item.id === branch.taskId);
                return (
                  <button
                    key={branch.name}
                    className="code-row"
                    disabled={!task}
                    title={task?.title}
                    onClick={() => task && ctx.go({ screen: "file", id: task.id })}
                  >
                    <I icon={GitBranch} size={14} />
                    <span className="mono grow ellipsis">{branch.name}</span>
                    <span className="muted">{T.code.ahead(branch.ahead)}</span>
                  </button>
                );
              })}
            </section>
          )}

          <Files
            ctx={ctx}
            repo={which}
            tick={tick + closed}
            chosen={chosen.kind === "file" ? chosen.path : null}
            pick={(path, line) => setChosen({ kind: "file", path, line })}
          />

          <section className="panel blueprint">
            <Corners />
            <h5>{T.code.commits}</h5>
            {repo.commits.map((item) => (
              <button
                key={item.hash}
                className="code-row code-commit"
                aria-pressed={commit === item.hash}
                onClick={() => setChosen({ kind: "commit", hash: item.hash })}
              >
                <I icon={GitCommitHorizontal} size={14} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="ellipsis" style={{ display: "block" }}>
                    {item.subject}
                  </span>
                  <span className="muted mono">
                    {item.hash.slice(0, 7)} · {item.author} · {ago(item.date)}
                  </span>
                </span>
              </button>
            ))}
          </section>
        </div>

        <div className="code-main">
          <h5 className="ellipsis mono">
            {chosen.kind === "file" ? chosen.path : picked ? `${picked.hash.slice(0, 7)} — ${picked.subject}` : T.code.working}
          </h5>
          {chosen.kind === "file" ? (
            <FileView ctx={ctx} repo={which} path={chosen.path} line={chosen.line} />
          ) : diffError ? (
            <p className="err">{diffError}</p>
          ) : diff === null ? (
            <p className="muted">{T.code.loading}</p>
          ) : (
            <DiffView diff={diff} empty={picked ? T.code.emptyCommit : repo.changes.length ? T.code.untrackedOnly : T.code.clean} />
          )}
        </div>
      </div>
    </>
  );
}
