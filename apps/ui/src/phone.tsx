/**
 * Settings for reaching the bureau from a phone: a switch, the address to open
 * (as a code to scan), and a way to make every address handed out so far stop working.
 */
import { useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { Copy, RefreshCw, Smartphone } from "lucide-react";
import type { PhoneAccess } from "@losperitos/protocol";
import type { Ctx } from "./context";
import { T } from "./strings";
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
                {T.phone.renewHint}
              </p>
            </div>
          </div>
        ) : (
          <p className="muted">{T.phone.noNetwork}</p>
        ))}
    </section>
  );
}
