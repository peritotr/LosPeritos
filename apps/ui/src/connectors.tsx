/**
 * Outside services a bureau may use: listing them, adding one, giving it its
 * secrets. Secret values go to the core and are never read back.
 */
import { useEffect, useState, type FormEvent } from "react";
import { ListChecks, LogIn, Pencil, Plug, Plus, Trash2, X } from "lucide-react";
import type { Connector, ConnectorTool, SaveConnectorRequest } from "@losperitos/protocol";
import type { Ctx } from "./context";
import { T } from "./strings";
import { Corners, I, Segmented } from "./ui";

/**
 * Services with a known way in. Choosing one fills the form; the user still
 * gives the secret and saves. `free` lists the tools that only read.
 */
interface Preset {
  id: string;
  name: string;
  /** A command on this machine, with the secret it needs… */
  line?: string;
  secret?: string;
  /** Further settings the command reads from its environment: ids and paths, kept with the secrets. */
  settings?: string[];
  /** What the user has to have or do first; a key of `T.connectors.notes`. */
  note?: keyof typeof T.connectors.notes;
  /** Where the user gets the secret. */
  keyUrl?: string;
  /** …or an address signed in to in the browser. */
  url?: string;
  free: string[];
}

const PRESETS: Preset[] = [
  {
    id: "replicate",
    name: "Replicate",
    // Replicate's own package, at the version whose tools were read for the list below.
    line: "npx -y replicate-mcp@0.9.0",
    secret: "REPLICATE_API_TOKEN",
    free: [
      "search_models", "list_models", "get_models", "get_models_*", "list_models_*",
      "list_collections", "get_collections", "list_hardware", "get_predictions", "list_predictions",
    ],
    keyUrl: "replicate.com/account/api-tokens",
  },
  {
    id: "fal",
    name: "fal",
    // fal's own hosted server; it takes a sign-in in the browser, not a key.
    url: "https://mcp.fal.ai/mcp-relay",
    free: ["search_models", "get_model_schema", "get_pricing", "search_docs", "recommend_model", "check_job", "get_job_result"],
  },
  {
    id: "higgsfield",
    name: "Higgsfield",
    // Higgsfield's own hosted server: image, video and sound, signed in to in the browser.
    url: "https://mcp.higgsfield.ai/mcp",
    free: ["balance", "models_explore", "estimate_*", "show_generations", "transactions", "job_display", "jobs_wait"],
    note: "higgsfield",
  },
  {
    id: "runway",
    name: "Runway",
    // Runway's own hosted server, signed in to in the browser. Its tool names are not published, so none is free.
    url: "https://mcp.runwayml.com/mcp",
    free: [],
    note: "runway",
  },
  {
    id: "kling",
    name: "Kling",
    // Kling's own hosted server for international accounts, signed in to in the browser.
    url: "https://kling.ai/mcp",
    free: [],
    note: "kling",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    // ElevenLabs' own hosted server: speech, sound, images and video, signed in to in the browser.
    // Its tool names are not published, so none is free.
    url: "https://api.elevenlabs.io/v1/mcp",
    free: [],
    note: "elevenlabs",
  },
  {
    id: "stability",
    name: "Stability AI",
    // A community server (Stability publishes none), at the version whose tools were read. Every tool spends credits.
    line: "npx -y mcp-server-stability-ai@0.2.0",
    secret: "STABILITY_AI_API_KEY",
    keyUrl: "platform.stability.ai/account/keys",
    free: [],
    note: "stability",
  },
  {
    id: "search-console",
    name: "Search Console",
    // A community server (Google publishes none), pinned. With a service account it needs no browser.
    line: "uvx mcp-search-console==0.4.2",
    settings: ["GSC_CREDENTIALS_PATH", "GSC_SKIP_OAUTH"],
    free: ["list_properties", "get_*", "compare_search_periods", "inspect_url_enhanced"],
    note: "searchConsole",
  },
  {
    id: "google-ads",
    name: "Google Ads",
    // Google's own server, pinned. It reads and proposes; it has no tool that changes a budget or a bid.
    line: "pipx run --spec google-ads-mcp==0.0.6 google-ads-mcp",
    settings: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "GOOGLE_ADS_LOGIN_CUSTOMER_ID"],
    free: ["search_search", "metadata_get_resource_metadata", "customers_list_accessible_customers"],
    note: "googleAds",
  },
  {
    id: "meta-ads",
    name: "Meta Ads",
    // Meta's own hosted server. Its tools can create and switch on ads, so none is free.
    url: "https://mcp.facebook.com/ads",
    free: [],
    note: "metaAds",
  },
];

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

function ConnectorForm({
  ctx,
  editing,
  preset,
  onDone,
}: {
  ctx: Ctx;
  editing: Connector | null;
  preset?: Preset;
  onDone(list: Connector[] | null): void;
}) {
  const [name, setName] = useState(editing?.name ?? preset?.name ?? "");
  const [id, setId] = useState(editing?.id ?? preset?.id ?? "");
  const [how, setHow] = useState<"command" | "url">(editing?.url || preset?.url ? "url" : "command");
  const [line, setLine] = useState(editing?.command ? [editing.command, ...editing.args].map(quote).join(" ") : (preset?.line ?? ""));
  const [url, setUrl] = useState(editing?.url ?? preset?.url ?? "");
  const [free, setFree] = useState((editing?.free ?? preset?.free ?? []).join(", "));
  /** Secrets already kept, minus those the user is taking away. */
  const [kept, setKept] = useState(editing?.secretNames ?? []);
  const [added, setAdded] = useState<Array<{ name: string; value: string }>>(
    [...(preset?.secret ? [preset.secret] : []), ...(preset?.settings ?? [])].map((name) => ({ name, value: name === "GSC_SKIP_OAUTH" ? "true" : "" })),
  );
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
          {preset?.note && `${T.connectors.notes[preset.note]} `}
          {preset?.keyUrl && `${T.connectors.keyFrom(preset.keyUrl)} `}
          {how === "url" && `${T.connectors.signInHint} `}
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

/** Whether a tool name fits a pattern in which `*` stands for any run of characters. */
const fits = (pattern: string, tool: string) =>
  new RegExp("^" + pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(tool);

/** The tools a connector's server offers, each with a tick for "may be used without asking". */
function ConnectorTools({ ctx, connector, onSaved }: { ctx: Ctx; connector: Connector; onSaved(list: Connector[]): void }) {
  const [tools, setTools] = useState<ConnectorTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    ctx.actions.connectorTools(ctx.bureau.id, connector.id).then(
      (list) => current && setTools(list),
      (err: Error) => current && setError(err.message),
    );
    return () => {
      current = false;
    };
  }, [ctx.bureau.id, connector.id, connector.command, connector.url, connector.args.join(" ")]);
  const free = (tool: string) => connector.free.some((pattern) => fits(pattern, tool));
  /** Ticking spells the list out by name, so a pattern never frees more than what is shown. */
  const toggle = (tool: string) => {
    const names = (tools ?? []).map((other) => other.name).filter((name) => (name === tool ? !free(name) : free(name)));
    const { secretNames: _kept, signedIn: _signedIn, ...rest } = connector;
    ctx.actions.saveConnector(ctx.bureau.id, { ...rest, secrets: {}, free: names }).then(onSaved, (err: Error) => setError(err.message));
  };
  if (error) return <p className="err">{error}</p>;
  if (!tools) return <p className="muted">{T.connectors.toolsLoading}</p>;
  if (tools.length === 0) return <p className="muted">{T.connectors.toolsNone}</p>;
  return (
    <div className="connector-tools">
      <p className="muted" style={{ fontSize: 12 }}>
        {T.connectors.toolsHint}
      </p>
      {tools.map((tool) => (
        <label key={tool.name} className="connector-tool">
          <input type="checkbox" checked={free(tool.name)} onChange={() => toggle(tool.name)} />
          <span className="mono">{tool.name}</span>
          {tool.readOnly !== null && <span className="tag">{tool.readOnly ? T.connectors.reads : T.connectors.changes}</span>}
          <span className="muted ellipsis">{tool.description}</span>
        </label>
      ))}
    </div>
  );
}

export function Connectors({ ctx }: { ctx: Ctx }) {
  /** The connector whose tools are shown. */
  const [listing, setListing] = useState<string | null>(null);
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

  /** Open the provider's sign-in page, then look until the connector reports it is signed in. */
  const signIn = (connector: Connector) => {
    setError(null);
    ctx.actions.connectorSignIn(ctx.bureau.id, connector.id).then(
      (url) => {
        window.open(url, "_blank", "noopener");
        ctx.note(T.connectors.signInOpened);
        let tries = 0;
        const timer = setInterval(() => {
          ctx.actions.connectors(ctx.bureau.id).then((next) => {
            if (next.find((other) => other.id === connector.id)?.signedIn || ++tries > 90) clearInterval(timer);
            setList(next);
          }, () => clearInterval(timer));
        }, 2000);
      },
      (err: Error) => setError(err.message),
    );
  };

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
          <div key={connector.id}>
          <div className="connector">
            <I icon={Plug} />
            <div className="grow" style={{ minWidth: 0 }}>
              <strong>{connector.name}</strong> <span className="mono muted">{connector.id}</span>
              <div className="mono muted ellipsis">{connector.url ?? [connector.command, ...connector.args].join(" ")}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {connector.free.length ? T.connectors.freeList(connector.free.join(", ")) : T.connectors.freeNone}
                {connector.secretNames.length > 0 && ` · ${T.connectors.secretCount(connector.secretNames.length)}`}
                {connector.signedIn && ` · ${T.connectors.signedIn}`}
              </div>
            </div>
            {connector.url && (
              <button className="btn btn-secondary" onClick={() => signIn(connector)}>
                <I icon={LogIn} size={14} />
                {connector.signedIn ? T.connectors.signInAgain : T.connectors.signIn}
              </button>
            )}
            <button
              className="btn btn-ghost"
              aria-pressed={listing === connector.id}
              aria-label={T.connectors.tools(connector.name)}
              onClick={() => setListing(listing === connector.id ? null : connector.id)}
            >
              <I icon={ListChecks} size={14} />
            </button>
            <button className="btn btn-ghost" aria-label={T.connectors.edit(connector.name)} onClick={() => setOpen(connector.id)}>
              <I icon={Pencil} size={14} />
            </button>
            <button className={`btn ${removing === connector.id ? "btn-secondary" : "btn-ghost"}`} aria-label={T.connectors.remove(connector.name)} onClick={() => remove(connector)} onBlur={() => setRemoving(null)}>
              <I icon={Trash2} size={14} />
              {removing === connector.id && T.connectors.removeSure}
            </button>
          </div>
          {listing === connector.id && <ConnectorTools ctx={ctx} connector={connector} onSaved={setList} />}
          </div>
        ),
      )}
      {open === "new" || open?.startsWith("preset:") ? (
        <ConnectorForm
          key={open}
          ctx={ctx}
          editing={null}
          preset={PRESETS.find((preset) => `preset:${preset.id}` === open)}
          onDone={(next) => (next && setList(next), setOpen(null))}
        />
      ) : (
        <div className="row wrap">
          <button className="btn btn-secondary" onClick={() => setOpen("new")}>
            <I icon={Plus} size={14} />
            {T.connectors.add}
          </button>
          {PRESETS.filter((preset) => !list?.some((connector) => connector.id === preset.id)).map((preset) => (
            <button key={preset.id} className="btn btn-ghost" onClick={() => setOpen(`preset:${preset.id}`)}>
              <I icon={Plug} size={14} />
              {T.connectors.preset(preset.name)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
