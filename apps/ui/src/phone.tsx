/**
 * Settings for reaching the bureau from a phone: a switch, the address to open
 * (as a code to scan), and a way to make every address handed out so far stop working.
 */
import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { Copy, RefreshCw, Smartphone } from "lucide-react";
import type { NotifySettings, PhoneAccess } from "@losperitos/protocol";
import type { Ctx } from "./context";
import { T, language } from "./strings";
import { Corners, I } from "./ui";

function code(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(5, 12);
}

export function PhoneSettings({ ctx }: { ctx: Ctx }) {
  const [access, setAccess] = useState<PhoneAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ctx.actions.phone().then(setAccess, (err: Error) => setError(err.message));
  }, []);
  const set = (enabled: boolean, renew = false) => {
    setBusy(true);
    setError(null);
    ctx.actions
      .setPhone(enabled, renew)
      .then(setAccess, (err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const url = access?.urls[0];

  return (
    <section className="panel blueprint">
      <Corners />
      <h4>
        <I icon={Smartphone} size={16} /> {T.phone.title}
      </h4>
      <label className="check">
        <input type="checkbox" checked={!!access?.enabled} disabled={busy || !access} onChange={(event) => set(event.target.checked)} />
        <span>{T.phone.toggle}</span>
      </label>
      <p className="muted" style={{ fontSize: 13 }}>
        {T.phone.hint}
      </p>
      {error && <p className="err">{error}</p>}
      {access?.enabled &&
        (url ? (
          <div className="phone-open">
            <img src={code(url)} alt={T.phone.code} width={190} height={190} />
            <div className="grow" style={{ minWidth: 0 }}>
              <p style={{ marginTop: 0 }}>{T.phone.scan}</p>
              {access.urls.map((item) => (
                <div key={item} className="guide-command" style={{ margin: "0 0 6px" }}>
                  <code className="mono grow">{item}</code>
                  <button className="btn btn-ghost" aria-label={T.guides.copy} title={T.guides.copy} onClick={() => navigator.clipboard.writeText(item).then(() => ctx.note(T.guides.copied), () => undefined)}>
                    <I icon={Copy} size={13} />
                  </button>
                </div>
              ))}
              <button className="btn btn-secondary" disabled={busy} onClick={() => set(true, true)}>
                <I icon={RefreshCw} size={14} /> {T.phone.renew}
              </button>
              <p className="muted" style={{ fontSize: 12 }}>
                {T.phone.renewHint} {access.secure && access.fingerprint ? T.phone.secure(access.fingerprint.replace(/:/g, "").slice(-8)) : T.phone.plain}
              </p>
            </div>
          </div>
        ) : (
          <p className="muted">{T.phone.noNetwork}</p>
        ))}
      <Nudges ctx={ctx} />
    </section>
  );
}

/** Nudges through an ntfy server: off until the user subscribes a phone to the topic. */
function Nudges({ ctx }: { ctx: Ctx }) {
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [server, setServer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ctx.actions.notify().then((loaded) => (setSettings(loaded), setServer(loaded.server)), (err: Error) => setError(err.message));
  }, []);
  const set = (enabled: boolean, renew = false) => {
    setBusy(true);
    setError(null);
    ctx.actions
      .setNotify({ enabled, renew, server: server.trim() || undefined, lang: language })
      .then((saved) => (setSettings(saved), setServer(saved.server)), (err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const link = settings?.topic ? `${settings.server}/${settings.topic}` : null;

  return (
    <div className="field" style={{ marginTop: 18 }}>
      <label className="check">
        <input type="checkbox" checked={!!settings?.enabled} disabled={busy || !settings} onChange={(event) => set(event.target.checked)} />
        <span>{T.phone.nudge}</span>
      </label>
      <p className="muted" style={{ fontSize: 13 }}>
        {T.phone.nudgeHint}
      </p>
      {error && <p className="err">{error}</p>}
      {settings?.enabled && link && (
        <div className="phone-open">
          <img src={code(link)} alt={T.phone.code} width={150} height={150} />
          <div className="grow" style={{ minWidth: 0 }}>
            <p style={{ marginTop: 0 }}>{T.phone.nudgeHow}</p>
            <div className="guide-command" style={{ margin: "0 0 6px" }}>
              <code className="mono grow">{settings.topic}</code>
              <button className="btn btn-ghost" aria-label={T.guides.copy} title={T.guides.copy} onClick={() => navigator.clipboard.writeText(settings.topic!).then(() => ctx.note(T.guides.copied), () => undefined)}>
                <I icon={Copy} size={13} />
              </button>
            </div>
            <div className="row wrap">
              <button className="btn btn-secondary" disabled={busy} onClick={() => ctx.actions.testNotify().then((sent) => ctx.note(sent ? T.phone.nudgeSent : T.phone.nudgeFailed), () => ctx.note(T.phone.nudgeFailed))}>
                {T.phone.nudgeTest}
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => set(true, true)}>
                <I icon={RefreshCw} size={14} /> {T.phone.nudgeRenew}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <input className="grow mono" value={server} aria-label={T.phone.nudgeServer} placeholder="https://ntfy.sh" onChange={(event) => setServer(event.target.value)} onBlur={() => settings && server.trim() !== settings.server && set(settings.enabled)} />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        {T.phone.nudgeServer}
      </p>
    </div>
  );
}
