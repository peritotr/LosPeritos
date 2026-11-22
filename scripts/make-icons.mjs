// Turns apps/desktop/assets/icon.png (1024×1024) into icon.icns and icon.ico.
// Run on macOS: it uses the system's `sips` and `iconutil`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../apps/desktop/assets/", import.meta.url));
const source = dir + "icon.png";
if (!fs.existsSync(source)) {
  console.error(`Put a 1024×1024 PNG at ${source} first.`);
  process.exit(1);
}
const size = Number(/pixelWidth: (\d+)/.exec(execFileSync("sips", ["-g", "pixelWidth", source], { encoding: "utf8" }))?.[1]);
if (size < 1024) console.warn(`icon.png is ${size}px wide; 1024 gives a sharp Dock icon.`);

const resize = (px, out) => execFileSync("sips", ["-z", String(px), String(px), source, "--out", out], { stdio: "ignore" });

// macOS: an .iconset folder of fixed sizes, packed by iconutil.
const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "lp-icon-")) + "/icon.iconset";
fs.mkdirSync(iconset);
for (const px of [16, 32, 128, 256, 512]) {
  resize(px, `${iconset}/icon_${px}x${px}.png`);
  resize(px * 2, `${iconset}/icon_${px}x${px}@2x.png`);
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", dir + "icon.icns"]);

// Windows: an .ico may simply wrap PNGs, one per size.
const pngs = [16, 32, 48, 256].map((px) => {
  const file = `${iconset}/ico_${px}.png`;
  resize(px, file);
  return { px, data: fs.readFileSync(file) };
});
const header = Buffer.alloc(6 + 16 * pngs.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = header.length;
pngs.forEach(({ px, data }, index) => {
  const entry = 6 + 16 * index;
  header[entry] = px === 256 ? 0 : px;
  header[entry + 1] = px === 256 ? 0 : px;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
fs.writeFileSync(dir + "icon.ico", Buffer.concat([header, ...pngs.map((png) => png.data)]));
console.log("Wrote icon.icns and icon.ico to " + dir);
