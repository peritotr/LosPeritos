// Starts a packaged LosPeritos with the demo bureau, runs the demo job and saves two pictures of
// the window, then checks that they hold something. It shows that a package opens on the system
// that built it: node scripts/smoke-packaged.mjs <path to the app's executable> <folder for pictures>
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [exe, outDir = "smoke"] = process.argv.slice(2);
if (!exe) throw new Error("Say which executable to start.");
const out = resolve(outDir);
mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "lp-smoke-"));

const click = (text) => `[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click(); null`;
const steps = [
  { run: `localStorage.setItem("losperitos.lang", "en"); localStorage.setItem("losperitos.tour", "1"); localStorage.setItem("losperitos.mode", "advanced"); location.reload(); null`, waitMs: 4000, file: join(out, "opened.png") },
  { run: click("Run the demo job"), waitMs: 9000, file: join(out, "demo-job.png") },
];
const stepsFile = join(work, "steps.json");
writeFileSync(stepsFile, JSON.stringify(steps));

const ran = spawnSync(resolve(exe), ["--fake", "--shots"], {
  env: { ...process.env, LP_SHOT_STEPS: stepsFile, LP_DATA_DIR: join(work, "data"), LP_USER_DATA: join(work, "user"), LP_TRACE: "1" },
  encoding: "utf8",
  timeout: 180_000,
});
console.log(ran.stdout);
if (ran.stderr) console.error(ran.stderr);
if (ran.error) throw ran.error;
for (const step of steps) {
  const size = statSync(step.file).size;
  console.log(step.file, size, "bytes");
  if (size < 20_000) throw new Error(`${step.file} is nearly empty: the window showed nothing.`);
}
console.log("The packaged app opened and ran the demo job.");
