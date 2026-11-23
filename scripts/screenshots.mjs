// Regenerates the pictures in docs/ from the demo: English, a fresh demo
// bureau. Run `npm run build:all` first, then: node scripts/screenshots.mjs
//
//   docs/floor.png             the bureau floor in motion (an animated PNG)
//   docs/screenshot-*.png      still screens, light and dark
//   docs/social-preview.png    1280×640 card for the repository's social preview
//   docs/sira-gecesi.png       the sıra gecesi gathering (an animated PNG)
//   docs/berlin.png            Berlin's errand, with a coffee on the way (an animated PNG)
//
// `node scripts/screenshots.mjs --floor-life` redoes only the last two.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPng, writeApng } from "./skins/png.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const docs = join(root, "docs");
const work = mkdtempSync(join(tmpdir(), "lp-shots-"));
const electron = createRequire(join(root, "apps/desktop/package.json"))("electron");

const FRAMES = 30;
const FRAME_MS = 450;

/** Click the first button whose text starts with the given words. */
const click = (text) =>
  `[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click(); null`;
const settings = (values) =>
  Object.entries(values).map(([key, value]) => `localStorage.setItem("losperitos.${key}", "${value}");`).join(" ") + " location.reload(); null";
/** The rectangle of the bureau floor, so only it is captured. */
const floorArea = `(() => { const r = document.querySelector(".floor-stage").getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`;
/** Replace the page with a card built from the app's own fonts and colours. */
const socialCard = `(() => {
  const shot = ${JSON.stringify("data:image/png;base64,")} + window.__shot;
  document.body.innerHTML = \`
    <div style="width:1280px;height:640px;display:flex;align-items:center;gap:48px;padding:0 64px;box-sizing:border-box;
                background:#1d2d3d;color:#e7e7ea;font-family:Barlow,sans-serif;overflow:hidden">
      <div style="flex:none;width:430px">
        <img src="./icon.png" width="128" height="128" style="display:block;margin-bottom:26px">
        <div style="font:600 78px/1 'Barlow Condensed',sans-serif;letter-spacing:-.01em">LosPeritos</div>
        <div style="font-size:27px;line-height:1.35;margin-top:20px;color:#b5d9fd">
          A team of AI coding agents on your own machine. Nothing ships without your seal.</div>
        <div style="font:17px ui-monospace,Menlo,monospace;margin-top:30px;opacity:.7">Local · open source · MIT</div>
      </div>
      <img src="\${shot}" style="height:520px;border:1px solid rgba(231,231,234,.25);box-shadow:0 20px 50px rgba(0,0,0,.5)">
    </div>\`;
  document.documentElement.style.background = "#1d2d3d";
  return { x: 0, y: 0, width: 1280, height: 640 };
})()`;

const frame = (index) => join(work, `frame-${String(index).padStart(2, "0")}.png`);
const steps = [
  // The floor in motion: chat closed so the room has the width, then the demo job.
  { run: settings({ lang: "en", theme: "light", chat: "closed", tour: "1", mode: "advanced" }), waitMs: 3000, file: join(work, "discard.png") },
  { run: click("Run the demo job"), waitMs: 400, file: join(work, "discard.png") },
  ...Array.from({ length: FRAMES }, (_, index) => ({ run: floorArea, waitMs: FRAME_MS, file: frame(index) })),
  // Still screens, with the correspondence panel open.
  { run: settings({ chat: "open" }), waitMs: 3500, file: join(docs, "screenshot-bench.png") },
  { run: click("Awaiting you"), waitMs: 1500, file: join(docs, "screenshot-awaiting.png") },
  { run: click("Files"), waitMs: 1500, file: join(docs, "screenshot-files.png") },
  { run: click("The Bench") + "; " + settings({ theme: "dark" }), waitMs: 4000, file: join(docs, "screenshot-dark.png") },
];
// The floor's own life: the night, and the dog. Sound is off: nobody wants a tune from a build script.
const NIGHT = 14;
const ERRAND = 18;
const night = (index) => join(work, `night-${String(index).padStart(2, "0")}.png`);
const errand = (index) => join(work, `errand-${String(index).padStart(2, "0")}.png`);
const press = (label) => `[...document.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") === ${JSON.stringify(label)})`;
const floorLife = [
  { run: settings({ lang: "en", theme: "light", chat: "closed", tour: "1", mode: "advanced", "sira.sound": "off" }), waitMs: 3000, file: join(work, "discard.png") },
  { run: click("Run the demo job"), waitMs: 14000, file: join(work, "discard.png") },
  // A coffee for the second perito, then Berlin to the third.
  { run: `${press("Bring a coffee")}[1]?.click(); ${press("Bring a doughnut")}[2]?.click(); ${press("Send Berlin over")}[2]?.click(); null`, waitMs: 150, file: join(work, "discard.png") },
  ...Array.from({ length: ERRAND }, (_, index) => ({ run: floorArea, waitMs: 330, file: errand(index) })),
  { run: click("Sıra gecesi"), waitMs: 2600, file: join(work, "discard.png") },
  ...Array.from({ length: NIGHT }, (_, index) => ({ run: floorArea, waitMs: 300, file: night(index) })),
];
const stitch = (name, files, ms) => {
  const all = files.map((file) => readPng(file));
  const { w, h } = all[0];
  writeApng(join(docs, name), w, h, all.filter((f) => f.w === w && f.h === h).map((f) => f.data), ms);
  console.log(`${name}: ${all.length} frames, ${w}×${h}`);
};
const stepsFile = join(work, "steps.json");
const run = (list) => {
  writeFileSync(stepsFile, JSON.stringify(list));
  const result = spawnSync(electron, [join(root, "apps/desktop"), "--fake", "--shots"], {
    stdio: "inherit",
    env: { ...process.env, LP_SHOT_STEPS: stepsFile, LP_DATA_DIR: join(work, "data") },
    timeout: 180_000,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (process.argv.includes("--floor-life")) {
  run(floorLife);
  stitch("berlin.png", Array.from({ length: ERRAND }, (_, index) => errand(index)), 330);
  stitch("sira-gecesi.png", Array.from({ length: NIGHT }, (_, index) => night(index)), 300);
  process.exit(0);
}
run(steps);

// Stitch the frames into one looping animation.
const frames = Array.from({ length: FRAMES }, (_, index) => readPng(frame(index)));
const { w, h } = frames[0];
writeApng(join(docs, "floor.png"), w, h, frames.filter((f) => f.w === w && f.h === h).map((f) => f.data), FRAME_MS);
console.log(`floor.png: ${frames.length} frames, ${w}×${h}`);

// The social card shows the dark screenshot just taken.
const shot = readFileSync(join(docs, "screenshot-dark.png")).toString("base64");
run([{ run: `window.__shot = ${JSON.stringify(shot)}; ${socialCard}`, waitMs: 1200, file: join(docs, "social-preview.png") }]);
