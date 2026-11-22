// Runs in the window before the UI, in an isolated world. It hands the UI the
// two things it cannot know by itself (where the core listens, and its token)
// and one thing only the shell can do (the native folder picker).
// Plain CommonJS on purpose: sandboxed preload scripts cannot be ES modules.
const { contextBridge, ipcRenderer } = require("electron");

const arg = (name) => {
  const prefix = `--lp-${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
};

contextBridge.exposeInMainWorld("losperitos", {
  coreUrl: arg("core-url"),
  token: arg("token"),
  platform: process.platform,
  /** Resolves to the chosen folder's path, or null if the dialog was cancelled. */
  pickFolder: () => ipcRenderer.invoke("losperitos:pick-folder"),
});
