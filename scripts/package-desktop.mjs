// Builds a standalone LosPeritos app for this machine's platform, and on macOS
// a .dmg holding it. Run through `npm run package`, which builds everything first.
//
// On macOS the app is signed and notarised when this Mac can do it:
//   - signing needs a "Developer ID Application" certificate in the keychain
//     (or LP_SIGN_IDENTITY naming one);
//   - notarising needs credentials stored once with
//       xcrun notarytool store-credentials LosPeritos
//     (or LP_NOTARY_PROFILE naming another stored profile).
// Without them the build is left unsigned: it opens on the machine that built
// it, but macOS will warn anyone who downloads it.
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

/** The Developer ID to sign with, or null when this Mac has none. */
function signingIdentity() {
  if (process.platform !== "darwin") return null;
  if (process.env.LP_SIGN_IDENTITY) return process.env.LP_SIGN_IDENTITY;
  const listed = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  return /"(Developer ID Application: [^"]+)"/.exec(listed)?.[1] ?? null;
}

/** The stored notary credentials to use, or null when none answer. */
function notaryProfile(identity) {
  if (!identity) return null;
  const profile = process.env.LP_NOTARY_PROFILE ?? "LosPeritos";
  try {
    execFileSync("xcrun", ["notarytool", "history", "--keychain-profile", profile], { stdio: "ignore", timeout: 60_000 });
    return profile;
  } catch {
    return null;
  }
}

const identity = signingIdentity();
const profile = notaryProfile(identity);
console.log(identity ? `Signing as: ${identity}` : "No Developer ID certificate found: building unsigned.");
if (identity) console.log(profile ? `Notarising with stored profile "${profile}".` : "No working notary profile: signed but not notarised.");

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
  ...(identity && {
    osxSign: {
      identity,
      // The hardened runtime is a condition of notarisation.
      optionsForFile: () => ({ hardenedRuntime: true, entitlements: path.join(desktop, "assets/entitlements.mac.plist") }),
    },
  }),
  ...(profile && { osxNotarize: { keychainProfile: profile } }),
});
console.log("App:", appPath);

if (process.platform === "darwin") {
  const dmg = path.join(release, `LosPeritos-${manifest.version}-${process.arch}.dmg`);
  execFileSync("hdiutil", ["create", "-volname", "LosPeritos", "-srcfolder", path.join(appPath, "LosPeritos.app"), "-ov", "-format", "UDZO", dmg], { stdio: "ignore" });
  // The disk image is what people download, so it is signed and notarised in its own right.
  if (identity) execFileSync("codesign", ["--sign", identity, "--timestamp", dmg], { stdio: "inherit" });
  if (profile) {
    execFileSync("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", profile, "--wait"], { stdio: "inherit" });
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
  }
  console.log("Disk image:", dmg);

  // For the app replacing itself: the app as a zip, and a list that says where the zip is.
  // Both go up beside the disk image; the app reads the list at
  // github.com/<repo>/releases/latest/download/releases.json.
  const zipName = `LosPeritos-${manifest.version}-${process.arch}-mac.zip`;
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", path.join(appPath, "LosPeritos.app"), path.join(release, zipName)]);
  const base = process.env.LP_UPDATE_BASE ?? `https://github.com/peritotr/LosPeritos/releases/download/v${manifest.version}`;
  const entry = { version: manifest.version, name: manifest.version, pub_date: new Date().toISOString(), notes: "", url: `${base}/${zipName}` };
  fs.writeFileSync(
    path.join(release, "releases.json"),
    JSON.stringify({ currentRelease: manifest.version, releases: [{ version: manifest.version, updateTo: entry }] }, null, 2) + "\n",
  );
  console.log("Update files:", zipName, "and releases.json");
  console.log(
    profile
      ? "Signed and notarised: opens without a warning on any Mac."
      : identity
        ? "Signed but not notarised: other Macs will still warn."
        : "Unsigned: other Macs will refuse it until the user allows it in System Settings.",
  );
}
