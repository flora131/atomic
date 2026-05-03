/**
 * Path-resolution helpers for build/release scripts.
 *
 * Anchored on the workspace root (the directory containing `bun.lock`) so
 * callers never duplicate `resolve(import.meta.dir, "../..")` arithmetic.
 *
 * Runtime CLI code must NOT call `findRepoRoot` — there is no `bun.lock` in
 * a published install or a compiled binary. Use `getEmbeddedAsset` instead.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Walk up from `start` looking for a directory that contains `marker`.
 * Returns the matching directory or `undefined` when the search reaches
 * the filesystem root without a hit.
 */
export function findAncestorWith(start: string, marker: string): string | undefined {
  let cur = resolve(start);
  while (cur !== dirname(cur)) {
    if (existsSync(join(cur, marker))) return cur;
    cur = dirname(cur);
  }
  return undefined;
}

/**
 * Walk up from `start` until a directory containing `bun.lock` is found.
 * That directory is the workspace root for the dev checkout.
 */
export function findRepoRoot(start: string): string {
  const root = findAncestorWith(start, "bun.lock");
  if (!root) throw new Error(`workspace-paths: bun.lock not found above ${start}`);
  return root;
}
