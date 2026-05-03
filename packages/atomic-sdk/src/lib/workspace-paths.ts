import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findAncestorWith(start: string, marker: string): string | undefined {
  let cur = resolve(start);
  while (cur !== dirname(cur)) {
    if (existsSync(join(cur, marker))) return cur;
    cur = dirname(cur);
  }
  return undefined;
}

/**
 * Returns the workspace root (bun.lock dir) or `undefined` when not found.
 * NEVER throws at module load. Callers in dev-only code paths handle the
 * undefined branch explicitly.
 */
export function findWorkspaceRoot(start: string): string | undefined {
  return findAncestorWith(start, "bun.lock");
}

/**
 * Lazy CLI package root for dev-mode hook commands. Returns `undefined`
 * when the SDK runs outside a workspace (npm install, compiled binary).
 * Production hook commands resolve the CLI via `atomic` on PATH instead.
 */
export function getDevCliPkgRoot(): string | undefined {
  const root = findWorkspaceRoot(import.meta.dir);
  return root ? join(root, "packages", "atomic") : undefined;
}
