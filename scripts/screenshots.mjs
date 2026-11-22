// Regenerates the screenshots in docs/ from the demo: English, light theme,
// a fresh demo bureau. Run `npm run build:all` first, then: node scripts/screenshots.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const docs = join(root, "docs");
const work = mkdtempSync(join(tmpdir(), "lp-shots-"));
const electron = createRequire(join(root, "apps/desktop/package.json"))("electron");

/** Click the first button whose text starts with the given words. */
const click = (text) =>
  `[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click(); true`;

const steps = [
  {
    // English, light, correspondence open; then reload so the choices take effect.
    run: `localStorage.setItem("losperitos.lang", "en"); localStorage.setItem("losperitos.theme", "light");
          localStorage.setItem("losperitos.chat", "open"); location.reload(); true`,
    waitMs: 3000,
    file: join(work, "discard.png"),
  },
  { run: click("Run the demo job"), waitMs: 12000, file: join(docs, "screenshot-bench.png") },
  { run: click("Awaiting you"), waitMs: 1500, file: join(docs, "screenshot-awaiting.png") },
  { run: click("Files"), waitMs: 1500, file: join(docs, "screenshot-files.png") },
  {
    run: `localStorage.setItem("losperitos.theme", "dark"); location.reload(); true`,
    waitMs: 4000,
    file: join(docs, "screenshot-dark.png"),
  },
];
const stepsFile = join(work, "steps.json");
writeFileSync(stepsFile, JSON.stringify(steps));

const result = spawnSync(electron, [join(root, "apps/desktop"), "--fake", "--shots"], {
  stdio: "inherit",
  env: { ...process.env, LP_SHOT_STEPS: stepsFile, LP_DATA_DIR: join(work, "data") },
  timeout: 120_000,
});
process.exit(result.status ?? 1);
