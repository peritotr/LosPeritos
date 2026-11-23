import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// `scripts/dev.mjs` passes the core's address and token; a packaged shell
// will inject them instead. Without them the UI asks for the token.
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so the same build works from a dev server and inside the desktop app.
  base: "./",
  define: {
    __CORE_URL__: JSON.stringify(process.env.LP_CORE_URL ?? "http://127.0.0.1:7420"),
    __CORE_TOKEN__: JSON.stringify(process.env.LP_CORE_TOKEN ?? ""),
    __APP_VERSION__: JSON.stringify(version),
  },
  server: { port: 5173, strictPort: true },
});
