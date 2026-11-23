/**
 * What a bureau is for, written by the user: the form for a charter (started
 * from a ready-made type or from nothing), and the jobs that come round again.
 */
import { useEffect, useState } from "react";
import { CalendarClock, Play, Plus, Trash2 } from "lucide-react";
import type { Charter, Routine, WorkspaceKind } from "@losperitos/protocol";
import type { Ctx } from "./context";
import type { SaveRoutineInput } from "./store";
import { T } from "./strings";
import { Corners, I, Segmented, ago } from "./ui";

export type BureauType = (typeof T.charters.types)[number];
/** The ready-made types that carry a charter, beside the three built-in kinds. */
export const BUREAU_TYPES: readonly BureauType[] = T.charters.types;

const lines = (text: string) => text.split("\n").map((line) => line.trim().replace(/^[-*•]\s*/, "")).filter(Boolean);

/** A charter from what the form holds, or null while something required is missing. */
function read(form: Form, template: string): Charter | null {
  const specialties = form.specialties.split(",").map((role) => role.trim()).filter((role) => role.length >= 2);
  if (form.title.trim().length < 2 || form.job.trim().length < 30 || specialties.length === 0 || form.deliverable.trim().length < 10) return null;
  return {
    template,
    title: form.title.trim(),
    job: form.job.trim(),
    specialties: specialties.slice(0, 12),
    deliverable: form.deliverable.trim(),
    done: lines(form.done).filter((line) => line.length >= 3).slice(0, 12),
    seal: lines(form.seal).filter((line) => line.length >= 3).slice(0, 12),
  };
}

interface Form {
  title: string;
  job: string;
  specialties: string;
  deliverable: string;
  done: string;
  seal: string;
}

const fromType = (type: BureauType): Form => ({
  title: type.title,
  job: type.job,
  specialties: type.specialties,
  deliverable: type.deliverable,
  done: type.done.join("\n"),
  seal: type.seal.join("\n"),
});
const fromCharter = (charter: Charter): Form => ({
  title: charter.title,
  job: charter.job,
  specialties: charter.specialties.join(", "),
  deliverable: charter.deliverable,
  done: charter.done.join("\n"),
  seal: charter.seal.join("\n"),
});

/**
 * The charter form. `onChange` hears the charter as it stands (null while it
 * is incomplete) and, for an empty office, how its work is kept.
 */
export function CharterForm({
  start,
  template,
  base,
  onChange,
  chooseBase = false,
}: {
  start: Charter | BureauType;
  template: string;
  base: WorkspaceKind;
  onChange(charter: Charter | null, base: WorkspaceKind): void;
  chooseBase?: boolean;
}) {
  const [form, setForm] = useState<Form>(() => ("template" in start ? fromCharter(start) : fromType(start)));
  const [kept, setKept] = useState<WorkspaceKind>(base);
  useEffect(() => {
    const next = "template" in start ? fromCharter(start) : fromType(start);
    setForm(next);
    setKept(base);
    onChange(read(next, template), base);
  }, [template]);
  const set = (field: keyof Form) => (event: { target: { value: string } }) => {
    const next = { ...form, [field]: event.target.value };
    setForm(next);
    onChange(read(next, template), kept);
  };
  const area = (field: keyof Form, label: string, hint: string, rows: number) => (
    <div className="field">
      <label htmlFor={`ch-${field}`}>{label}</label>
      <textarea id={`ch-${field}`} className="input" rows={rows} value={form[field]} onChange={set(field)} />
      <p className="muted" style={{ fontSize: 12 }}>
        {hint}
      </p>
    </div>
  );
  return (
    <div className="charter-form">
      <div className="field">
        <label htmlFor="ch-title">{T.charters.title}</label>
        <input id="ch-title" className="input" value={form.title} maxLength={80} onChange={set("title")} />
      </div>
      {area("job", T.charters.job, T.charters.jobHint, 5)}
      <div className="field">
        <label htmlFor="ch-specialties">{T.charters.specialties}</label>
        <input id="ch-specialties" className="input" value={form.specialties} onChange={set("specialties")} />
        <p className="muted" style={{ fontSize: 12 }}>
          {T.charters.specialtiesHint}
        </p>
      </div>
      {area("deliverable", T.charters.deliverable, T.charters.deliverableHint, 3)}
      {area("done", T.charters.done, T.charters.doneHint, 4)}
      {area("seal", T.charters.seal, T.charters.sealHint, 3)}
      {chooseBase && (
        <div className="field">
          <label>{T.charters.base}</label>
          <Segmented<WorkspaceKind>
            label={T.charters.base}
            value={kept === "software" ? "software" : "content"}
            onChange={(next) => (setKept(next), onChange(read(form, template), next))}
            options={[
              { value: "content", label: T.charters.baseDocs },
              { value: "software", label: T.charters.baseCode },
            ]}
          />
          <p className="muted" style={{ fontSize: 12 }}>
            {T.charters.baseHint}
          </p>
        </div>
      )}
      {!read(form, template) && <p className="muted" style={{ fontSize: 12 }}>{T.charters.short}</p>}
    </div>
  );
}

const blank: SaveRoutineInput = { title: "", brief: "", every: "week", weekday: 1, day: 1, hour: 9, enabled: true };
const when = (routine: Pick<Routine, "every" | "weekday" | "day" | "hour">) =>
  `${routine.every === "day" ? T.routines.day : routine.every === "week" ? `${T.routines.week} · ${T.routines.weekdays[routine.weekday]}` : `${T.routines.month} · ${routine.day}`} · ${String(routine.hour).padStart(2, "0")}:00`;

/** The bureau's jobs that come round again: a list, a form, and a way to run one now. */
export function Routines({ ctx }: { ctx: Ctx }) {
  const [list, setList] = useState<Routine[] | null>(null);
  const [form, setForm] = useState<SaveRoutineInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setList(null);
    setForm(null);
    ctx.actions.routines(ctx.bureau.id).then(setList, (err: Error) => setError(err.message));
  }, [ctx.bureau.id]);
  const fail = (err: Error) => setError(err.message);
  const save = () => {
    if (!form) return;
    setError(null);
    ctx.actions.saveRoutine(ctx.bureau.id, form).then((next) => (setList(next), setForm(null)), fail);
  };
  const ready = !!form && form.title.trim().length >= 2 && form.brief.trim().length >= 10;
  return (
    <section className="panel blueprint">
      <Corners />
      <h4>
        <I icon={CalendarClock} size={16} /> {T.routines.title}
      </h4>
      <p className="muted" style={{ fontSize: 13 }}>
        {T.routines.hint}
      </p>
      {error && <p className="err">{error}</p>}
      {list?.length === 0 && !form && <p className="muted">{T.routines.none}</p>}
      {list?.map((routine) => (
        <div key={routine.id} className="connector">
          <I icon={CalendarClock} />
          <div className="grow" style={{ minWidth: 0 }}>
            <strong>{routine.title}</strong> <span className="mono muted">{when(routine)}{routine.enabled ? "" : ` · ${T.routines.off}`}</span>
            <div className="muted ellipsis">{routine.brief}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {routine.lastRunAt ? T.routines.last(ago(routine.lastRunAt)) : T.routines.never}
              {routine.enabled && ` · ${T.routines.next(new Date(routine.nextRunAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}`}
            </div>
          </div>
          <button className="btn btn-ghost" title={T.routines.run} aria-label={T.routines.run} onClick={() => ctx.actions.runRoutine(routine.id).then(() => (ctx.note(T.routines.ran), ctx.actions.routines(ctx.bureau.id).then(setList)), fail)}>
            <I icon={Play} size={14} />
          </button>
          <button className="btn btn-ghost" onClick={() => setForm({ id: routine.id, title: routine.title, brief: routine.brief, every: routine.every, weekday: routine.weekday, day: routine.day, hour: routine.hour, enabled: routine.enabled })}>
            {T.connectors.edit(routine.title)}
          </button>
          <button className="btn btn-ghost" title={T.routines.remove} aria-label={T.routines.remove} onClick={() => ctx.actions.removeRoutine(routine.id).then(setList, fail)}>
            <I icon={Trash2} size={14} />
          </button>
        </div>
      ))}
      {form ? (
        <div className="charter-form">
          <div className="field">
            <label htmlFor="rt-title">{T.routines.name}</label>
            <input id="rt-title" className="input" value={form.title} maxLength={120} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="rt-brief">{T.routines.brief}</label>
            <textarea id="rt-brief" className="input" rows={3} value={form.brief} onChange={(event) => setForm({ ...form, brief: event.target.value })} />
          </div>
          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            <div className="field">
              <label>{T.routines.every}</label>
              <Segmented<Routine["every"]>
                label={T.routines.every}
                value={form.every}
                onChange={(every) => setForm({ ...form, every })}
                options={[
                  { value: "day", label: T.routines.day },
                  { value: "week", label: T.routines.week },
                  { value: "month", label: T.routines.month },
                ]}
              />
            </div>
            {form.every === "week" && (
              <div className="field">
                <label htmlFor="rt-weekday">{T.routines.weekday}</label>
                <select id="rt-weekday" className="input" value={form.weekday} onChange={(event) => setForm({ ...form, weekday: Number(event.target.value) })}>
                  {T.routines.weekdays.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.every === "month" && (
              <div className="field">
                <label htmlFor="rt-day">{T.routines.dayOfMonth}</label>
                <input id="rt-day" className="input" type="number" min={1} max={28} value={form.day} onChange={(event) => setForm({ ...form, day: Math.max(1, Math.min(28, Number(event.target.value) || 1)) })} />
              </div>
            )}
            <div className="field">
              <label htmlFor="rt-hour">{T.routines.hour}</label>
              <select id="rt-hour" className="input" value={form.hour} onChange={(event) => setForm({ ...form, hour: Number(event.target.value) })}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={!ready} onClick={save}>
              {T.routines.save}
            </button>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>
              {T.routines.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setForm({ ...blank })}>
          <I icon={Plus} size={14} /> {T.routines.add}
        </button>
      )}
    </section>
  );
}
