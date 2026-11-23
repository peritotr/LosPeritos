/** The page a phone is given. One file, nothing fetched from elsewhere. */
export const PHONE_PAGE = String.raw`<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>LosPeritos</title>
<style>
:root{--bg:#f2f2f3;--card:#fff;--ink:#16181d;--muted:#6b7280;--line:#d5d7dc;--accent:#1f3a5f;--ok:#1f7a4d;--no:#a33;}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1e24;--ink:#e8eaed;--muted:#9aa3ad;--line:#2c323a;--accent:#8fb4e8;--ok:#5fc08f;--no:#e08080;}}
*{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);padding:16px 16px calc(24px + env(safe-area-inset-bottom))}
h1{font-size:18px;margin:4px 0 16px;letter-spacing:.02em}h2{font-size:15px;margin:22px 0 8px;display:flex;gap:8px;align-items:baseline}
h2 small{color:var(--muted);font-weight:400}.card{background:var(--card);border:1px solid var(--line);padding:12px;margin:8px 0}
.kind{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.title{font-weight:600;margin:2px 0 6px}
.body{white-space:pre-wrap;word-break:break-word}.muted{color:var(--muted);font-size:13px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}button{font:inherit;padding:10px 14px;border:1px solid var(--line);background:var(--card);color:var(--ink);min-height:44px}
button.ok{background:var(--ok);border-color:var(--ok);color:#fff}button.no{color:var(--no);border-color:var(--no)}button.pick{border-color:var(--accent)}
button:disabled{opacity:.5}textarea,input{font:inherit;width:100%;padding:10px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
details{margin-top:6px}summary{color:var(--muted);font-size:13px}.msg{padding:6px 0;border-top:1px solid var(--line);font-size:14px}.msg b{font-weight:600}
.err{color:var(--no);margin:8px 0}.quiet{color:var(--muted);text-align:center;margin:40px 0}
</style></head><body>
<h1>LosPeritos</h1><div id="err" class="err"></div><div id="app"></div>
<script>
const tr = (navigator.language || "").toLowerCase().startsWith("tr");
const L = tr
  ? {seal:"Mühür bekliyor",ask:"Soru",approve:"Mühürle",reject:"Reddet",send:"Gönder",answer:"Yanıtın…",write:"Baş Perito'ya yaz…",working:n=>n+" perito çalışıyor",idle:"bekleyen yok",recent:"Son yazışmalar",none:"Açık büro yok.",steps:"Adımlar",irreversible:"Geri alınamaz",you:"Sen",lost:"Bağlantı yok; yeniden deneniyor…",sure:"Bu geri alınamaz. Mühürlensin mi?",rec:" (önerilen)"}
  : {seal:"Waiting for your seal",ask:"Question",approve:"Seal",reject:"Refuse",send:"Send",answer:"Your answer…",write:"Write to the lead…",working:n=>n+" working",idle:"nothing waiting",recent:"Recent correspondence",none:"No bureau is open.",steps:"Steps",irreversible:"Cannot be undone",you:"You",lost:"No connection; trying again…",sure:"This cannot be undone. Seal it?",rec:" (recommended)"};
const base = location.pathname.replace(/\/$/, "");
const app = document.getElementById("app"), errBox = document.getElementById("err");
let last = "", typing = false, known = -1;
const el = (tag, props, ...kids) => { const node = Object.assign(document.createElement(tag), props || {}); for (const kid of kids) if (kid != null) node.append(kid); return node; };
async function call(path, payload) {
  const res = await fetch(base + path, payload ? {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)} : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
async function act(button, path, payload) {
  button.disabled = true;
  try { render(await call(path, payload), true); errBox.textContent = ""; } catch (e) { errBox.textContent = e.message; button.disabled = false; }
}
function render(state, force) {
  const text = JSON.stringify(state);
  if (!force && (text === last || typing)) return;
  last = text;
  const waiting = state.bureaus.reduce((n, b) => n + b.questions.length + b.seals.length, 0);
  document.title = (waiting ? "(" + waiting + ") " : "") + "LosPeritos";
  if (known >= 0 && waiting > known && navigator.vibrate) navigator.vibrate(200);
  known = waiting;
  app.replaceChildren();
  if (!state.bureaus.length) return void app.append(el("p", {className:"quiet", textContent:L.none}));
  for (const b of state.bureaus) {
    app.append(el("h2", null, b.name, el("small", {textContent: b.working ? L.working(b.working) : (b.questions.length + b.seals.length ? "" : L.idle)})));
    for (const s of b.seals) {
      const ok = el("button", {className:"ok", textContent:L.approve}), no = el("button", {className:"no", textContent:L.reject});
      ok.onclick = () => { if (s.reversible || confirm(L.sure)) act(ok, "/decide", {id:s.id, decision:"approved"}); };
      no.onclick = () => act(no, "/decide", {id:s.id, decision:"rejected"});
      app.append(el("div", {className:"card"},
        el("div", {className:"kind", textContent:L.seal + " · " + s.kind + (s.from ? " · " + s.from : "") + (s.reversible ? "" : " · " + L.irreversible)}),
        el("div", {className:"title", textContent:s.title}),
        s.detail ? el("div", {className:"body muted", textContent:s.detail}) : null,
        s.steps.length ? el("details", null, el("summary", {textContent:L.steps + " (" + s.steps.length + ")"}), el("ol", null, ...s.steps.map(step => el("li", {textContent:step})))) : null,
        el("div", {className:"row"}, ok, no)));
    }
    for (const q of b.questions) {
      const box = el("textarea", {rows:2, placeholder:L.answer}), go = el("button", {className:"ok", textContent:L.send});
      box.onfocus = () => typing = true; box.onblur = () => typing = false;
      go.onclick = () => box.value.trim() && act(go, "/answer", {id:q.id, answer:box.value});
      app.append(el("div", {className:"card"},
        el("div", {className:"kind", textContent:L.ask + (q.from ? " · " + q.from : "")}),
        el("div", {className:"body", textContent:q.body}),
        el("div", {className:"row"}, ...q.options.map(option => { const pick = el("button", {className: option === q.recommended ? "pick" : "", textContent: option + (option === q.recommended ? L.rec : "")}); pick.onclick = () => act(pick, "/answer", {id:q.id, answer:option}); return pick; })),
        el("div", {className:"row"}, box, go)));
    }
    const say = el("input", {placeholder:L.write}), send = el("button", {textContent:L.send});
    say.onfocus = () => typing = true; say.onblur = () => typing = false;
    send.onclick = () => say.value.trim() && act(send, "/say", {bureau:b.id, body:say.value});
    app.append(el("details", null, el("summary", {textContent:L.recent}),
      ...b.recent.map(m => el("div", {className:"msg"}, el("b", {textContent:(m.from === "you" ? L.you : m.from || "LosPeritos") + ": "}), m.body)),
      el("div", {className:"row"}, say, send)));
  }
}
async function tick() {
  try { render(await call("/state")); if (errBox.textContent === L.lost) errBox.textContent = ""; } catch (e) { errBox.textContent = L.lost; }
  setTimeout(tick, document.hidden ? 15000 : 4000);
}
tick();
</script></body></html>`;
