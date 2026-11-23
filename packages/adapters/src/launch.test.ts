import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { findOnWindows, launch, rulePath, scriptBehindShim } from "./launch.js";

test("elsewhere than Windows a program is started by its name", () => {
  assert.deepEqual(launch("claude", ["--version"], {}, "darwin"), { file: "claude", args: ["--version"] });
});

test("a Windows program is found along the path, one that runs by itself before a batch file", () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-launch-"));
  writeFileSync(join(dir, "tool.cmd"), "@echo off\r\n");
  const env = { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  assert.equal(findOnWindows("tool", env), join(dir, "tool.cmd"));
  writeFileSync(join(dir, "tool.exe"), "");
  assert.equal(findOnWindows("tool", env), join(dir, "tool.exe"));
  assert.equal(findOnWindows("absent", env), null);
  assert.deepEqual(launch("tool", ["a b"], env, "win32"), { file: join(dir, "tool.exe"), args: ["a b"] });
});

test("the script behind a batch file from npm is run with Node, so arguments never pass through cmd", () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-launch-"));
  const shim = join(dir, "tool.cmd");
  const text = '@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\cli.js" %*\r\n';
  writeFileSync(shim, text);
  assert.equal(scriptBehindShim(shim, text), null, "a script that is not there is not trusted");
  writeFileSync(join(dir, "cli.js"), "console.log(JSON.stringify(process.argv.slice(2)))\n");
  writeFileSync(join(dir, "node.exe"), "");
  assert.equal(scriptBehindShim(shim, text), join(dir, "cli.js"));
  const awkward = 'he said "hi"\nand left & more %PATH%';
  assert.deepEqual(launch("tool", [awkward], { PATH: dir }, "win32"), { file: join(dir, "node.exe"), args: [join(dir, "cli.js"), awkward] });
});

test("on Windows itself a batch file from npm really starts and gets its arguments whole", { skip: process.platform !== "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "lp-launch-"));
  writeFileSync(join(dir, "echoer.cmd"), '@ECHO off\r\nSET dp0=%~dp0\r\nnode  "%dp0%\\cli.js" %*\r\n');
  writeFileSync(join(dir, "cli.js"), "console.log(JSON.stringify(process.argv.slice(2)))\n");
  const awkward = 'he said "hi"\nand left & more %PATH%';
  const how = launch(join(dir, "echoer"), [awkward, "--flag"]);
  assert.equal(how.shell, undefined);
  assert.deepEqual(JSON.parse(execFileSync(how.file, how.args, { encoding: "utf8" })), [awkward, "--flag"]);
  // npm itself is such a batch file.
  assert.match(execFileSync(...(Object.values(launch("npm", ["--version"])).slice(0, 2) as [string, string[]]), { encoding: "utf8" }), /^\d+\./);
});

test("a folder is named in a permission rule the way Claude Code reads it", () => {
  assert.equal(rulePath("/work/site", "darwin"), "/work/site");
  assert.equal(rulePath("C:\\work\\my site", "win32"), "/c/work/my site");
  assert.equal(rulePath("D:/x/", "win32"), "/d/x");
});
