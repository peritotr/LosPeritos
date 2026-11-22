import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, net, powerSaveBlocker, protocol, shell } from "electron";
import { startCore, type RunningCore } from "@losperitos/core";

/**
 * The desktop shell. It starts the core inside this process, opens one window
 * on the built UI, and gives the UI a native folder picker. All product logic
 * lives in the core and the UI; nothing here should grow beyond glue.
 *
 *   --fake    scripted agents and a demo bureau; spends nothing
 *   --smoke   load, report what rendered as JSON, save a screenshot, quit
 *   --shots   run the steps in the file named by LP_SHOT_STEPS, saving a screenshot after each, quit
 *
 * LP_DATA_DIR overrides where machine-level state is kept.
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
/** Point the window at a running Vite dev server instead of the built UI. */
const devUrl = process.env.LP_UI_DEV_URL;

// The UI is served from app://ui/… rather than file://, so that fetch() and
// relative URLs behave as they do on a web server.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * A Mac app started from the Dock gets a bare PATH, without Homebrew or npm's
 * global bin, so `claude` and `git` would not be found. Take PATH from the
 * user's login shell instead.
 */
function adoptShellPath(): void {
  if (process.platform !== "darwin") return;
  try {
    const out = execFileSync(process.env.SHELL ?? "/bin/zsh", ["-ilc", 'printf "__LP__%s__LP__" "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const found = /__LP__(.*)__LP__/s.exec(out)?.[1];
    if (found) process.env.PATH = found;
  } catch {
    // Keep the PATH we were given; Setup will show which tools are missing.
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
      additionalArguments: [`--lp-core-url=${core.url}`, `--lp-token=${core.token}`],
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
 */
async function runShots(target: BrowserWindow): Promise<void> {
  const steps = JSON.parse(readFileSync(process.env.LP_SHOT_STEPS!, "utf8")) as Array<{ run: string; waitMs: number; file: string }>;
  for (const step of steps) {
    await target.webContents.executeJavaScript(step.run);
    await new Promise((done) => setTimeout(done, step.waitMs));
    writeFileSync(step.file, (await target.webContents.capturePage()).toPNG());
    console.log("SHOT " + step.file);
  }
  app.quit();
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
