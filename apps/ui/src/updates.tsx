/**
 * Newer releases. Once a day the app asks GitHub whether one is out. The
 * packaged Mac app fetches it and installs it when the user restarts; anywhere
 * else the user is told and given the link. This is the one request the app
 * makes to anything but the local core, so it can be switched off, and says
 * so where it is switched.
 */
import { useEffect, useState } from "react";
import { Download, RotateCw, X } from "lucide-react";
import { shell, type SelfUpdate } from "./store";
import { T } from "./strings";
import { I } from "./ui";

declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;

const LATEST = "https://api.github.com/repos/peritotr/LosPeritos/releases/latest";
const ENABLED_KEY = "losperitos.updates";
const SKIPPED_KEY = "losperitos.updates.skipped";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Release {
  version: string;
  /** The release's page, where the download is. */
  url: string;
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts for this page load.
  }
};

/** Whether version `a` is later than `b`, comparing dotted numbers. */
export function newer(a: string, b: string): boolean {
  const parts = (version: string) => version.replace(/^v/, "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let at = 0; at < Math.max(x.length, y.length); at++) {
    if ((x[at] ?? 0) !== (y[at] ?? 0)) return (x[at] ?? 0) > (y[at] ?? 0);
  }
  return false;
}

async function latestRelease(): Promise<Release> {
  const response = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const json = (await response.json()) as { tag_name?: string; html_url?: string };
  if (!json.tag_name || !json.html_url?.startsWith("https://github.com/")) throw new Error("No release found");
  return { version: json.tag_name.replace(/^v/, ""), url: json.html_url };
}

export interface Updates {
  enabled: boolean;
  setEnabled(enabled: boolean): void;
  /** A release later than this app, unless the user waved that one away. */
  available: Release | null;
  /** "current" once a check found nothing newer. */
  state: "idle" | "checking" | "current" | "failed";
  check(): void;
  skip(): void;
  /** In the packaged app: where fetching the newer release stands. Null elsewhere. */
  self: SelfUpdate | null;
  /** Restart into the release that has been fetched. */
  install(): void;
}

export function useUpdates(): Updates {
  const [enabled, setEnabledState] = useState(() => read(ENABLED_KEY) !== "off");
  const [found, setFound] = useState<Release | null>(null);
  const [skipped, setSkipped] = useState(() => read(SKIPPED_KEY));
  const [state, setState] = useState<Updates["state"]>("idle");
  const native = shell?.update;
  const [self, setSelf] = useState<SelfUpdate | null>(native ? { state: "idle" } : null);
  useEffect(() => {
    if (!native) return;
    void native.state().then(setSelf);
    return native.onState(setSelf);
  }, []);
  const check = () => {
    if (native) return void native.check();
    setState("checking");
    latestRelease().then(
      (release) => {
        const later = newer(release.version, APP_VERSION);
        setFound(later ? release : null);
        setState(later ? "idle" : "current");
      },
      () => setState("failed"),
    );
  };
  useEffect(() => {
    if (!enabled) return;
    check();
    const timer = setInterval(check, DAY_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return {
    enabled,
    setEnabled(next) {
      setEnabledState(next);
      write(ENABLED_KEY, next ? "on" : "off");
      if (!next) setFound(null);
    },
    available: found && found.version !== skipped ? found : null,
    state: self ? (self.state === "downloading" || self.state === "ready" ? "idle" : self.state) : state,
    self,
    install: () => void native?.install(),
    check,
    skip() {
      if (!found) return;
      write(SKIPPED_KEY, found.version);
      setSkipped(found.version);
    },
  };
}

/** The line in the side bar that says a newer release is out. */
export function UpdateNotice({ updates }: { updates: Updates }) {
  const release = updates.available;
  if (updates.self?.state === "ready") {
    return (
      <div className="update-notice">
        <button className="grow update-restart" onClick={updates.install}>
          <I icon={RotateCw} size={14} />
          {T.updates.restart(updates.self.version ?? "")}
        </button>
      </div>
    );
  }
  if (updates.self?.state === "downloading") {
    return (
      <div className="update-notice">
        <span className="muted">{T.updates.downloading}</span>
      </div>
    );
  }
  if (!release) return null;
  return (
    <div className="update-notice">
      <a className="grow" href={release.url} target="_blank" rel="noreferrer">
        <I icon={Download} size={14} />
        {T.updates.available(release.version)}
      </a>
      <button className="btn btn-ghost" aria-label={T.updates.skip} title={T.updates.skip} onClick={updates.skip}>
        <I icon={X} size={12} />
      </button>
    </div>
  );
}

/** The switch and the "check now" in Settings. */
export function UpdateSettings({ updates }: { updates: Updates }) {
  return (
    <div className="field">
      <label>{T.updates.label}</label>
      <label className="row" style={{ cursor: "pointer", color: "inherit", fontSize: 13 }}>
        <input type="checkbox" checked={updates.enabled} onChange={(event) => updates.setEnabled(event.target.checked)} />
        <span>{T.updates.toggle}</span>
      </label>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {updates.self ? T.updates.hintSelf : T.updates.hint}
      </p>
      <div className="row wrap" style={{ fontSize: 13 }}>
        <span className="mono muted">{T.updates.version(APP_VERSION)}</span>
        <button className="btn btn-ghost" disabled={updates.state === "checking"} onClick={updates.check}>
          {T.updates.check}
        </button>
        {updates.self?.state === "ready" ? (
          <button className="btn btn-secondary" onClick={updates.install}>
            {T.updates.restart(updates.self.version ?? "")}
          </button>
        ) : updates.self?.state === "downloading" ? (
          <span className="muted">{T.updates.downloading}</span>
        ) : updates.available ? (
          <a href={updates.available.url} target="_blank" rel="noreferrer">
            {T.updates.available(updates.available.version)}
          </a>
        ) : (
          <span className="muted">
            {updates.state === "checking" ? T.updates.checking : updates.state === "current" ? T.updates.current : updates.state === "failed" ? T.updates.failed : ""}
          </span>
        )}
      </div>
    </div>
  );
}
