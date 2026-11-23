import { useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import {
  Archive as ArchiveIcon,
  Check,
  Files as FilesIcon,
  FileText,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Inbox,
  LayoutGrid,
  MessagesSquare,
  Maximize2,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings as SettingsIcon,
  Sun,
  Wallet,
  Wifi,
  WifiOff,
  Wrench,
  ChevronsDown,
  BookOpen,
  type LucideIcon, SquareTerminal, Eye, Rocket,
} from "lucide-react";
import { Chat } from "./Chat";
import { UpdateNotice, useUpdates } from "./updates";
import { Code } from "./code";
import { Docs } from "./docs";
import { Guides } from "./guides";
import { SitePreview } from "./sitepreview";
import { TerminalScreen } from "./terminal";
import { openQuestions, pendingApprovals, type Ctx, type Route } from "./context";
import { Archive, Awaiting, BudgetBar, Ledger, SealToast, Settings, Setup } from "./screens-desk";
import { Bench, Correspondence, FileDetail, Files, PeritoDetail } from "./screens-work";
import { shell, useCore } from "./store";
import { Tour, tourSeen, useTour } from "./onboarding";
import { T } from "./strings";
import { I, fileRef, kindOf, money, perito } from "./ui";

type Theme = "light" | "dark";
const THEME_KEY = "losperitos.theme";
const BUREAU_KEY = "losperitos.bureau";
const CHAT_KEY = "losperitos.chat";
const MODE_KEY = "losperitos.mode";
/** Screens the plain view leaves out of the side bar. */
const ADVANCED_ONLY: ReadonlySet<string> = new Set(["code", "docs", "guides", "mail", "archive", "ledger"]);

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts for this window only.
  }
}

type NavScreen = "bench" | "files" | "code" | "terminal" | "preview" | "docs" | "guides" | "mail" | "awaiting" | "archive" | "ledger";
const NAV: Array<[NavScreen, string, LucideIcon]> = [
  ["bench", T.nav.bench, LayoutGrid],
  ["files", T.nav.files, FilesIcon],
  ["code", T.nav.code, GitBranch],
  ["terminal", T.nav.terminal, SquareTerminal],
  ["preview", T.nav.preview, Eye],
  ["docs", T.nav.docs, BookOpen],
  ["guides", T.nav.guides, Rocket],
  ["mail", T.nav.correspondence, MessagesSquare],
  ["awaiting", T.nav.awaiting, Inbox],
  ["archive", T.nav.archive, ArchiveIcon],
  ["ledger", T.nav.ledger, Wallet],
];

export function App() {
  const [state, actions] = useCore();
  const [route, setRoute] = useState<Route>({ screen: "bench" });
  const [bureauId, setBureauId] = useState<string | null>(() => stored(BUREAU_KEY));
  const [theme, setThemeState] = useState<Theme>(
    () => (stored(THEME_KEY) as Theme | null) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  // Someone who was here before this choice existed keeps everything they had.
  const [simple, setSimpleState] = useState(() => {
    const mode = stored(MODE_KEY) ?? (tourSeen() ? "advanced" : "simple");
    store(MODE_KEY, mode);
    return mode === "simple";
  });
  const setSimple = (next: boolean) => {
    setSimpleState(next);
    store(MODE_KEY, next ? "simple" : "advanced");
  };
  const updates = useUpdates();
  const [note, setNote] = useState<string | null>(null);
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [toastId, setToastId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [tour, closeTour] = useTour(state.loaded && state.workspaces.length > 0);
  // The correspondence panel stays open across screens; on a narrow window it starts closed.
  const [chatOpen, setChatOpenState] = useState(() => (stored(CHAT_KEY) ?? (innerWidth >= 1280 ? "open" : "closed")) === "open");
  const [composed, setComposed] = useState<{ text: string; n: number; file?: { name: string; data: string } } | null>(null);
  const setChatOpen = (open: boolean) => {
    setChatOpenState(open);
    store(CHAT_KEY, open ? "open" : "closed");
  };
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const bureau = state.workspaces.find((w) => w.id === bureauId) ?? state.workspaces[0];
  const setTheme = (next: Theme) => {
    setThemeState(next);
    store(THEME_KEY, next);
  };
  const pickBureau = (id: string) => {
    setBureauId(id);
    store(BUREAU_KEY, id);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totalWaiting = pendingApprovals(state.approvals).length + openQuestions(state.messages).length;
  const waitingIn = (id: string) =>
    pendingApprovals(state.approvals).filter((a) => a.workspaceId === id).length +
    openQuestions(state.messages).filter((m) => m.workspaceId === id).length;

  // The seal toast: the oldest request the user has not yet put off, shown
  // over every screen except the two where it would be in the way.
  const toastCandidate = pendingApprovals(state.approvals).find((a) => !deferred.has(a.id) && !dismissed.has(a.id));
  useEffect(() => {
    if (!toastId && toastCandidate) setToastId(toastCandidate.id);
  }, [toastId, toastCandidate?.id]);
  const toast = state.approvals.find((a) => a.id === toastId);
  // A request decided on the Awaiting screen has no toast left to show.
  useEffect(() => {
    if (toast && toast.status !== "pending" && route.screen === "awaiting") {
      setDismissed((prev) => new Set(prev).add(toast.id));
      setToastId(null);
    }
  }, [toast?.status, route.screen]);

  if (state.phase === "needs_token") return <TokenGate theme={theme} onSubmit={actions.setToken} />;
  if (!state.loaded) {
    return (
      <div className="lp" data-theme={theme} style={{ height: "100%", display: "grid", placeContent: "center" }}>
        <p className="muted">{state.phase === "offline" ? T.top.offlineBanner : T.top.connecting}</p>
      </div>
    );
  }

  const offline = state.phase === "offline";
  // With no bureau open, every route resolves to Setup.
  const screen: Route = bureau ? route : { screen: "setup" };
  const budget = bureau ? state.budgets[bureau.id] : undefined;

  const ctx: Ctx | null = bureau
    ? {
        state,
        actions,
        bureau,
        agents: state.agents.filter((a) => a.workspaceId === bureau.id),
        tasks: state.tasks.filter((t) => t.workspaceId === bureau.id),
        messages: state.messages.filter((m) => m.workspaceId === bureau.id),
        approvals: state.approvals.filter((a) => a.workspaceId === bureau.id),
        go: setRoute,
        openBureau: pickBureau,
        compose(text, file) {
          setChatOpen(true);
          setComposed((before) => ({ text, file, n: (before?.n ?? 0) + 1 }));
        },
        composed,
        note(text) {
          clearTimeout(noteTimer.current);
          setNote(text);
          noteTimer.current = setTimeout(() => setNote(null), 3200);
        },
        deferred,
        defer: (id) => setDeferred((prev) => new Set(prev).add(id)),
        theme,
        setTheme,
        simple,
        setSimple,
        updates,
      }
    : null;

  const fill = screen.screen === "mail" || screen.screen === "perito" || screen.screen === "terminal" || screen.screen === "preview";
  // The panel would only repeat what Correspondence shows, and Setup has nobody to write to.
  const chatAllowed = !!ctx && screen.screen !== "mail" && screen.screen !== "setup";
  const showChat = chatAllowed && chatOpen;
  const current = (id: NavScreen) =>
    screen.screen === id || (id === "files" && screen.screen === "file") || (id === "bench" && screen.screen === "perito");

  return (
    <MotionConfig reducedMotion="user">
      <div className={`lp shell ${showChat ? "with-chat" : ""}`} data-theme={theme}>
        <nav className="sidebar" aria-label="Primary">
          <div className="brand">
            <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" width={28} height={28} />
            {T.brand}
          </div>
          <div className="side-label">{T.nav.bureaus}</div>
          {state.workspaces.map((workspace) => (
            <button
              key={workspace.id}
              className="nav-row bureau"
              aria-current={workspace.id === bureau?.id}
              title={workspace.path}
              onClick={() => pickBureau(workspace.id)}
            >
              <I icon={FolderOpen} size={16} />
              <span className="grow ellipsis">{workspace.name}</span>
              {waitingIn(workspace.id) > 0 && (
                <span className="count" title={T.nav.awaiting}>
                  {waitingIn(workspace.id)}
                </span>
              )}
            </button>
          ))}
          {state.workspaces.length === 0 && (
            <div className="muted" style={{ margin: "2px 16px 6px", fontSize: 13 }}>
              {T.nav.noBureaus}
            </div>
          )}
          <button
            className="btn btn-ghost"
            style={{ margin: "4px 12px 0", justifyContent: "flex-start", font: "13px var(--font-body)", gap: 8 }}
            onClick={() => setRoute({ screen: "setup" })}
          >
            <I icon={FolderPlus} />
            {T.nav.openBureau}
          </button>

          <div className="side-label">{T.nav.panel}</div>
          {NAV.filter(([id]) => (!simple || !ADVANCED_ONLY.has(id)) && (id !== "code" || (bureau && kindOf(bureau) === "software"))).map(([id, label, icon]) => (
            <button
              key={id}
              className="nav-row"
              disabled={!bureau}
              aria-current={current(id) ? "page" : undefined}
              onClick={() => setRoute({ screen: id })}
            >
              <I icon={icon} size={16} />
              <span className="grow">{label}</span>
              {id === "awaiting" && totalWaiting > 0 && <span className="count">{totalWaiting}</span>}
            </button>
          ))}
          {simple && (
            <button className="nav-row nav-more" onClick={() => setSimple(false)}>
              <I icon={ChevronsDown} size={16} />
              {T.mode.showAll}
            </button>
          )}
          <span className="grow" />
          <button
            className="nav-row"
            aria-current={screen.screen === "setup" ? "page" : undefined}
            onClick={() => setRoute({ screen: "setup" })}
          >
            <I icon={Wrench} size={16} />
            {T.nav.setup}
          </button>
          <button
            className="nav-row"
            disabled={!bureau}
            aria-current={screen.screen === "settings" ? "page" : undefined}
            onClick={() => setRoute({ screen: "settings" })}
          >
            <I icon={SettingsIcon} size={16} />
            {T.nav.settings}
          </button>
          <UpdateNotice updates={updates} />
          <div className="side-foot">{T.footer}</div>
        </nav>

        <div className="main">
          <header className="topbar">
            <h1 className="ellipsis">{bureau?.name ?? T.top.noBureau}</h1>
            {bureau && (
              <span className="chip" title={bureau.path}>
                <I icon={GitBranch} size={13} />
                <span className="ellipsis">{bureau.repos[0]?.branch ?? (kindOf(bureau) === "software" ? T.top.noBranch : T.kinds[kindOf(bureau)].name)}</span>
              </span>
            )}
            <span className="grow" />
            {budget && (
              <button className="spend" onClick={() => setRoute({ screen: "ledger" })} title={T.nav.ledger}>
                {money(budget.spentUsd)}
                {budget.limitUsd !== null && ` / ${money(budget.limitUsd)}`}
                {budget.limitUsd !== null && <BudgetBar spent={budget.spentUsd} limit={budget.limitUsd} mini />}
              </button>
            )}
            <span className="row" style={{ gap: 6, fontSize: 12, color: offline ? "var(--st-err)" : "var(--lp-muted)" }}>
              <I icon={offline ? WifiOff : Wifi} />
              {offline ? T.top.offline : T.top.local}
            </span>
            <button className="btn btn-secondary" onClick={() => setPalette(true)}>
              <I icon={Search} size={14} />
              {T.top.search}
              <kbd>{(shell?.platform ?? navigator.platform).toLowerCase().includes("mac") || shell?.platform === "darwin" ? "⌘K" : "Ctrl K"}</kbd>
            </button>
            {chatAllowed && (
              <button
                className="btn btn-secondary btn-icon"
                aria-label={chatOpen ? T.chat.hide : T.chat.show}
                aria-pressed={chatOpen}
                title={chatOpen ? T.chat.hide : T.chat.show}
                onClick={() => setChatOpen(!chatOpen)}
              >
                <I icon={chatOpen ? PanelRightClose : PanelRightOpen} />
              </button>
            )}
            <button
              className="btn btn-secondary btn-icon"
              aria-label={T.top.theme}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              <I icon={theme === "light" ? Moon : Sun} />
            </button>
          </header>

          {offline && (
            <div className="banner" role="alert">
              <I icon={WifiOff} size={16} />
              <span className="grow">{T.top.offlineBanner}</span>
              <button className="btn btn-secondary" onClick={actions.reconnect}>
                {T.top.retry}
              </button>
            </div>
          )}

          <main className={`content ${fill ? "fill" : ""}`}>
            {!ctx || screen.screen === "setup" ? (
              <Setup
                ctx={{ actions }}
                firstRun={state.workspaces.length === 0}
                onOpened={(workspace) => {
                  pickBureau(workspace.id);
                  setRoute({ screen: "bench" });
                }}
              />
            ) : screen.screen === "bench" ? (
              <Bench {...ctx} />
            ) : screen.screen === "files" ? (
              <Files {...ctx} />
            ) : screen.screen === "file" ? (
              <FileDetail ctx={ctx} id={screen.id} />
            ) : screen.screen === "mail" ? (
              <Correspondence {...ctx} />
            ) : screen.screen === "perito" ? (
              <PeritoDetail ctx={ctx} id={screen.id} />
            ) : screen.screen === "awaiting" ? (
              <Awaiting ctx={ctx} selectedId={screen.id} />
            ) : screen.screen === "archive" ? (
              <Archive {...ctx} />
            ) : screen.screen === "docs" ? (
              <Docs {...ctx} />
            ) : screen.screen === "code" ? (
              <Code {...ctx} />
            ) : screen.screen === "terminal" ? (
              <TerminalScreen {...ctx} />
            ) : screen.screen === "preview" ? (
              <SitePreview ctx={ctx} url={screen.url} />
            ) : screen.screen === "guides" ? (
              <Guides {...ctx} />
            ) : screen.screen === "ledger" ? (
              <Ledger {...ctx} />
            ) : (
              <Settings {...ctx} />
            )}
          </main>

          {ctx && toast && !showChat && screen.screen !== "awaiting" && screen.screen !== "setup" && (
            <SealToast
              key={toast.id}
              ctx={ctx}
              approval={toast}
              onLeave={() => {
                setDismissed((prev) => new Set(prev).add(toast.id));
                setToastId(null);
              }}
            />
          )}
          {note && (
            <div className="note" role="status">
              <I icon={Check} />
              {note}
            </div>
          )}
        </div>

        {showChat && ctx && (
          <aside className="chat-panel" aria-label={T.chat.title}>
            <header>
              <h3 className="grow">{T.chat.title}</h3>
              <button className="btn btn-ghost btn-icon" aria-label={T.chat.full} title={T.chat.full} onClick={() => setRoute({ screen: "mail" })}>
                <I icon={Maximize2} size={14} />
              </button>
              <button className="btn btn-ghost btn-icon" aria-label={T.chat.hide} title={T.chat.hide} onClick={() => setChatOpen(false)}>
                <I icon={PanelRightClose} />
              </button>
            </header>
            <Chat ctx={ctx} onPickAgent={(id) => setRoute({ screen: "perito", id })} />
          </aside>
        )}

        {tour && <Tour onClose={closeTour} />}
        {palette && (
          <Palette
            ctx={ctx}
            bureaus={state.workspaces.map((w) => ({ id: w.id, name: w.name }))}
            onBureau={pickBureau}
            onRoute={setRoute}
            onTheme={() => setTheme(theme === "light" ? "dark" : "light")}
            onClose={() => setPalette(false)}
          />
        )}
      </div>
    </MotionConfig>
  );
}

function TokenGate({ theme, onSubmit }: { theme: Theme; onSubmit(token: string): void }) {
  const [value, setValue] = useState("");
  return (
    <div className="lp" data-theme={theme} style={{ height: "100%", display: "grid", placeContent: "center" }}>
      <form
        className="panel blueprint"
        style={{ width: 440 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit(value);
        }}
      >
        <h3>{T.gate.title}</h3>
        <p className="muted">{T.gate.body}</p>
        <input
          className="input mono"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label={T.gate.label}
          autoFocus
        />
        <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
          {T.gate.connect}
        </button>
      </form>
    </div>
  );
}

// ── Command palette ────────────────────────────────────────────────────────

interface Entry {
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run(): void;
}

function Palette({
  ctx,
  bureaus,
  onBureau,
  onRoute,
  onTheme,
  onClose,
}: {
  ctx: Ctx | null;
  bureaus: Array<{ id: string; name: string }>;
  onBureau(id: string): void;
  onRoute(route: Route): void;
  onTheme(): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const entries = useMemo<Entry[]>(() => {
    const all: Entry[] = [
      ...bureaus.map((b) => ({ group: T.palette.bureaus, label: b.name, icon: FolderOpen, run: () => onBureau(b.id) })),
      ...(ctx
        ? NAV.map(([id, label, icon]) => ({
            group: T.palette.actions,
            label: T.palette.goTo(label),
            icon,
            run: () => onRoute({ screen: id }),
          }))
        : []),
      { group: T.palette.actions, label: T.nav.openBureau, icon: FolderPlus, run: () => onRoute({ screen: "setup" }) },
      { group: T.palette.actions, label: T.palette.toggleTheme, icon: Sun, run: onTheme },
      ...(ctx?.tasks ?? []).map((task) => ({
        group: T.palette.files,
        label: task.title,
        hint: fileRef(task),
        icon: FileText,
        run: () => onRoute({ screen: "file", id: task.id }),
      })),
      ...(ctx?.agents ?? []).map((agent) => ({
        group: T.palette.peritos,
        label: perito(agent, ctx!.agents).who,
        hint: perito(agent, ctx!.agents).tool,
        icon: LayoutGrid,
        run: () => onRoute({ screen: "perito", id: agent.id }),
      })),
    ];
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((entry) => `${entry.label} ${entry.hint ?? ""}`.toLowerCase().includes(needle)) : all;
  }, [query, ctx, bureaus]);

  const run = (entry: Entry | undefined) => {
    if (!entry) return;
    entry.run();
    onClose();
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="palette blueprint"
        role="dialog"
        aria-label={T.top.search}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(entries.length - 1, index + 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          }
          if (event.key === "Enter") run(entries[active]);
        }}
      >
        <div className="palette-search">
          <I icon={Search} size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder={T.palette.placeholder}
            aria-label={T.palette.placeholder}
          />
        </div>
        <div className="palette-list" role="listbox">
          {entries.length === 0 && (
            <p className="muted" style={{ padding: "14px 16px" }}>
              {T.palette.nothing(query)}
            </p>
          )}
          {entries.map((entry, index) => (
            <div key={index}>
              {entries[index - 1]?.group !== entry.group && <div className="palette-group">{entry.group}</div>}
              <button
                className="palette-row"
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(entry)}
              >
                <I icon={entry.icon} />
                <span className="grow ellipsis">{entry.label}</span>
                {entry.hint && (
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {entry.hint}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
        <div className="palette-foot">{T.palette.foot}</div>
      </div>
    </div>
  );
}
