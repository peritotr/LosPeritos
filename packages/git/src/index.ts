/** Thin wrappers over the `git` CLI for per-task branches and worktrees. */
import { execFile } from "node:child_process";

export class GitError extends Error {}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new GitError((stderr || stdout || err.message).trim()));
      else resolve(stdout);
    });
  });
}

/** The checked-out branch, or null when this is not a repo with a commit on a branch. */
export async function currentBranch(repo: string): Promise<string | null> {
  try {
    await git(repo, ["rev-parse", "--verify", "HEAD"]);
    const top = (await git(repo, ["rev-parse", "--show-toplevel"])).trim();
    // A folder merely inside someone else's repo is not a repo of its own.
    const [a, b] = await Promise.all([realPath(top), realPath(repo)]);
    if (a !== b) return null;
    return (await git(repo, ["symbolic-ref", "--short", "HEAD"])).trim();
  } catch {
    return null;
  }
}

async function realPath(path: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(path);
}

/** Create `branch` from the current HEAD and check it out in a new worktree at `dir`. */
export async function addWorktree(repo: string, dir: string, branch: string): Promise<void> {
  await git(repo, ["worktree", "add", "-b", branch, dir]);
}

export async function removeWorktree(repo: string, dir: string): Promise<void> {
  await git(repo, ["worktree", "remove", "--force", dir]);
}

export async function isClean(dir: string): Promise<boolean> {
  return (await git(dir, ["status", "--porcelain"])).trim() === "";
}

/** Changes on `branch` since it forked from `base`. */
export function diff(repo: string, base: string, branch: string): Promise<string> {
  return git(repo, ["diff", `${base}...${branch}`]);
}

/** Paths of files `branch` added or changed since it forked from `base`. */
export async function changedFiles(repo: string, base: string, branch: string): Promise<string[]> {
  const out = await git(repo, ["diff", "--name-only", "--diff-filter=d", "-z", `${base}...${branch}`]);
  return out.split("\0").filter(Boolean);
}

export async function hasCommitsAhead(repo: string, base: string, branch: string): Promise<boolean> {
  return (await git(repo, ["rev-list", "--count", `${base}..${branch}`])).trim() !== "0";
}

/**
 * Merge `branch` into `base`, which must be the branch checked out in `repo`.
 * On conflict the merge is aborted and the repo is left as it was.
 */
export async function merge(repo: string, base: string, branch: string, message: string): Promise<void> {
  const checkedOut = await currentBranch(repo);
  if (checkedOut !== base) {
    throw new GitError(`Expected "${base}" to be checked out, found "${checkedOut ?? "nothing"}".`);
  }
  try {
    await git(repo, ["merge", "--no-ff", "-m", message, branch]);
  } catch (err) {
    await git(repo, ["merge", "--abort"]).catch(() => undefined);
    throw err;
  }
}

/** One commit, as the code panel lists it. */
export interface Commit {
  hash: string;
  subject: string;
  author: string;
  /** ISO time. */
  date: string;
}

/** The latest commits on the checked-out branch, newest first. */
export async function log(repo: string, count: number): Promise<Commit[]> {
  const out = await git(repo, ["log", `-${count}`, "--pretty=format:%H%x1f%s%x1f%an%x1f%aI%x1e"]);
  return out
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash = "", subject = "", author = "", date = ""] = entry.split("\x1f");
      return { hash, subject, author, date };
    });
}

/** Files that differ from the last commit: `status` is git's two-letter code, e.g. " M", "??". */
export async function status(repo: string): Promise<Array<{ path: string; status: string }>> {
  const out = await git(repo, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  const entries = out.split("\0").filter(Boolean);
  const files: Array<{ path: string; status: string }> = [];
  for (let at = 0; at < entries.length; at++) {
    const entry = entries[at]!;
    const code = entry.slice(0, 2);
    files.push({ path: entry.slice(3), status: code });
    // A rename is followed by the name it had before.
    if (code.includes("R") || code.includes("C")) at++;
  }
  return files;
}

/** Local branches, with how many commits each has that `base` does not. */
export async function branches(repo: string, base: string): Promise<Array<{ name: string; ahead: number }>> {
  const names = (await git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).split("\n").filter(Boolean);
  return Promise.all(
    names.map(async (name) => ({
      name,
      ahead: name === base ? 0 : Number((await git(repo, ["rev-list", "--count", `${base}..${name}`]).catch(() => "0")).trim()) || 0,
    })),
  );
}

/** What one commit changed, as a patch. */
export function show(repo: string, hash: string): Promise<string> {
  return git(repo, ["show", "--format=", "--patch", hash]);
}

/** Tracked files as they differ from the last commit, as a patch. */
export function workingDiff(repo: string): Promise<string> {
  return git(repo, ["diff", "HEAD"]);
}
