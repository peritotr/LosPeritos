import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";

/** How to start a program: the file to run and the arguments that must come before the caller's own. */
export interface Launch {
  file: string;
  args: string[];
  /** Only for a Windows batch file nothing better could be made of: it has to go through `cmd`. */
  shell?: boolean;
}

type Env = Record<string, string | undefined>;

/** Looks a program up the way a Windows shell would: along the path, trying each known ending. */
export function findOnWindows(name: string, env: Env = process.env): string | null {
  const endings = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  // A program that runs by itself is preferred over a batch file of the same name.
  const order = [...endings.filter((e) => /^\.(exe|com)$/i.test(e)), ...endings.filter((e) => !/^\.(exe|com)$/i.test(e))];
  const names = extname(name) ? [name] : order.map((ending) => name + ending.toLowerCase());
  if (isAbsolute(name) || /[\\/]/.test(name)) return names.find((candidate) => existsSync(candidate)) ?? null;
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  for (const ending of names) {
    for (const dir of dirs) {
      const candidate = join(dir.replace(/^"|"$/g, ""), ending);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The script a batch file made by npm hands over to Node, if it is one of those. Such a file is two
 * lines of plumbing around `node "<its folder>\node_modules\…\cli.js" %*`; running that script
 * ourselves keeps the arguments out of `cmd`, which would mangle quotes and line breaks in them.
 */
export function scriptBehindShim(shim: string, text: string): string | null {
  const found = [...text.matchAll(/%(?:~dp0|dp0%)\\?([^"%\r\n]+?\.(?:c|m)?js)"/gi)];
  const last = found[found.length - 1]?.[1];
  if (!last) return null;
  const script = join(dirname(shim), last);
  return existsSync(script) ? script : null;
}

/** Quotes one argument for `cmd`, as well as that can be done. */
function forCmd(word: string): string {
  if (word !== "" && !/[\s"&|<>^%()!,;=]/.test(word)) return word;
  return `"${word.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1").replace(/%/g, "%%")}"`;
}

/**
 * Turns a program's name and arguments into something that can be started without a shell.
 * Everywhere but Windows that is the name itself. On Windows a tool installed through npm is a
 * batch file, which cannot be started directly: the script behind it is run with Node instead.
 */
export function launch(bin: string, args: string[], env: Env = process.env, platform: string = process.platform): Launch {
  if (platform !== "win32") return { file: bin, args };
  const found = findOnWindows(bin, env);
  if (!found) return { file: bin, args };
  if (!/\.(cmd|bat)$/i.test(found)) return { file: found, args };
  try {
    const script = scriptBehindShim(found, readFileSync(found, "utf8"));
    if (script) {
      const beside = join(dirname(found), "node.exe");
      const node = existsSync(beside) ? beside : findOnWindows("node", env);
      if (node) return { file: node, args: [script, ...args] };
    }
  } catch {
    // Unreadable: fall through to the shell.
  }
  return { file: forCmd(found), args: args.map(forCmd), shell: true };
}

/** The same, as the first two arguments of `execFile`. */
export function started(bin: string, args: string[]): [string, string[]] {
  const how = launch(bin, args);
  return [how.file, how.args];
}

/** The option `execFile` needs when {@link launch} could only fall back on the shell. */
export function viaShell(bin: string): { shell?: boolean } {
  return launch(bin, []).shell ? { shell: true } : {};
}

/**
 * A folder as Claude Code's permission rules name it: forward slashes, and on Windows the drive as
 * a first folder (`C:\work\site` is `/c/work/site`).
 */
export function rulePath(dir: string, platform: string = process.platform): string {
  if (platform !== "win32") return dir;
  const drive = /^([A-Za-z]):[\\/]*(.*)$/.exec(dir);
  const rest = (drive ? drive[2]! : dir).split(/[\\/]+/).filter(Boolean).join("/");
  return drive ? `/${drive[1]!.toLowerCase()}/${rest}` : `/${rest}`;
}
