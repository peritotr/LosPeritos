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
  /** A PNG (base64) of a rectangle of the window, in CSS pixels; null if it could not be taken. */
  capture: (rect) => ipcRenderer.invoke("losperitos:capture", rect),
  /** Present when this app can fetch a newer release and replace itself with it. */
  ...(arg("self-update") && {
    update: {
      state: () => ipcRenderer.invoke("losperitos:update-state"),
      check: () => ipcRenderer.invoke("losperitos:update-check"),
      install: () => ipcRenderer.invoke("losperitos:update-install"),
      /** Calls back whenever the state changes; returns a function that stops it. */
      onState: (listener) => {
        const handler = (_event, state) => listener(state);
        ipcRenderer.on("losperitos:update", handler);
        return () => ipcRenderer.removeListener("losperitos:update", handler);
      },
    },
  }),
});
