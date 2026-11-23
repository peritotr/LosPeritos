/**
 * The user's own terminals: real shells in the bureau's folder, kept running
 * by the core. The screen only watches one; leaving it closes nothing.
 */
import { useEffect, useRef, useState } from "react";
import { Eye, Plus, SquareTerminal, X } from "lucide-react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@losperitos/protocol";
import type { Ctx } from "./context";
import { T } from "./strings";
import { Empty, I, PageHead } from "./ui";

/** A local address a dev server printed, to offer in the preview. */
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{2,5})?(?:\/[^\s"'<>)\]]*)?/g;
const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

function colours(el: Element) {
  const style = getComputedStyle(el);
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: pick("--color-bg", "#111"),
    foreground: pick("--color-text", "#eee"),
    cursor: pick("--color-accent", "#eee"),
    selectionBackground: pick("--color-divider", "#555"),
  };
}

function View({ ctx, id, onUrl }: { ctx: Ctx; id: string; onUrl(url: string): void }) {
  const host = useRef<HTMLDivElement>(null);
  const found = useRef(onUrl);
  found.current = onUrl;

  useEffect(() => {
    const el = host.current!;
    const term = new Xterm({
      fontFamily: getComputedStyle(el).getPropertyValue("--lp-mono").trim() || "ui-monospace, Menlo, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: colours(el),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const socket = ctx.actions.terminalSocket(id);
    const send = (message: unknown) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(message));
    const size = () => {
      try {
        fit.fit();
      } catch {
        return; // Not laid out yet.
      }
      send({ type: "resize", cols: term.cols, rows: term.rows });
    };
    socket.onopen = size;
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: "data"; data: string } | { type: "exit"; code: number };
      if (message.type === "data") {
        term.write(message.data);
        const urls = strip(message.data).match(LOCAL_URL);
        if (urls) found.current(urls[urls.length - 1]!.replace(/[.,;:]+$/, ""));
      } else {
        term.write(`\r\n\x1b[2m${T.terminal.exited(message.code)}\x1b[0m\r\n`);
      }
    };
    const typed = term.onData((data) => send({ type: "input", data }));
    const watcher = new ResizeObserver(size);
    watcher.observe(el);
    // The theme is a property of the page: follow it when it flips.
    const themed = new MutationObserver(() => (term.options.theme = colours(el)));
    const root = el.closest("[data-theme]");
    if (root) themed.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    term.focus();
    return () => {
      typed.dispose();
      watcher.disconnect();
      themed.disconnect();
      socket.close();
      term.dispose();
    };
  }, [id]);

  return <div className="term-host" ref={host} />;
}

export function TerminalScreen(ctx: Ctx) {
  const [list, setList] = useState<Terminal[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const opening = useRef(false);

  const open = () => {
    if (opening.current) return;
    opening.current = true;
    setError(null);
    ctx.actions
      .openTerminal(ctx.bureau.id)
      .then(
        (terminal) => (setList((before) => [...(before ?? []), terminal]), setActive(terminal.id)),
        (err: Error) => setError(err.message),
      )
      .finally(() => (opening.current = false));
  };

  useEffect(() => {
    let current = true;
    setList(null);
    setActive(null);
    setUrl(null);
    ctx.actions.terminals(ctx.bureau.id).then(
      (answer) => {
        if (!current) return;
        setAvailable(answer.available);
        setList(answer.terminals);
        setActive(answer.terminals.at(-1)?.id ?? null);
        // Coming here for the first time means wanting a shell: open one.
        if (answer.available && answer.terminals.length === 0) open();
      },
      (err: Error) => current && setError(err.message),
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id]);

  const close = (id: string) => {
    ctx.actions.closeTerminal(id).catch(() => undefined);
    setList((before) => {
      const next = (before ?? []).filter((item) => item.id !== id);
      if (active === id) setActive(next.at(-1)?.id ?? null);
      return next;
    });
  };

  const head = <PageHead kicker={T.terminal.kicker(ctx.bureau.name)} title={T.terminal.title} />;
  if (!available) {
    return (
      <>
        {head}
        <Empty icon={SquareTerminal} title={T.terminal.unavailable}>
          {T.terminal.unavailableBody}
        </Empty>
      </>
    );
  }
  return (
    <div className="term">
      {head}
      {error && <p className="err">{error}</p>}
      <div className="term-tabs" role="tablist">
        {list?.map((item, index) => (
          <span key={item.id} className="term-tab" role="tab" aria-selected={item.id === active}>
            <button className="term-pick" onClick={() => setActive(item.id)}>
              <I icon={SquareTerminal} size={13} /> {item.title} {index + 1}
            </button>
            <button className="term-close" aria-label={T.terminal.close} title={T.terminal.close} onClick={() => close(item.id)}>
              <I icon={X} size={12} />
            </button>
          </span>
        ))}
        <button className="btn btn-ghost" onClick={open} aria-label={T.terminal.open} title={T.terminal.open}>
          <I icon={Plus} size={14} />
        </button>
        <span className="grow" />
        {url && (
          <button className="btn btn-secondary" onClick={() => ctx.go({ screen: "preview", url })} title={url}>
            <I icon={Eye} size={14} /> {T.terminal.preview}
          </button>
        )}
      </div>
      {active ? <View key={active} ctx={ctx} id={active} onUrl={setUrl} /> : list && <p className="muted">{T.terminal.none}</p>}
      <p className="muted term-hint">{T.terminal.hint}</p>
    </div>
  );
}
