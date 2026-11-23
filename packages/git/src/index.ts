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
