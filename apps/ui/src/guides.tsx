/**
 * Publishing guides: the steps from a finished job to something people can
 * use. They are a checklist for the user and a brief for the lead; nothing
 * here publishes anything.
 */
import { useState } from "react";
import { Copy, Rocket, Send, UserRound } from "lucide-react";
import type { Ctx } from "./context";
import { T } from "./strings";
import { Corners, I, PageHead } from "./ui";

const key = (bureauId: string) => `losperitos.guides.${bureauId}`;
function ticks(bureauId: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(key(bureauId)) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function Guides(ctx: Ctx) {
  const guides = T.guides.list;
  const [openId, setOpenId] = useState<string>(guides[0]!.id);
  const [done, setDone] = useState(() => ticks(ctx.bureau.id));
  const guide = guides.find((item) => item.id === openId) ?? guides[0]!;
  const tick = (id: string, value: boolean) => {
    const next = { ...done, [id]: value };
    setDone(next);
    try {
      localStorage.setItem(key(ctx.bureau.id), JSON.stringify(next));
    } catch {
      // Private mode: the ticks last for this window only.
    }
  };
  const count = (id: string, steps: readonly unknown[]) => steps.filter((_, index) => done[`${id}.${index}`]).length;
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => ctx.note(T.guides.copied), () => undefined);

  return (
    <>
      <PageHead kicker={T.guides.kicker(ctx.bureau.name)} title={T.guides.title} />
      <p className="muted" style={{ maxWidth: 720, marginTop: 0 }}>
        {T.guides.intro}
      </p>
      <div className="code">
        <div className="code-side">
          <section className="panel blueprint">
            <Corners />
            {guides.map((item) => (
              <button key={item.id} className="code-row code-commit" aria-pressed={item.id === guide.id} onClick={() => setOpenId(item.id)}>
                <I icon={Rocket} size={14} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span style={{ display: "block" }}>{item.title}</span>
                  <span className="muted">{item.summary}</span>
                </span>
                <span className="count">{T.guides.progress(count(item.id, item.steps), item.steps.length)}</span>
              </button>
            ))}
          </section>
        </div>
        <div className="code-main">
          <figure className="preview blueprint">
            <Corners />
            <header>
              <strong className="grow">{guide.title}</strong>
              <button
                className="btn btn-secondary"
                onClick={() => ctx.compose(T.guides.handed(guide.title, guide.steps.map((step, index) => `${index + 1}. ${step.text}`).join("\n")))}
              >
                <I icon={Send} size={14} /> {T.guides.hand}
              </button>
            </header>
            <ol className="guide-steps">
              {guide.steps.map((step, index) => {
                const id = `${guide.id}.${index}`;
                return (
                  <li key={id} className={done[id] ? "done" : undefined}>
                    <label>
                      <input type="checkbox" checked={!!done[id]} onChange={(event) => tick(id, event.target.checked)} />
                      <span>
                        {step.text}
                        {step.yours && (
                          <span className="guide-yours">
                            <I icon={UserRound} size={12} /> {T.guides.yours}
                          </span>
                        )}
                      </span>
                    </label>
                    {step.command && (
                      <div className="guide-command">
                        <code className="mono grow">{step.command}</code>
                        <button className="btn btn-ghost" aria-label={T.guides.copy} title={T.guides.copy} onClick={() => copy(step.command)}>
                          <I icon={Copy} size={13} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </figure>
        </div>
      </div>
    </>
  );
}
