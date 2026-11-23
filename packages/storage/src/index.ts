/**
 * File-backed storage. Workspace data lives in `<folder>/.losperitos/` as one
 * JSON file per collection; machine-level data lives in the app data dir.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const WORKSPACE_DIR = ".losperitos";

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Cannot read ${file}: ${(err as Error).message}`);
  }
}

/** Write via a temp file so a crash never leaves a half-written file. */
function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, file);
}

/** A list of records with an `id`, kept in memory and persisted on change. */
export class Collection<T extends { id: string }> {
  private items: T[];

  constructor(private readonly file: string) {
    this.items = readJson<T[]>(file, []);
  }

  all(): T[] {
    return [...this.items];
  }

  get(id: string): T | undefined {
    return this.items.find((item) => item.id === id);
  }

  /** Insert or replace by id. */
  put(item: T): T {
    const index = this.items.findIndex((existing) => existing.id === item.id);
    if (index === -1) this.items.push(item);
    else this.items[index] = item;
    writeJson(this.file, this.items);
    return item;
  }

  remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    writeJson(this.file, this.items);
  }
}

export class WorkspaceStore {
  readonly dir: string;

  constructor(workspacePath: string) {
    this.dir = join(workspacePath, WORKSPACE_DIR);
    mkdirSync(this.dir, { recursive: true });
    const ignore = join(this.dir, ".gitignore");
    if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  }

  collection<T extends { id: string }>(name: string): Collection<T> {
    return new Collection<T>(join(this.dir, `${name}.json`));
  }

  readDoc<T>(name: string): T | undefined {
    return readJson<T | undefined>(join(this.dir, `${name}.json`), undefined);
  }

  writeDoc(name: string, value: unknown): void {
    writeJson(join(this.dir, `${name}.json`), value);
  }
}

/** Machine-level state: which folders are open as workspaces, and the API token. */
export class AppStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  workspacePaths(): string[] {
    return readJson<string[]>(join(this.dir, "workspaces.json"), []);
  }

  addWorkspacePath(path: string): void {
    const paths = this.workspacePaths();
    if (!paths.includes(path)) writeJson(join(this.dir, "workspaces.json"), [...paths, path]);
  }

  token(): string | undefined {
    return readJson<{ token?: string }>(join(this.dir, "token.json"), {}).token;
  }

  /**
   * Machine-level documents that hold secrets, such as connector keys. They
   * stay out of project folders, which may be shared or committed.
   */
  readSecret<T>(name: string, fallback: T): T {
    return readJson<T>(join(this.dir, `${name}.json`), fallback);
  }

  writeSecret(name: string, value: unknown): void {
    const file = join(this.dir, `${name}.json`);
    writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    chmodSync(file, 0o600);
  }

  setToken(token: string): void {
    const file = join(this.dir, "token.json");
    writeFileSync(file, JSON.stringify({ token }) + "\n", { mode: 0o600 });
  }
}
