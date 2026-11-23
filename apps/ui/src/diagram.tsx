/**
 * A diagram written as Mermaid text inside a page or a message, drawn in
 * place. The library is large, so it is fetched the first time one is shown.
 */
import { useEffect, useId, useRef, useState } from "react";
import { T } from "./strings";

let loading: Promise<typeof import("mermaid").default> | null = null;
const library = () => (loading ??= import("mermaid").then((module) => module.default));

export function Diagram({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const id = `lp-diagram-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const [failed, setFailed] = useState<string | null>(null);
  const [asText, setAsText] = useState(false);

  useEffect(() => {
    let current = true;
    setFailed(null);
    const dark = host.current?.closest("[data-theme]")?.getAttribute("data-theme") === "dark";
    library()
      .then(async (mermaid) => {
        // Strict: no scripts and no links that run code, whatever the text says.
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", fontFamily: "inherit" });
        const { svg } = await mermaid.render(id, source);
        if (current && host.current) host.current.innerHTML = svg;
      })
      .catch((err: Error) => {
        // Mermaid leaves its error drawing in the page; take it out.
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        if (current) setFailed(err.message.split("\n")[0] ?? "");
      });
    return () => {
      current = false;
    };
  }, [source]);

  if (failed !== null) {
    return (
      <div className="diagram">
        <p className="muted">{T.diagram.failed(failed)}</p>
        <pre>{source}</pre>
      </div>
    );
  }
  return (
    <div className="diagram">
      <div ref={host} className="diagram-drawing" hidden={asText} />
      {asText && <pre>{source}</pre>}
      <button className="btn btn-ghost diagram-toggle" onClick={() => setAsText(!asText)}>
        {asText ? T.diagram.drawing : T.diagram.text}
      </button>
    </div>
  );
}
