/**
 * The bureau's folder, whole: everything the team made is here whether or not
 * a dossier listed it. The newest files come first, the rest is a tree; a
 * file opens beside it, and a folder shows the pictures it holds.
 */
import { useEffect, useMemo, useState } from "react";
import { Clock, FolderOpen, FolderSearch, FolderTree, RefreshCw } from "lucide-react";
import type { TaskFile } from "@losperitos/protocol";
import { Attachments } from "./attachments";
import { Tree } from "./code";
import type { Ctx } from "./context";
import { tidy, useFolder } from "./paths";
import { FileBody } from "./preview";
import { shell } from "./store";
import { T } from "./strings";
import { Corners, Empty, I, PageHead, ago } from "./ui";

const isPicture = (path: string) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path);
const mediaKind = (path: string): "video" | "audio" | "pdf" | null =>
  /\.(mp4|m4v|webm|mov)$/i.test(path) ? "video" : /\.(mp3|m4a|wav|ogg)$/i.test(path) ? "audio" : /\.pdf$/i.test(path) ? "pdf" : null;
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function File({ ctx, path }: { ctx: Ctx; path: string }) {
  const [file, setFile] = useState<TaskFile | null>(null);
  const [media, setMedia] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = mediaKind(path);
  useEffect(() => {
    setFile(null);
    setMedia(null);
    setError(null);
    let current = true;
    let made: string | null = null;
    if (kind) {
      ctx.actions.folderRaw(ctx.bureau.id, path).then(
        (blob) => current && setMedia((made = URL.createObjectURL(blob))),
        (err: Error) => current && setError(err.message),
      );
    } else {
      ctx.actions.repoFile(ctx.bureau.id, path).then(
        (loaded) => current && setFile(loaded),
        (err: Error) => current && setError(err.message),
      );
    }
    return () => {
      current = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [ctx.bureau.id, path]);
  if (error) return <p className="err">{error}</p>;
  if (kind && media) {
    if (kind === "video") return <video className="preview-video" src={media} controls preload="metadata" />;
    if (kind === "audio") return <audio className="preview-audio" src={media} controls preload="metadata" />;
    return <iframe className="preview-pdf" src={media} title={path} />;
  }
  return file ? <FileBody file={file} /> : <p className="muted">{T.files.loading}</p>;
}

export function FolderScreen({ ctx, path: asked }: { ctx: Ctx; path?: string }) {
  const folder = useFolder();
  const files = folder.files;
  const [chosen, setChosen] = useState<string | null>(asked ? tidy(asked) : null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!asked) return;
    const path = tidy(asked);
    setChosen(path);
    // Open the way down to it.
    const parts = path.split("/");
    setOpen((before) => new Set([...before, ...parts.map((_, index) => parts.slice(0, index + 1).join("/") + "/")]));
  }, [asked]);
  useEffect(() => setChosen(asked ? tidy(asked) : null), [ctx.bureau.id]);

  const recent = useMemo(() => [...files].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 10), [files]);
  const names = useMemo(() => files.map((file) => file.path), [files]);
  const shown = chosen ?? recent[0]?.path ?? null;
  const kind = shown ? folder.kind(shown) : null;
  const inside = kind === "dir" ? files.filter((file) => file.path.startsWith(shown + "/")) : [];
  const pictures = inside.filter((file) => isPicture(file.path) && !file.path.slice(shown!.length + 1).includes("/")).map((file) => file.path);
  const reveal = (path: string) => shell?.reveal?.(`${ctx.bureau.path}/${path}`);

  const head = (
    <PageHead kicker={T.folder.kicker(ctx.bureau.name)} title={T.folder.title}>
      <button className="btn btn-ghost" onClick={folder.reload} aria-label={T.code.refresh} title={T.code.refresh}>
        <I icon={RefreshCw} size={14} />
      </button>
      {shell?.reveal && (
        <button className="btn btn-secondary" onClick={() => void shell?.reveal?.(ctx.bureau.path)}>
          <I icon={FolderSearch} size={14} /> {T.folder.reveal}
        </button>
      )}
    </PageHead>
  );
  if (files.length === 0) {
    return (
      <>
        {head}
        <Empty icon={FolderOpen} title={T.folder.emptyTitle}>
          {T.folder.emptyBody}
        </Empty>
      </>
    );
  }
  return (
    <>
      {head}
      <p className="muted mono" style={{ fontSize: 12, marginTop: -6 }}>
        {ctx.bureau.path}
      </p>
      <div className="code">
        <div className="code-side">
          <section className="panel blueprint">
            <Corners />
            <h5>
              <I icon={Clock} size={14} /> {T.folder.recent}
            </h5>
            {recent.map((file) => (
              <button key={file.path} className="code-row code-commit" aria-pressed={shown === file.path} onClick={() => setChosen(file.path)}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="mono ellipsis" style={{ display: "block" }}>
                    {file.path}
                  </span>
                  <span className="muted mono">
                    {ago(file.modifiedAt)} · {size(file.size)}
                  </span>
                </span>
              </button>
            ))}
          </section>
          <section className="panel blueprint">
            <Corners />
            <h5>
              <I icon={FolderTree} size={14} /> {T.folder.all(files.length)}
            </h5>
            <div className="code-tree" style={{ maxHeight: "none" }}>
              <Tree
                files={names}
                under=""
                open={open}
                chosen={shown}
                pick={setChosen}
                toggle={(dir) => {
                  setOpen((before) => {
                    const next = new Set(before);
                    if (next.has(dir)) next.delete(dir);
                    else next.add(dir);
                    return next;
                  });
                  // A folder is also something to look at: its pictures.
                  setChosen(dir.replace(/\/$/, ""));
                }}
              />
            </div>
          </section>
        </div>
        <div className="code-main">
          {shown && (
            <figure className="preview blueprint">
              <Corners />
              <header>
                <span className="mono grow ellipsis">{shown}{kind === "dir" ? "/" : ""}</span>
                {shell?.reveal && (
                  <button className="btn btn-ghost" onClick={() => reveal(shown)} title={T.folder.revealFile}>
                    <I icon={FolderSearch} size={14} /> {T.folder.revealFile}
                  </button>
                )}
              </header>
              <div className="preview-body docs-body">
                {kind === "dir" ? (
                  <>
                    {pictures.length > 0 && <Attachments ctx={ctx} workspaceId={ctx.bureau.id} names={pictures.slice(0, 48)} project />}
                    <ul className="folder-list">
                      {inside
                        .filter((file) => !pictures.includes(file.path))
                        .slice(0, 200)
                        .map((file) => (
                          <li key={file.path}>
                            <button className="path-link" onClick={() => setChosen(file.path)}>
                              <code>{file.path.slice(shown.length + 1)}</code>
                            </button>
                            <span className="muted mono"> · {size(file.size)}</span>
                          </li>
                        ))}
                    </ul>
                  </>
                ) : kind === "file" ? (
                  <File ctx={ctx} path={shown} />
                ) : (
                  <p className="muted">{T.folder.gone}</p>
                )}
              </div>
            </figure>
          )}
        </div>
      </div>
    </>
  );
}
