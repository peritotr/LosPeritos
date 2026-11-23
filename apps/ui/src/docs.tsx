/**
 * What there is to read about a bureau, in one place: the notebook its team
 * keeps (plans, decisions, findings), the Markdown files of the project
 * folder, and the lessons the user has admitted.
 */
import { useEffect, useState } from "react";
import { BookOpen, FileText, GraduationCap, NotebookPen, Trash2 } from "lucide-react";
import type { Page, TaskFile } from "@losperitos/protocol";
import type { Ctx } from "./context";
import { Markdown } from "./preview";
import { T } from "./strings";
import { Corners, Empty, I, PageHead, ago, perito } from "./ui";

type Chosen = { kind: "page"; id: string } | { kind: "file"; path: string } | { kind: "lessons" };

const decode = (file: TaskFile) => new TextDecoder().decode(Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0)));

export function Docs(ctx: Ctx) {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [file, setFile] = useState<TaskFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const lessons = ctx.state.lessons.filter((lesson) => lesson.workspaceId === ctx.bureau.id && lesson.status === "accepted");
  // The team writes pages as it talks: look again when the conversation moves on.
  const heard = ctx.messages.length;

  useEffect(() => {
    let current = true;
    ctx.actions.pages(ctx.bureau.id).then(
      (list) => current && setPages(list),
      (err: Error) => current && setError(err.message),
    );
    ctx.actions.docs(ctx.bureau.id).then(
      (list) => current && setFiles(list),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id, heard]);
  useEffect(() => setChosen(null), [ctx.bureau.id]);

  const path = chosen?.kind === "file" ? chosen.path : null;
  useEffect(() => {
    setFile(null);
    if (!path) return;
    let current = true;
    ctx.actions.repoFile(ctx.bureau.id, path).then(
      (loaded) => current && setFile(loaded),
      (err: Error) => current && setError(err.message),
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id, path]);

  // With nothing chosen, open the newest page, or else the first file.
  const shown: Chosen | null =
    chosen ?? (pages?.[0] ? { kind: "page", id: pages[0].id } : files[0] ? { kind: "file", path: files[0] } : lessons.length ? { kind: "lessons" } : null);
  const page = shown?.kind === "page" ? pages?.find((item) => item.id === shown.id) : undefined;
  useEffect(() => {
    if (!chosen && shown?.kind === "file") setChosen(shown);
  }, [chosen, shown?.kind]);
  const author = page ? ctx.agents.find((agent) => agent.id === page.authorAgentId) : undefined;

  const remove = () => {
    if (!page) return;
    if (!removing) return setRemoving(true);
    setRemoving(false);
    ctx.actions.removePage(page.id).then(
      (list) => (setPages(list), setChosen(null), ctx.note(T.docs.removed)),
      (err: Error) => setError(err.message),
    );
  };

  const head = <PageHead kicker={T.docs.kicker(ctx.bureau.name)} title={T.docs.title} />;
  if (pages && pages.length === 0 && files.length === 0 && lessons.length === 0) {
    return (
      <>
        {head}
        <Empty icon={BookOpen} title={T.docs.emptyTitle}>
          {T.docs.emptyBody}
        </Empty>
      </>
    );
  }
  return (
    <>
      {head}
      {error && <p className="err">{error}</p>}
      <div className="code">
        <div className="code-side">
          <section className="panel blueprint">
            <Corners />
            <h5>
              <I icon={NotebookPen} size={14} /> {T.docs.notebook}
            </h5>
            {pages?.length === 0 && <p className="muted">{T.docs.noPages}</p>}
            {pages?.map((item) => (
              <button
                key={item.id}
                className="code-row code-commit"
                aria-pressed={shown?.kind === "page" && shown.id === item.id}
                onClick={() => (setRemoving(false), setChosen({ kind: "page", id: item.id }))}
              >
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="ellipsis" style={{ display: "block" }}>
                    {item.title}
                  </span>
                  <span className="muted mono">{ago(item.updatedAt)}</span>
                </span>
              </button>
            ))}
          </section>

          {files.length > 0 && (
            <section className="panel blueprint">
              <Corners />
              <h5>
                <I icon={FileText} size={14} /> {T.docs.project}
              </h5>
              <div className="code-tree">
                {files.map((name) => (
                  <button key={name} className="code-row" aria-pressed={path === name} onClick={() => setChosen({ kind: "file", path: name })}>
                    <span className="mono ellipsis">{name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="panel blueprint">
            <Corners />
            <button className="code-row" aria-pressed={shown?.kind === "lessons"} onClick={() => setChosen({ kind: "lessons" })}>
              <I icon={GraduationCap} size={14} />
              <strong className="grow">{T.docs.lessons}</strong>
              <span className="count">{lessons.length}</span>
            </button>
          </section>
        </div>

        <div className="code-main">
          {page ? (
            <figure className="preview blueprint">
              <Corners />
              <header>
                <span className="grow ellipsis">
                  <strong>{page.title}</strong>
                  <span className="muted">
                    {" "}
                    · {author ? perito(author, ctx.agents).who : T.mail.bureau} · {ago(page.updatedAt)}
                  </span>
                </span>
                <button className={`btn ${removing ? "btn-secondary" : "btn-ghost"}`} aria-label={T.docs.remove} onClick={remove} onBlur={() => setRemoving(false)}>
                  <I icon={Trash2} size={14} />
                  {removing && T.docs.removeSure}
                </button>
              </header>
              <div className="preview-body docs-body">
                <Markdown source={page.body} />
              </div>
            </figure>
          ) : shown?.kind === "file" ? (
            <figure className="preview blueprint">
              <Corners />
              <header>
                <span className="mono grow ellipsis">{shown.path}</span>
              </header>
              <div className="preview-body docs-body">{file ? <Markdown source={decode(file)} /> : <p className="muted">{T.files.loading}</p>}</div>
            </figure>
          ) : shown?.kind === "lessons" ? (
            <figure className="preview blueprint">
              <Corners />
              <header>
                <strong className="grow">{T.docs.lessons}</strong>
                <button className="btn btn-ghost" onClick={() => ctx.go({ screen: "archive" })}>
                  {T.docs.toArchive}
                </button>
              </header>
              <div className="preview-body docs-body">
                {lessons.length === 0 ? (
                  <p className="muted">{T.docs.noLessons}</p>
                ) : (
                  <ul>
                    {lessons.map((lesson) => (
                      <li key={lesson.id}>{lesson.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            </figure>
          ) : (
            <p className="muted">{T.files.loading}</p>
          )}
        </div>
      </div>
    </>
  );
}
