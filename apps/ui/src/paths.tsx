/**
 * Paths the team writes in its messages ("teslim/hafta-1.md") lead somewhere:
 * where one names a file or a folder of the bureau's, it can be clicked and
 * opens in the Folder screen. This holds what the folder contains, for
 * whoever draws such a path.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FolderFile } from "@losperitos/protocol";
import type { Ctx } from "./context";

interface Known {
  files: FolderFile[];
  /** "file", "dir", or null when the bureau has nothing by that name. */
  kind(path: string): "file" | "dir" | null;
  open(path: string): void;
  reload(): void;
}
const none: Known = { files: [], kind: () => null, open: () => undefined, reload: () => undefined };
const Paths = createContext<Known>(none);
export const useFolder = () => useContext(Paths);

/** `./teslim/x.md,` → `teslim/x.md`. */
export const tidy = (text: string) => text.trim().replace(/^\.\//, "").replace(/[.,;:]+$/, "").replace(/\/+$/, "");

export function FolderProvider({ ctx, children }: { ctx: Ctx | null; children: ReactNode }) {
  const [files, setFiles] = useState<FolderFile[]>([]);
  const [turn, setTurn] = useState(0);
  const bureauId = ctx?.bureau.id;
  // The team makes files as it talks and as tasks close: look again when either moves on.
  const heard = (ctx?.messages.length ?? 0) + (ctx?.tasks.filter((task) => task.status === "done").length ?? 0);
  useEffect(() => {
    if (!ctx || !bureauId) return setFiles([]);
    let current = true;
    ctx.actions.folder(bureauId).then(
      (listed) => current && setFiles(listed.files),
      () => current && setFiles([]),
    );
    return () => {
      current = false;
    };
  }, [bureauId, heard, turn]);
  const known = useMemo<Known>(() => {
    const names = new Set(files.map((file) => file.path));
    const dirs = new Set<string>();
    for (const file of files) {
      const parts = file.path.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    return {
      files,
      kind: (path) => (names.has(path) ? "file" : dirs.has(path) ? "dir" : null),
      open: (path) => ctx?.go({ screen: "folder", path }),
      reload: () => setTurn((n) => n + 1),
    };
  }, [files, ctx?.go]);
  return <Paths.Provider value={known}>{children}</Paths.Provider>;
}

/** A piece of inline code: a link into the folder when it names something there, plain code otherwise. */
export function CodeSpan({ text }: { text: string }) {
  const folder = useFolder();
  const path = tidy(text);
  return folder.kind(path) ? (
    <button className="path-link" title={path} onClick={(event) => (event.stopPropagation(), folder.open(path))}>
      <code>{text}</code>
    </button>
  ) : (
    <code>{text}</code>
  );
}
