/**
 * The files that go with a message, shown where the message is: pictures as
 * pictures (a click enlarges one), anything else as a name to save.
 */
import { useEffect, useState } from "react";
import { Download, Paperclip, X } from "lucide-react";
import type { Ctx } from "./context";
import { T } from "./strings";
import { I } from "./ui";

const label = (name: string) => name.replace(/^[0-9a-f]{8}-/, "").replace(/^.*\//, "");
const isPicture = (name: string) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name);

/** An address for an attachment's bytes, for as long as the component shows it. */
function useBytes(ctx: Ctx, workspaceId: string, name: string, wanted: boolean, project = false): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    let made: string | null = null;
    const bytes = project
      ? ctx.actions.repoFile(workspaceId, name).then((file) => new Blob([Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))], { type: file.mime }))
      : ctx.actions.attachment(workspaceId, name);
    bytes.then(
      (blob) => {
        if (!current) return;
        // A drawing is sent as plain bytes; as a picture it only draws, it cannot run anything.
        const shown = /\.svg$/i.test(name) ? new Blob([blob], { type: "image/svg+xml" }) : blob;
        setUrl((made = URL.createObjectURL(shown)));
      },
      () => undefined,
    );
    return () => {
      current = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [workspaceId, name, wanted]);
  return url;
}

function Picture({ ctx, workspaceId, name, onOpen, project = false }: { ctx: Ctx; workspaceId: string; name: string; onOpen(url: string): void; project?: boolean }) {
  const url = useBytes(ctx, workspaceId, name, true, project);
  return (
    <button className="shown-picture" title={label(name)} disabled={!url} onClick={(event) => (event.stopPropagation(), url && onOpen(url))}>
      {url ? <img src={url} alt={label(name)} /> : <span className="muted">{T.files.loading}</span>}
      <span className="shown-name ellipsis">{label(name)}</span>
    </button>
  );
}

function Other({ ctx, workspaceId, name }: { ctx: Ctx; workspaceId: string; name: string }) {
  const [asked, setAsked] = useState(false);
  const url = useBytes(ctx, workspaceId, name, asked);
  return url ? (
    <a className="file-chip" href={url} download={label(name)} onClick={(event) => event.stopPropagation()}>
      <I icon={Download} size={12} />
      {label(name)}
    </a>
  ) : (
    <button className="file-chip" onClick={(event) => (event.stopPropagation(), setAsked(true))}>
      <I icon={Paperclip} size={12} />
      {label(name)}
    </button>
  );
}

/**
 * Pictures a question talks about without attaching them ("they are in
 * gorseller/logo/"): found in the bureau's folder and shown as if attached.
 */
export function MentionedPictures({ ctx, message }: { ctx: Ctx; message: { id: string; workspaceId: string; attachments?: string[] } }) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    setFiles([]);
    if (message.attachments?.length) return;
    let current = true;
    ctx.actions.messagePictures(message.id).then((found) => current && setFiles(found), () => undefined);
    return () => {
      current = false;
    };
  }, [message.id]);
  return files.length ? <Attachments ctx={ctx} workspaceId={message.workspaceId} names={files} project /> : null;
}

export function Attachments({ ctx, workspaceId, names, project = false }: { ctx: Ctx; workspaceId: string; names: string[]; project?: boolean }) {
  const [large, setLarge] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => {
    if (!large) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setLarge(null);
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [large]);
  const pictures = names.filter(isPicture);
  const others = names.filter((name) => !isPicture(name));
  return (
    <>
      {pictures.length > 0 && (
        <div className="shown-pictures">
          {pictures.map((name) => (
            <Picture key={name} ctx={ctx} workspaceId={workspaceId} name={name} project={project} onOpen={(url) => setLarge({ url, name })} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="msg-files">
          {others.map((name) => (
            <Other key={name} ctx={ctx} workspaceId={workspaceId} name={name} />
          ))}
        </div>
      )}
      {large && (
        <div className="shown-large" role="dialog" aria-label={label(large.name)} onClick={(event) => (event.stopPropagation(), setLarge(null))}>
          <img src={large.url} alt={label(large.name)} />
          <div className="shown-large-bar">
            <span className="mono">{label(large.name)}</span>
            <button className="btn btn-secondary" aria-label={T.files.closePreview}>
              <I icon={X} size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
