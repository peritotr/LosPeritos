import { useEffect, useState } from "react";
import { Check, CircleDashed, Inbox, X } from "lucide-react";
import { openQuestions, pendingApprovals, type Ctx } from "./context";
import { T } from "./strings";
import { I, TASK_STATUS, clock, fileRef } from "./ui";

/**
 * "While you were away": what finished, what is still under way and what is
 * waiting on you, since the last time this window was looked at.
 *
 * The last-seen time is kept per bureau in the browser. It moves forward while
 * the window is visible and stops when it is hidden or closed, so coming back
 * after a break shows what happened in between.
 */

/** Shorter absences are not worth a summary. */
const AWAY_MINUTES = 10;
const key = (bureauId: string) => `losperitos.seen.${bureauId}`;

function read(bureauId: string): string | null {
  try {
    return localStorage.getItem(key(bureauId));
  } catch {
    return null;
  }
}
function write(bureauId: string, iso: string) {
  try {
    localStorage.setItem(key(bureauId), iso);
  } catch {
    // Without storage there is simply no summary next time.
  }
}
const longAgo = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() >= AWAY_MINUTES * 60_000;

/**
 * The moment the user was last here, if that was long enough ago to
 * summarise; null otherwise. `dismiss` marks everything as seen.
 */
export function useAway(bureauId: string): { since: string | null; dismiss(): void } {
  const [since, setSince] = useState<string | null>(() => {
    const seen = read(bureauId);
    return longAgo(seen) ? seen : null;
  });

  // A different bureau has its own last-seen time.
  useEffect(() => {
    const seen = read(bureauId);
    setSince(longAgo(seen) ? seen : null);
  }, [bureauId]);

  useEffect(() => {
    // While a summary is on screen the clock stays put, so it keeps its range.
    const beat = () => {
      if (document.visibilityState === "visible" && !since) write(bureauId, new Date().toISOString());
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || since) return;
      const seen = read(bureauId);
      if (longAgo(seen)) setSince(seen);
    };
    beat();
    const timer = setInterval(beat, 30_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [bureauId, since]);

  return {
    since,
    dismiss() {
      write(bureauId, new Date().toISOString());
      setSince(null);
    },
  };
}

export function AwayCard({ ctx }: { ctx: Ctx }) {
  const { since, dismiss } = useAway(ctx.bureau.id);
  if (!since) return null;

  const finished = ctx.tasks.filter((task) => task.status === "done" && task.updatedAt > since);
  const underWay = ctx.tasks.filter((task) => ["queued", "in_progress", "in_review"].includes(task.status));
  const approvals = pendingApprovals(ctx.approvals);
  const questions = openQuestions(ctx.messages);
  const waiting = approvals.length + questions.length;
  // Nothing happened and nothing is pending: no card.
  if (finished.length + underWay.length + waiting === 0) return null;

  const open = (id: string) => ctx.go({ screen: "file", id });
  return (
    <section className="away" aria-label={T.away.title}>
      <header>
        <strong className="grow">{T.away.title}</strong>
        <span className="mono muted">{T.away.range(clock(since), clock(new Date().toISOString()))}</span>
        <button className="btn btn-ghost btn-icon" aria-label={T.away.dismiss} title={T.away.dismiss} onClick={dismiss}>
          <I icon={X} size={14} />
        </button>
      </header>

      <h4>
        <I icon={Check} size={13} />
        {T.away.finished(finished.length)}
      </h4>
      {finished.map((task) => (
        <button key={task.id} className="away-row" onClick={() => open(task.id)}>
          <span className="mono">{fileRef(task)}</span>
          <span className="ellipsis">{task.title}</span>
        </button>
      ))}

      {underWay.length > 0 && (
        <>
          <h4>
            <I icon={CircleDashed} size={13} />
            {T.away.underWay(underWay.length)}
          </h4>
          {underWay.map((task) => (
            <button key={task.id} className="away-row" onClick={() => open(task.id)}>
              <span className="mono">{fileRef(task)}</span>
              <span className="ellipsis">{task.title}</span>
              <span className="muted">{TASK_STATUS[task.status].label}</span>
            </button>
          ))}
        </>
      )}

      {waiting > 0 && (
        <>
          <h4 className="act">
            <I icon={Inbox} size={13} />
            {T.away.waiting(waiting)}
          </h4>
          {approvals.map((approval) => (
            <button key={approval.id} className="away-row" onClick={() => ctx.go({ screen: "awaiting", id: approval.id })}>
              <span className="mono">{T.awaiting.tagSeal}</span>
              <span className="ellipsis">{approval.title}</span>
            </button>
          ))}
          {questions.map((question) => (
            <button key={question.id} className="away-row" onClick={() => ctx.go({ screen: "awaiting", id: question.id })}>
              <span className="mono">{T.awaiting.tagQuestion}</span>
              <span className="ellipsis">{question.body}</span>
            </button>
          ))}
        </>
      )}
    </section>
  );
}
