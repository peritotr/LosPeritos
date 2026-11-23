/**
 * A look at the site the bureau is building, inside the app: the address of a
 * running dev server in a frame, at the width of a desk, a tablet or a phone.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Crosshair, ExternalLink, Eye, MessageSquarePlus, Monitor, RefreshCw, Smartphone, Tablet } from "lucide-react";
import { shell } from "./store";
import type { Ctx } from "./context";
import { T } from "./strings";
import { Empty, I, PageHead, Segmented } from "./ui";

const key = (bureauId: string) => `losperitos.preview.${bureauId}`;
const WIDTHS = { desk: null, tablet: 768, phone: 390 } as const;
type Width = keyof typeof WIDTHS;

/** What was typed, as an address: `3000` and `localhost:3000` are both a local server. */
export function address(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  const full = /^\d{2,5}$/.test(text) ? `http://localhost:${text}` : /^[a-z]+:\/\//i.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(full);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function SitePreview({ ctx, url: asked }: { ctx: Ctx; url?: string }) {
  const remembered = () => {
    try {
      return localStorage.getItem(key(ctx.bureau.id));
    } catch {
      return null;
    }
  };
  const [url, setUrl] = useState<string | null>(asked ?? remembered());
  const [typed, setTyped] = useState(url ?? "");
  const [width, setWidth] = useState<Width>("desk");
  const [turn, setTurn] = useState(0);
  const [bad, setBad] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  /** While marking: the corner where the drag began and where it is now, in the stage's own pixels. */
  const [marking, setMarking] = useState(false);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const at = (event: { clientX: number; clientY: number }) => {
    const bounds = stage.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) };
  };
  const finish = async () => {
    const drawn = box;
    if (!drawn || !url || !shell?.capture || Math.abs(drawn.x1 - drawn.x0) < 6 || Math.abs(drawn.y1 - drawn.y0) < 6) return (setBox(null), setMarking(false));
    // Let the outline be painted, then take the stage with it drawn on.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const bounds = stage.current!.getBoundingClientRect();
    const picture = await shell.capture({ x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }).catch(() => null);
    setBox(null);
    setMarking(false);
    if (picture) ctx.compose(T.sitePreview.marked(url), { name: "preview-mark.png", data: picture });
    else ctx.note(T.sitePreview.markFailed);
  };

  useEffect(() => {
    const next = asked ?? remembered();
    setUrl(next);
    setTyped(next ?? "");
  }, [ctx.bureau.id, asked]);

  const show = (event: FormEvent) => {
    event.preventDefault();
    const next = address(typed);
    setBad(!next);
    if (!next) return;
    setUrl(next);
    setTyped(next);
    setTurn((n) => n + 1);
    try {
      localStorage.setItem(key(ctx.bureau.id), next);
    } catch {
      // Private mode: the address lasts for this window only.
    }
  };

  const sizes: Array<[Width, string, typeof Monitor]> = [
    ["desk", T.sitePreview.desk, Monitor],
    ["tablet", T.sitePreview.tablet, Tablet],
    ["phone", T.sitePreview.phone, Smartphone],
  ];
  return (
    <div className="site">
      <PageHead kicker={T.sitePreview.kicker(ctx.bureau.name)} title={T.sitePreview.title} />
      <form className="site-bar" onSubmit={show}>
        <input
          className="grow mono"
          value={typed}
          placeholder={T.sitePreview.placeholder}
          aria-label={T.sitePreview.address}
          aria-invalid={bad}
          onChange={(event) => (setTyped(event.target.value), setBad(false))}
        />
        <button className="btn btn-primary" type="submit">
          {T.sitePreview.show}
        </button>
        <button className="btn btn-ghost" type="button" disabled={!url} aria-label={T.sitePreview.reload} title={T.sitePreview.reload} onClick={() => setTurn((n) => n + 1)}>
          <I icon={RefreshCw} size={14} />
        </button>
        <Segmented<Width> value={width} label={T.sitePreview.width} onChange={setWidth} options={sizes.map(([value, label, icon]) => ({ value, label, icon }))} />
        <button className="btn btn-ghost" type="button" disabled={!url} aria-label={T.sitePreview.browser} title={T.sitePreview.browser} onClick={() => url && window.open(url, "_blank", "noopener")}>
          <I icon={ExternalLink} size={14} />
        </button>
        {shell?.capture && (
          <button className={`btn ${marking ? "btn-secondary" : "btn-ghost"}`} type="button" disabled={!url} aria-pressed={marking} title={T.sitePreview.mark} aria-label={T.sitePreview.mark} onClick={() => (setBox(null), setMarking(!marking))}>
            <I icon={Crosshair} size={14} />
          </button>
        )}
        <button className="btn btn-ghost" type="button" disabled={!url} title={T.sitePreview.tell} aria-label={T.sitePreview.tell} onClick={() => url && ctx.compose(T.sitePreview.told(url))}>
          <I icon={MessageSquarePlus} size={14} />
        </button>
      </form>
      {bad && <p className="err">{T.sitePreview.bad}</p>}
      {url ? (
        <div className="site-stage" ref={stage}>
          {marking && (
            <div
              className="site-mark"
              onPointerDown={(event) => {
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // A pointer that cannot be captured still draws while it stays over the page.
                }
                const point = at(event);
                setBox({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
              }}
              onPointerMove={(event) => box && setBox({ ...box, x1: at(event).x, y1: at(event).y })}
              onPointerUp={() => void finish()}
            >
              {box ? (
                <div className="site-mark-box" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />
              ) : (
                <span className="site-mark-hint">{T.sitePreview.markHint}</span>
              )}
            </div>
          )}
          <iframe
            key={`${url}#${turn}`}
            ref={frame}
            className="site-frame"
            src={url}
            title={T.sitePreview.title}
            style={WIDTHS[width] ? { width: WIDTHS[width]!, maxWidth: "100%" } : undefined}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          />
        </div>
      ) : (
        <Empty icon={Eye} title={T.sitePreview.emptyTitle}>
          {T.sitePreview.emptyBody}
        </Empty>
      )}
      <p className="muted term-hint">{T.sitePreview.hint}</p>
    </div>
  );
}
