/**
 * Sync bundled Atomic workflow templates from the installed package into
 * the user's global `~/.atomic/workflows/` directory.
 *
 * Each bundled workflow directory (`hello/`, `hello-parallel/`, `ralph/`,
 * etc.) is a full overwrite of its destination — `rm -rf` followed by a
 * fresh copy — so files removed upstream don't linger after an upgrade.
 * User-created workflows whose names don't collide with bundled names are
 * left untouched (we only iterate the bundled source, never the user's
 * destination).
 *
 * Root-level files (`tsconfig.json`, etc.) are also overwritten on each
 * sync.
 */

import { join, sep } from "path";
import { readdir, rm } from "fs/promises";
import { homedir } from "os";
import {
  copyDir,
  copyFile,
  ensureDir,
  pathExists,
} from "@/services/system/copy.ts";
import { assertPathWithinRoot } from "@/lib/path-root-guard.ts";

/**
 * Reject any entry name that could redirect a write outside destRoot.
 * `readdir` should never return `.`, `..`, or names with separators, but
 * this is a cheap belt-and-braces check in case the installed package has
 * been tampered with or sits on an exotic filesystem.
 */
function isSafeEntryName(name: string): boolean {
  if (name === "" || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (sep !== "/" && name.includes(sep)) return false;
  return true;
}

/**
 * Locate the package root by walking up from this module. Both in installed
 * (`<pkg>/src/services/system/workflows.ts`) and dev checkout layouts the
 * package root is three directories up.
 */
function packageRoot(): string {
  return join(import.meta.dir, "..", "..", "..");
}

/** Honors ATOMIC_SETTINGS_HOME so tests can point at a temp dir. */
function homeRoot(): string {
  return process.env.ATOMIC_SETTINGS_HOME ?? homedir();
}

/**
 * Sync bundled workflow templates to `~/.atomic/workflows/`. Returns the
 * number of bundled workflows installed (for logging). Best-effort on
 * individual entries — readdir failures throw, per-entry copy failures
 * propagate up to the caller (auto-sync's runStep).
 */
export async function installGlobalWorkflows(): Promise<void> {
  const srcRoot = join(packageRoot(), ".atomic", "workflows");
  const destRoot = join(homeRoot(), ".atomic", "workflows");

  if (!(await pathExists(srcRoot))) {
    // Treat a missing bundled source as a non-fatal skip: dev checkouts
    // and partial installs legitimately hit this path. Surfaced via a
    // thrown error so the spinner UI marks the step red with context.
    throw new Error(`bundled workflows missing at ${srcRoot} — skipping ${destRoot}`);
  }

  await ensureDir(destRoot);

  // Safety invariant: we enumerate the BUNDLED source, never the user's
  // destination. This guarantees that `rm(dest)` can only ever target a
  // path whose basename exists in the bundled workflows — user-created
  // workflows with different names are structurally invisible to this loop.
  const entries = await readdir(srcRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) {
      console.warn(
        `  skipping unsafe bundled workflow entry name: ${JSON.stringify(entry.name)}`,
      );
      continue;
    }

    const src = join(srcRoot, entry.name);
    const dest = join(destRoot, entry.name);

    // Belt-and-braces: confirm the computed destination actually lives
    // inside destRoot. Throws if something conspired to produce an escape.
    assertPathWithinRoot(destRoot, dest, "Workflow destination");

    if (entry.isFile()) {
      // Root files (tsconfig.json, etc.) — overwrite in place.
      await copyFile(src, dest);
    } else if (entry.isDirectory()) {
      // Bundled workflow — full overwrite of the destination directory so
      // files removed upstream don't linger across upgrades. User-created
      // workflows under names that don't collide are untouched.
      await rm(dest, { recursive: true, force: true });
      await copyDir(src, dest);
    }
  }
}
