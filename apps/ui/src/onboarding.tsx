/** First-use help: a short tour shown once, and starter jobs for an empty bureau. */
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { WorkspaceKind } from "@losperitos/protocol";
import { T } from "./strings";
import { Corners, I } from "./ui";

const SEEN = "losperitos.tour";
const EVENT = "losperitos:tour";

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    // Without storage the tour would return on every visit; better never than always.
    return true;
  }
}

/** Ask the window to show the tour again, from anywhere. */
export const showTour = () => window.dispatchEvent(new Event(EVENT));

/** True while the tour should be on screen; `ready` holds it back until a bureau is open. */
export function useTour(ready: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (ready && !tourSeen()) setOpen(true);
  }, [ready]);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // Nothing to remember it with.
    }
  };
  return [open, close];
}

export function Tour({ onClose }: { onClose(): void }) {
  const [at, setAt] = useState(0);
  const steps = T.tour.steps;
  const step = steps[at]!;
  const last = at === steps.length - 1;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && !last) setAt(at + 1);
      if (event.key === "ArrowLeft" && at > 0) setAt(at - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [at, last]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="tour blueprint" role="dialog" aria-modal="true" aria-label={T.tour.label} onClick={(event) => event.stopPropagation()}>
        <Corners />
        <div className="row">
          <span className="kicker grow">{T.tour.count(at + 1, steps.length)}</span>
          <button className="btn btn-ghost" aria-label={T.tour.skip} onClick={onClose}>
            <I icon={X} size={14} />
          </button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn btn-ghost" onClick={onClose}>
            {T.tour.skip}
          </button>
          <span className="grow" />
          {at > 0 && (
            <button className="btn btn-secondary" onClick={() => setAt(at - 1)}>
              <I icon={ArrowLeft} size={14} />
              {T.tour.back}
            </button>
          )}
          <button className="btn btn-primary" autoFocus onClick={() => (last ? onClose() : setAt(at + 1))}>
            {last ? T.tour.finish : T.tour.next}
            {!last && <I icon={ArrowRight} size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Jobs to begin with; choosing one writes it into the brief, to be edited before it is sent. */
export function Starters({ kind, onPick }: { kind: WorkspaceKind; onPick(text: string): void }) {
  return (
    <section className="starters">
      <div className="section-label">{T.tour.starters}</div>
      <div className="starter-grid">
        {T.tour.jobs[kind].map((job) => (
          <button key={job.title} className="starter" onClick={() => onPick(job.brief)}>
            <strong>{job.title}</strong>
            <span className="muted">{job.brief}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
