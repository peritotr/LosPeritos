// Builds a standalone LosPeritos app for this machine's platform, and on macOS
// a .dmg holding it. Run through `npm run package`, which builds everything first.
//
// The app is not code-signed or notarised: it opens normally on the machine
// that built it, but macOS and Windows will warn anyone who downloads it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const esbuild = require("esbuild");
const { packager } = require("@electron/packager");

const root = fileURLToPath(new URL("..", import.meta.url));
const desktop = path.join(root, "apps/desktop");
const release = path.join(desktop, "release");
const stage = path.join(release, "app");
const manifest = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8"));

fs.rmSync(release, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// The main process and the peritos CLI each become one file, with the core and
// every other workspace package compiled in, so the app needs no node_modules.
const bundle = (entry, outfile) =>
  esbuild.build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(stage, outfile),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["electron"],
    // Some dependencies are CommonJS and call require() at run time.
    banner: { js: 'import { createRequire as __lpRequire } from "node:module"; const require = __lpRequire(import.meta.url);' },
    logLevel: "warning",
  });
await bundle("apps/desktop/dist/main.js", "main.js");
await bundle("packages/cli/dist/main.js", "cli/main.js");

fs.copyFileSync(path.join(desktop, "preload.cjs"), path.join(stage, "preload.cjs"));
fs.copyFileSync(path.join(desktop, "assets/icon.png"), path.join(stage, "icon.png"));
fs.cpSync(path.join(root, "apps/ui/dist"), path.join(stage, "ui"), { recursive: true });
fs.copyFileSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify({ name: "losperitos", productName: "LosPeritos", version: manifest.version, license: "MIT", type: "module", main: "main.js" }, null, 2),
);

const [appPath] = await packager({
  dir: stage,
  out: release,
  name: "LosPeritos",
  appBundleId: "com.perito.losperitos",
  appVersion: manifest.version,
  electronVersion: require("electron/package.json").version,
  icon: path.join(desktop, "assets/icon"), // packager adds .icns or .ico
  // Kept as plain files: agents run cli/main.js with Electron acting as Node.
  asar: false,
  overwrite: true,
  quiet: true,
});
console.log("App:", appPath);

if (process.platform === "darwin") {
  const dmg = path.join(release, `LosPeritos-${manifest.version}-${process.arch}.dmg`);
  execFileSync("hdiutil", ["create", "-volname", "LosPeritos", "-srcfolder", path.join(appPath, "LosPeritos.app"), "-ov", "-format", "UDZO", dmg], { stdio: "ignore" });
  console.log("Disk image:", dmg);
}
