/**
 * Outside services a bureau may use: listing them, adding one, giving it its
 * secrets. Secret values go to the core and are never read back.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plug, Plus, Trash2, X } from "lucide-react";
import type { Connector, SaveConnectorRequest } from "@losperitos/protocol";
import type { Ctx } from "./context";
import { T } from "./strings";
import { Corners, I, Segmented } from "./ui";

/** "Search Console" → "search-console": the name the tools will carry. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .slice(0, 32);

/** Split a command line on spaces, keeping quoted parts whole. */
const words = (line: string) =>
  [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]!);

const quote = (word: string) => (/\s/.test(word) ? `"${word}"` : word);

function ConnectorForm({ ctx, editing, onDone }: { ctx: Ctx; editing: Connector | null; onDone(list: Connector[] | null): void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [id, setId] = useState(editing?.id ?? "");
  const [how, setHow] = useState<"command" | "url">(editing?.url ? "url" : "command");
  const [line, setLine] = useState(editing?.command ? [editing.command, ...editing.args].map(quote).join(" ") : "");
  const [url, setUrl] = useState(editing?.url ?? "");
  const [free, setFree] = useState(editing?.free.join(", ") ?? "");
  /** Secrets already kept, minus those the user is taking away. */
  const [kept, setKept] = useState(editing?.secretNames ?? []);
  const [added, setAdded] = useState<Array<{ name: string; value: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = editing?.id ?? (id || slug(name));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const [command, ...args] = words(line);
    const secrets: Record<string, string> = {};
    for (const gone of (editing?.secretNames ?? []).filter((secret) => !kept.includes(secret))) secrets[gone] = "";
    for (const secret of added) if (secret.name.trim() && secret.value) secrets[secret.name.trim()] = secret.value;
    const request: SaveConnectorRequest = {
      id: key,
      name: name.trim(),
      args: how === "command" ? args : [],
      ...(how === "command" ? { command } : { url: url.trim() }),
      secrets,
      free: free.split(/[,\s]+/).filter(Boolean),
    };
    setBusy(true);
    setError(null);
    try {
      onDone(await ctx.actions.saveConnector(ctx.bureau.id, request));
      ctx.note(T.connectors.saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = !!name.trim() && /^[a-z][a-z0-9-]*$/.test(key) && (how === "command" ? !!line.trim() : !!url.trim());
  return (
    <form className="connector-form" onSubmit={submit}>
      <div className="file-form-row">
        <div className="field grow">
          <label htmlFor="cn-name">{T.connectors.name}</label>
          <input id="cn-name" className="input" value={name} maxLength={60} autoFocus onChange={(event) => setName(event.target.value)} placeholder={T.connectors.namePlaceholder} />
        </div>
        <div className="field">
          <label htmlFor="cn-id">{T.connectors.id}</label>
          <input id="cn-id" className="input mono" value={key} disabled={!!editing} maxLength={32} onChange={(event) => setId(event.target.value.toLowerCase())} />
        </div>
      </div>
      <div className="field">
        <label>{T.connectors.how}</label>
        <Segmented<"command" | "url">
          label={T.connectors.how}
          value={how}
          onChange={setHow}
          options={[
            { value: "command", label: T.connectors.command },
            { value: "url", label: T.connectors.url },
          ]}
        />
      </div>
      {how === "command" ? (
        <div className="field">
          <label htmlFor="cn-line">{T.connectors.commandLabel}</label>
          <input id="cn-line" className="input mono" value={line} onChange={(event) => setLine(event.target.value)} placeholder="npx -y @example/mcp-server" spellCheck={false} />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="cn-url">{T.connectors.urlLabel}</label>
          <input id="cn-url" className="input mono" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" spellCheck={false} />
        </div>
      )}
      <div className="field">
        <label>{how === "command" ? T.connectors.secretsEnv : T.connectors.secretsHeaders}</label>
        {kept.map((secret) => (
          <div className="row secret-row" key={secret}>
            <span className="mono grow ellipsis">{secret}</span>
            <span className="muted">{T.connectors.secretKept}</span>
            <button type="button" className="btn btn-ghost" aria-label={T.connectors.secretRemove(secret)} onClick={() => setKept(kept.filter((other) => other !== secret))}>
              <I icon={X} size={14} />
            </button>
          </div>
        ))}
        {added.map((secret, index) => (
          <div className="row secret-row" key={index}>
            <input
              className="input mono"
              value={secret.name}
              aria-label={T.connectors.secretName}
              placeholder={how === "command" ? "API_KEY" : "Authorization"}
              spellCheck={false}
              onChange={(event) => setAdded(added.map((other, at) => (at === index ? { ...other, name: event.target.value } : other)))}
            />
            <input
              className="input mono grow"
              type="password"
              autoComplete="off"
              value={secret.value}
              aria-label={T.connectors.secretValue}
              placeholder={T.connectors.secretValue}
              onChange={(event) => setAdded(added.map((other, at) => (at === index ? { ...other, value: event.target.value } : other)))}
            />
            <button type="button" className="btn btn-ghost" aria-label={T.connectors.secretDrop} onClick={() => setAdded(added.filter((_, at) => at !== index))}>
              <I icon={X} size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setAdded([...added, { name: "", value: "" }])}>
          <I icon={Plus} size={14} />
          {T.connectors.secretAdd}
        </button>
        <p className="muted" style={{ fontSize: 12 }}>
          {T.connectors.secretsHint}
        </p>
      </div>
      <div className="field">
        <label htmlFor="cn-free">{T.connectors.free}</label>
        <input id="cn-free" className="input mono" value={free} onChange={(event) => setFree(event.target.value)} placeholder="get_*, list_*, search" spellCheck={false} />
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {T.connectors.freeHint}
        </p>
      </div>
      {error && <p className="err">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !ready}>
          {T.connectors.save}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onDone(null)}>
          {T.connectors.cancel}
        </button>
      </div>
    </form>
  );
}

export function Connectors({ ctx }: { ctx: Ctx }) {
  const [list, setList] = useState<Connector[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The connector being edited, `"new"` for a fresh one. */
  const [open, setOpen] = useState<string | null>(null);
  /** The connector whose removal waits for a second click. */
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    setList(null);
    setOpen(null);
    ctx.actions.connectors(ctx.bureau.id).then(setList, (err: Error) => setError(err.message));
  }, [ctx.bureau.id]);

  const remove = (connector: Connector) => {
    if (removing !== connector.id) return setRemoving(connector.id);
    setRemoving(null);
    ctx.actions.removeConnector(ctx.bureau.id, connector.id).then(
      (next) => (setList(next), ctx.note(T.connectors.removed(connector.name))),
      (err: Error) => setError(err.message),
    );
  };

  return (
    <section className="panel blueprint connectors">
      <Corners />
      <h4>{T.connectors.title}</h4>
      <p className="muted" style={{ fontSize: 13 }}>
        {T.connectors.intro}
      </p>
      {error && <p className="err">{error}</p>}
      {list?.length === 0 && open === null && <p className="muted">{T.connectors.none}</p>}
      {list?.map((connector) =>
        open === connector.id ? (
          <ConnectorForm key={connector.id} ctx={ctx} editing={connector} onDone={(next) => (next && setList(next), setOpen(null))} />
        ) : (
          <div className="connector" key={connector.id}>
            <I icon={Plug} />
            <div className="grow" style={{ minWidth: 0 }}>
              <strong>{connector.name}</strong> <span className="mono muted">{connector.id}</span>
              <div className="mono muted ellipsis">{connector.url ?? [connector.command, ...connector.args].join(" ")}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {connector.free.length ? T.connectors.freeList(connector.free.join(", ")) : T.connectors.freeNone}
                {connector.secretNames.length > 0 && ` · ${T.connectors.secretCount(connector.secretNames.length)}`}
              </div>
            </div>
            <button className="btn btn-ghost" aria-label={T.connectors.edit(connector.name)} onClick={() => setOpen(connector.id)}>
              <I icon={Pencil} size={14} />
            </button>
            <button className={`btn ${removing === connector.id ? "btn-secondary" : "btn-ghost"}`} aria-label={T.connectors.remove(connector.name)} onClick={() => remove(connector)} onBlur={() => setRemoving(null)}>
              <I icon={Trash2} size={14} />
              {removing === connector.id && T.connectors.removeSure}
            </button>
          </div>
        ),
      )}
      {open === "new" ? (
        <ConnectorForm ctx={ctx} editing={null} onDone={(next) => (next && setList(next), setOpen(null))} />
      ) : (
        <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }} onClick={() => setOpen("new")}>
          <I icon={Plus} size={14} />
          {T.connectors.add}
        </button>
      )}
    </section>
  );
}
