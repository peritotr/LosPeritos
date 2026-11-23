import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, autoUpdater, BrowserWindow, dialog, ipcMain, net, powerSaveBlocker, protocol, shell } from "electron";
import { startCore, type RunningCore } from "@losperitos/core";

/**
 * The desktop shell. It starts the core inside this process, opens one window
 * on the built UI, and gives the UI a native folder picker. All product logic
 * lives in the core and the UI; nothing here should grow beyond glue.
 *
 *   --fake    scripted agents and a demo bureau; spends nothing
 *   --smoke   load, report what rendered as JSON, save a screenshot, quit
 *   --self-update   check for a newer release at once, say what happens, install it and quit
 *   --shots   run the steps in the file named by LP_SHOT_STEPS, saving a screenshot after each, quit
 *
 * LP_DATA_DIR overrides where machine-level state is kept.
 * LP_UPDATE_FEED overrides where newer releases are looked for.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
// Run from source, the pieces live across the monorepo; a packaged app carries
// them side by side in its own folder (see scripts/package-desktop.mjs).
const packaged = app.isPackaged;
const root = packaged ? app.getAppPath() : join(here, "..");
const uiDir = packaged ? join(root, "ui") : join(root, "../ui/dist");
const cliEntry = packaged ? join(root, "cli/main.js") : join(root, "../../packages/cli/dist/main.js");
const preload = join(root, "preload.cjs");
/** The app icon; see assets/README.md. */
const icon = packaged ? join(root, "icon.png") : join(root, "assets/icon.png");
const fake = process.argv.includes("--fake");
const smoke = process.argv.includes("--smoke");
const shots = process.argv.includes("--shots");
const selfUpdateNow = process.argv.includes("--self-update");
/**
 * A list of releases kept as a file beside the newest release on GitHub; see
 * scripts/package-desktop.mjs. Only a packaged Mac app can replace itself.
 */
const updateFeed = process.env.LP_UPDATE_FEED ?? "https://github.com/peritotr/LosPeritos/releases/latest/download/releases.json";
const canSelfUpdate = app.isPackaged && process.platform === "darwin";
/** Point the window at a running Vite dev server instead of the built UI. */
const devUrl = process.env.LP_UI_DEV_URL;

// The UI is served from app://ui/… rather than file://, so that fetch() and
// relative URLs behave as they do on a web server.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * What an agent tool reads from the environment to know who the user is and
 * how to reach its service: a key or token, the provider it is pointed at, a
 * proxy, a company's certificates. Someone who set these in their shell's
 * profile has a `claude` that works in the terminal and nowhere else.
 */
const SHELL_SETTINGS = /^(ANTHROPIC_|CLAUDE_|AWS_|GOOGLE_|CLOUD_ML_|VERTEX_|OPENAI_|CODEX_|HTTPS?_PROXY$|NO_PROXY$|ALL_PROXY$|https?_proxy$|no_proxy$|NODE_EXTRA_CA_CERTS$|SSL_CERT_|XDG_CONFIG_HOME$)/;

/**
 * A Mac app started from the Dock gets a bare environment: a PATH without
 * Homebrew or npm's global bin, so `claude` and `git` would not be found, and
 * none of what the user's shell profile sets. Take PATH from the login shell,
 * and with it the settings an agent tool signs in by.
 */
function adoptShellPath(): void {
  if (process.platform !== "darwin") return;
  try {
    const out = execFileSync(process.env.SHELL ?? "/bin/zsh", ["-ilc", 'printf "__LP__"; env -0; printf "__LP__"'], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const listed = /__LP__([\s\S]*)__LP__/.exec(out)?.[1] ?? "";
    for (const entry of listed.split("\0")) {
      const cut = entry.indexOf("=");
      if (cut <= 0) continue;
      const name = entry.slice(0, cut);
      const value = entry.slice(cut + 1);
      if (name === "PATH" && value) process.env.PATH = value;
      // What the app was started with wins: only what is missing is taken from the shell.
      else if (SHELL_SETTINGS.test(name) && process.env[name] === undefined) process.env[name] = value;
    }
  } catch {
    // Keep the environment we were given; Setup will show what is missing.
  }
}

const trace = (step: string) => process.env.LP_TRACE && console.log("[trace]", step);
let running: RunningCore | undefined;
let window: BrowserWindow | undefined;

/**
 * Stop the computer from sleeping while any agent is at work, and let it
 * sleep again when all are done or waiting on the user. The display may
 * still turn off.
 */
function keepAwakeWhileWorking({ core }: RunningCore): void {
  const working = new Set<string>();
  let blocker: number | null = null;
  core.subscribe(({ event }) => {
    if (event.type !== "agent.updated") return;
    if (event.agent.status === "working") working.add(event.agent.id);
    else working.delete(event.agent.id);
    if (working.size > 0 && blocker === null) blocker = powerSaveBlocker.start("prevent-app-suspension");
    if (working.size === 0 && blocker !== null) {
      powerSaveBlocker.stop(blocker);
      blocker = null;
    }
  });
}

async function openWindow(core: RunningCore): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: !smoke && !shots,
    title: "LosPeritos",
    ...(existsSync(icon) && { icon }),
    backgroundColor: "#f2f2f3",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--lp-core-url=${core.url}`, `--lp-token=${core.token}`, ...(canSelfUpdate ? ["--lp-self-update=1"] : [])],
    },
  });
  // The window shows this app and nothing else: links open in the browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(devUrl ?? "app://ui/")) event.preventDefault();
  });
  // The preview shows the user's own dev server in a frame. A local server that
  // forbids framing is still theirs to look at; sites elsewhere keep their say.
  window.webContents.session.webRequest.onHeadersReceived({ urls: ["http://localhost/*", "http://127.0.0.1/*", "http://[::1]/*", "https://localhost/*"] }, (details, respond) => {
    const headers = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {})
        .filter(([name]) => name.toLowerCase() !== "x-frame-options")
        .map(([name, values]) => [
          name,
          name.toLowerCase() === "content-security-policy" ? values.map((value) => value.replace(/frame-ancestors[^;]*;?/gi, "")) : values,
        ]),
    );
    respond({ responseHeaders: headers });
  });
  window.on("closed", () => (window = undefined));
  trace("loading UI");
  await window.loadURL(devUrl ?? "app://ui/index.html");
  trace("UI loaded");
  if (smoke) await runSmoke(window);
  if (shots) await runShots(window);
}

/**
 * Take the screenshots the documentation uses. The steps file is a JSON list of
 * `{ run, waitMs, file }`: run some JavaScript in the page, wait, save the window.
 * If the JavaScript returns `{ x, y, width, height }`, only that part is saved.
 */
async function runShots(target: BrowserWindow): Promise<void> {
  const steps = JSON.parse(readFileSync(process.env.LP_SHOT_STEPS!, "utf8")) as Array<{ run: string; waitMs: number; file: string }>;
  for (const step of steps) {
    const area = (await target.webContents.executeJavaScript(step.run)) as { x: number; y: number; width: number; height: number } | null;
    await new Promise((done) => setTimeout(done, step.waitMs));
    const image = area?.width ? await target.webContents.capturePage(area) : await target.webContents.capturePage();
    writeFileSync(step.file, image.toPNG());
    console.log("SHOT " + step.file);
  }
  app.quit();
}

/** Where a self-update stands; `version` is known once it has been downloaded. */
type UpdateState = { state: "idle" | "checking" | "downloading" | "ready" | "current" | "failed"; version?: string; error?: string };
let updateState: UpdateState = { state: "idle" };

/**
 * Let the app fetch a newer release and replace itself with it on restart.
 * The UI decides when to look (the user can switch looking off) and when to
 * restart; nothing is installed while the app is in use.
 */
function setUpSelfUpdate(): void {
  const tell = (next: UpdateState) => {
    updateState = next;
    window?.webContents.send("losperitos:update", next);
    if (selfUpdateNow) console.log("UPDATE " + JSON.stringify(next));
  };
  ipcMain.handle("losperitos:update-state", () => updateState);
  ipcMain.handle("losperitos:update-check", () => {
    if (canSelfUpdate && updateState.state !== "checking" && updateState.state !== "downloading" && updateState.state !== "ready") {
      autoUpdater.checkForUpdates();
    }
  });
  ipcMain.handle("losperitos:update-install", () => {
    if (updateState.state === "ready") autoUpdater.quitAndInstall();
  });
  if (!canSelfUpdate) return;
  try {
    autoUpdater.setFeedURL({ url: updateFeed, serverType: "json" });
  } catch (err) {
    tell({ state: "failed", error: (err as Error).message });
    return;
  }
  autoUpdater.on("checking-for-update", () => tell({ state: "checking" }));
  autoUpdater.on("update-available", () => tell({ state: "downloading" }));
  autoUpdater.on("update-not-available", () => {
    tell({ state: "current" });
    if (selfUpdateNow) app.quit();
  });
  autoUpdater.on("update-downloaded", (_event, _notes, name) => {
    tell({ state: "ready", version: name });
    // Quitting is enough: the fetched release is put in place once the app has gone.
    if (selfUpdateNow) app.quit();
  });
  autoUpdater.on("error", (err) => {
    tell({ state: "failed", error: err.message });
    if (selfUpdateNow) app.exit(1);
  });
  if (selfUpdateNow) autoUpdater.checkForUpdates();
}

/** Check that the UI came up and is talking to the core, then quit. */
async function runSmoke(target: BrowserWindow): Promise<void> {
  await new Promise((done) => setTimeout(done, 4000));
  const report = await target.webContents.executeJavaScript(`({
    title: document.querySelector("h2")?.textContent ?? null,
    bureau: document.querySelector(".topbar h1")?.textContent ?? null,
    desks: document.querySelectorAll(".scene .desk").length,
    canvas: !!document.querySelector(".sprite-layer"),
    furnished: document.querySelector(".sprite-layer")?.dataset.desks ?? null,
    hasPicker: typeof window.losperitos?.pickFolder === "function",
    offline: !!document.querySelector(".banner"),
  })`);
  const shot = join(app.getPath("temp"), "losperitos-smoke.png");
  writeFileSync(shot, (await target.webContents.capturePage()).toPNG());
  console.log("SMOKE " + JSON.stringify({ ...report, screenshot: shot }));
  app.quit();
}

// The demo keeps its own window state and its own lock, apart from the real app's: a demo or a
// screenshot run can then be started while the app is open, and leaves the app's settings alone.
if (fake || process.env.LP_USER_DATA) app.setPath("userData", process.env.LP_USER_DATA ?? join(app.getPath("appData"), "LosPeritos Demo"));
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });

  // Not a top-level await: with an ES-module entry point Electron only fires
  // "ready" once this file has finished evaluating, so awaiting it here would
  // wait forever.
  void app.whenReady().then(start);
}

async function start(): Promise<void> {
  trace("ready");
  adoptShellPath();
  trace("path adopted");
  if (existsSync(icon)) app.dock?.setIcon(icon);

  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const file = normalize(join(uiDir, decodeURIComponent(pathname)));
    // Never serve anything outside the UI folder.
    if (!file.startsWith(uiDir + sep)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(extname(file) ? file : join(file, "index.html")).toString());
  });

  setUpSelfUpdate();
  // A picture of part of the window, for "fix this here" in the preview. Only the app's own page can ask.
  ipcMain.handle("losperitos:capture", async (_event, rect: { x: number; y: number; width: number; height: number }) => {
    if (!window || ![rect?.x, rect?.y, rect?.width, rect?.height].every((value) => Number.isFinite(value)) || rect.width < 1 || rect.height < 1) return null;
    const area = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    return (await window.webContents.capturePage(area)).toPNG().toString("base64");
  });
  // Show a file or a folder in Finder. Only something that exists is shown; nothing is opened or run.
  ipcMain.handle("losperitos:reveal", (_event, path: string) => {
    if (typeof path !== "string" || !path.startsWith("/") || !existsSync(path)) return;
    shell.showItemInFolder(path);
  });
  ipcMain.handle("losperitos:pick-folder", async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  const dataDir = process.env.LP_DATA_DIR ?? join(homedir(), fake ? ".losperitos-demo" : ".losperitos");
  try {
    running = await startCore({ dataDir, fake, cliEntry });
  } catch (err) {
    dialog.showErrorBox("LosPeritos could not start", (err as Error).message);
    app.exit(1);
  }
  trace("core started");
  if (running) {
    if (fake) {
      // The demo always has a bureau to look at.
      const folder = join(dataDir, "workspace");
      mkdirSync(folder, { recursive: true });
      running.core.openWorkspace(folder);
    }
    keepAwakeWhileWorking(running);
    await openWindow(running);
    app.on("activate", () => {
      if (!window && running) void openWindow(running);
    });
  }

  // Agents are child processes of the core: stop them before the app exits.
  let stopping = false;
  app.on("before-quit", (event) => {
    if (stopping || !running) return;
    event.preventDefault();
    stopping = true;
    void running.close().finally(() => app.quit());
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
