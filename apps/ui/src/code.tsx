/**
 * The code panel of a software bureau: where its repository stands. Branch,
 * recent commits, the branches the team works on, and what is not yet committed.
 * It reads; it does not commit, switch or merge. Those stay with the seal.
 */
import { useEffect, useMemo, useState } from "react";
import { GitBranch, GitCommitHorizontal, RefreshCw } from "lucide-react";
import type { RepoState } from "@losperitos/protocol";
import type { Ctx } from "./context";
import { DiffView } from "./screens-work";
import { T } from "./strings";
import { Corners, Empty, I, PageHead, ago } from "./ui";

/** What is shown on the right: the uncommitted changes, or one commit. */
type Chosen = { kind: "working" } | { kind: "commit"; hash: string };

export function Code(ctx: Ctx) {
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
    ctx.actions.repo(ctx.bureau.id).then(
      (state) => current && setRepo(state),
      (err: Error) => current && (setRepo(null), setError(err.message)),
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id, tick, closed]);

  const commit = chosen.kind === "commit" ? chosen.hash : null;
  useEffect(() => {
    let current = true;
    setDiff(null);
    setDiffError(null);
    ctx.actions.repoDiff(ctx.bureau.id, commit).then(
      (text) => current && setDiff(text),
      (err: Error) => current && setDiffError(err.message),
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id, commit, tick, closed]);

  const head = (
    <PageHead kicker={T.code.kicker(ctx.bureau.name)} title={T.code.title}>
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
          <h5 className="ellipsis">{picked ? `${picked.hash.slice(0, 7)} — ${picked.subject}` : T.code.working}</h5>
          {diffError ? (
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
