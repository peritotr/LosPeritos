import { useEffect, useState, type FormEvent } from "react";
import type { Estimate, Issue, Task, WorkspaceKind } from "@losperitos/protocol";
import type { Ctx } from "./context";
import { T } from "./strings";
import { Corners, fileRef, kindOf, money } from "./ui";

/** The tools above the list of files: writing one yourself, and importing GitHub issues. */

const SPECIALTIES = {
  software: ["developer", "tester", "designer", "architect", "auditor"],
  marketing: ["seo", "copywriter", "ads", "social", "analyst", "designer"],
  content: ["writer", "editor", "researcher", "scriptwriter", "translator"],
} as const satisfies Record<WorkspaceKind, readonly (keyof typeof T.perito.roles)[]>;

export function NewFileForm({ ctx, onClose }: { ctx: Ctx; onClose(): void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const specialties = SPECIALTIES[kindOf(ctx.bureau)];
  const [specialty, setSpecialty] = useState<string>(specialties[0]);
  const [effort, setEffort] = useState<NonNullable<Task["effort"]>>("normal");
  const [priority, setPriority] = useState<NonNullable<Task["priority"]>>("normal");
  const [after, setAfter] = useState("");
  const [labels, setLabels] = useState("");
  // In a folder that holds several repositories, a file works in one of them.
  const repos = ctx.bureau.repos.map((item) => item.path).filter((name) => name !== ".");
  const [repo, setRepo] = useState("");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  useEffect(() => {
    ctx.actions.estimate(ctx.bureau.id).then(setEstimate, () => setEstimate(null));
  }, [ctx.bureau.id]);
  const cost = estimate?.[effort];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Only files that are not closed yet are worth waiting for.
  const open = ctx.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");

  const save = (start: boolean) => async (event?: FormEvent) => {
    event?.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ctx.actions.createTask(ctx.bureau.id, {
        title: title.trim(),
        description,
        specialty,
        effort,
        priority,
        dependsOn: after ? [after] : [],
        labels: [...new Set(labels.split(",").map((label) => label.trim().toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 8),
        ...(repo && { repo }),
        start,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className={`panel blueprint file-form ${ctx.simple ? "plain" : ""}`} onSubmit={save(true)}>
      <Corners />
      <div className="field">
        <label htmlFor="nf-title">{T.files.form.title}</label>
        <input
          id="nf-title"
          className="input"
          value={title}
          autoFocus
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={T.files.form.titlePlaceholder}
        />
      </div>
      <div className="field">
        <label htmlFor="nf-desc">{T.files.form.description}</label>
        <textarea
          id="nf-desc"
          className="input"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={T.files.form.descriptionPlaceholder}
        />
      </div>
      <div className="file-form-row">
        <div className="field">
          <label htmlFor="nf-spec">{T.files.form.specialty}</label>
          <select id="nf-spec" className="input" value={specialty} onChange={(event) => setSpecialty(event.target.value)}>
            {specialties.map((key) => (
              <option key={key} value={key}>
                {T.perito.roles[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="field extra">
          <label htmlFor="nf-effort">{T.files.form.effort}</label>
          <select id="nf-effort" className="input" value={effort} onChange={(event) => setEffort(event.target.value as typeof effort)}>
            {(["small", "normal", "large"] as const).map((key) => (
              <option key={key} value={key}>
                {T.files.effort[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="field extra">
          <label htmlFor="nf-priority">{T.files.form.priority}</label>
          <select
            id="nf-priority"
            className="input"
            value={priority}
            onChange={(event) => setPriority(event.target.value as typeof priority)}
          >
            {(["high", "normal", "low"] as const).map((key) => (
              <option key={key} value={key}>
                {T.files.priority[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="field grow extra">
          <label htmlFor="nf-after">{T.files.form.after}</label>
          <select id="nf-after" className="input" value={after} onChange={(event) => setAfter(event.target.value)}>
            <option value="">{T.files.form.afterNone}</option>
            {open.map((task) => (
              <option key={task.id} value={task.id}>
                {fileRef(task)} {task.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      {repos.length > 0 && (
        <div className="field">
          <label htmlFor="nf-repo">{T.files.form.repo}</label>
          <select id="nf-repo" className="input" value={repo} onChange={(event) => setRepo(event.target.value)}>
            <option value="">{T.files.form.repoNone}</option>
            {repos.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field extra">
        <label htmlFor="nf-labels">{T.files.form.labels}</label>
        <input
          id="nf-labels"
          className="input"
          value={labels}
          onChange={(event) => setLabels(event.target.value)}
          placeholder={T.files.form.labelsPlaceholder}
        />
      </div>
      {cost && (
        <p className="muted" style={{ fontSize: 12 }}>
          {cost.tasks ? T.files.form.estimate(money(cost.usd), cost.tasks) : T.files.form.estimateGuess(money(cost.usd))}
        </p>
      )}
      {error && <p className="err">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !title.trim()}>
          {T.files.form.start}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy || !title.trim()} onClick={save(false)}>
          {T.files.form.draft}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {T.files.form.cancel}
        </button>
      </div>
    </form>
  );
}

export function IssueImport({ ctx, onClose }: { ctx: Ctx; onClose(): void }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ctx.actions.listIssues(ctx.bureau.id).then(setIssues, (err: Error) => setError(err.message));
  }, [ctx.bureau.id]);

  const toggle = (number: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(number)) next.add(number);
      return next;
    });

  const bringIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const chosen = (issues ?? []).filter((issue) => picked.has(issue.number));
      for (const issue of chosen) {
        // Drafts, so nothing starts until the user has looked each one over.
        await ctx.actions.createTask(ctx.bureau.id, {
          title: issue.title,
          description: `${issue.body}\n\nGitHub issue #${issue.number}: ${issue.url}`.trim(),
          start: false,
        });
      }
      ctx.note(T.files.issues.imported(chosen.length));
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="panel blueprint file-form" aria-label={T.files.issues.title}>
      <Corners />
      <h4>{T.files.issues.title}</h4>
      {error && <p className="err">{error}</p>}
      {!error && issues === null && <p className="muted">{T.files.issues.loading}</p>}
      {issues?.length === 0 && <p className="muted">{T.files.issues.none}</p>}
      {issues && issues.length > 0 && (
        <div className="issue-list">
          {issues.map((issue) => (
            <label key={issue.number} className="issue-row">
              <input type="checkbox" checked={picked.has(issue.number)} onChange={() => toggle(issue.number)} />
              <span className="mono muted">#{issue.number}</span>
              <span className="ellipsis">{issue.title}</span>
              <span className="muted ellipsis">{issue.labels.join(", ")}</span>
            </label>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" disabled={busy || picked.size === 0} onClick={bringIn}>
          {T.files.issues.import(picked.size)}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          {T.files.issues.close}
        </button>
      </div>
    </section>
  );
}
