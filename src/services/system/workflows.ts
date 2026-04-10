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
import { lstat, readdir, rm, symlink, unlink } from "fs/promises";
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

/**
 * Safely remove a symlink or junction before re-creating it.
 *
 * On Windows, Bun's `rm({ recursive: true })` follows NTFS junctions and
 * can delete the **target directory's contents** (oven-sh/bun#27233).
 * `unlink` is safe: it opens with `FILE_FLAG_OPEN_REPARSE_POINT` and
 * removes only the link entry, never following it.
 *
 * Falls back to `rm` only when the path is a real directory (not a link),
 * which can happen if a previous version created the path as a plain copy
 * instead of a symlink.
 */
async function removeLinkOrDir(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      await unlink(path);
    } else if (stats.isDirectory()) {
      await rm(path, { recursive: true, force: true });
    } else {
      await unlink(path);
    }
  } catch (error: unknown) {
    // ENOENT — path doesn't exist; nothing to remove.
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
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

  // ── Type-resolution setup for workflow authors ─────────────────────
  //
  // The bundled tsconfig.json uses relative `paths` that only resolve
  // correctly inside the package's own directory tree. Once the files
  // are copied to `~/.atomic/workflows/`, those relative paths break.
  //
  // Strategy: symlink `node_modules/@bastani/atomic` in the destination
  // back to the running package root.  TypeScript's standard module
  // resolution then finds `@bastani/atomic/workflows` (and its
  // transitive deps) automatically — no `paths` override needed.
  //
  // If symlink creation fails (permissions, unsupported FS), we fall
  // back to a tsconfig with an absolute `paths` entry pointing at the
  // package's SDK source.  Either way the workflow author gets types
  // with zero manual configuration.
  await setupWorkflowTypes(destRoot);
}

/**
 * Wire up TypeScript type resolution for a global workflows directory.
 *
 * Creates a `node_modules/@bastani/atomic` symlink → the installed
 * package root and generates a tsconfig.json that lets standard module
 * resolution do the work. Falls back to absolute `paths` in the
 * tsconfig if symlinking isn't possible.
 */
export async function setupWorkflowTypes(destRoot: string): Promise<void> {
  const pkgRoot = packageRoot();
  let usedSymlink = false;

  // 1. Symlink the package itself
  try {
    const scopeDir = join(destRoot, "node_modules", "@bastani");
    await ensureDir(scopeDir);

    const link = join(scopeDir, "atomic");
    await removeLinkOrDir(link);

    // Junctions on Windows need no elevated privileges.
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(pkgRoot, link, type);
    usedSymlink = true;
  } catch {
    // Swallow — falls back to paths-based tsconfig below.
  }

  // 2. Symlink @types/bun so `Bun.*` APIs have types in workflows
  try {
    const bunTypes = join(pkgRoot, "node_modules", "@types", "bun");
    if (await pathExists(bunTypes)) {
      const typesDir = join(destRoot, "node_modules", "@types");
      await ensureDir(typesDir);

      const link = join(typesDir, "bun");
      await removeLinkOrDir(link);

      const type = process.platform === "win32" ? "junction" : "dir";
      await symlink(bunTypes, link, type);
    }
  } catch {
    // Best effort — Bun APIs in workflows lack types but runtime is fine.
  }

  // 3. Generate a clean tsconfig for the destination
  const compilerOptions: Record<string, unknown> = {
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    noEmit: true,
    verbatimModuleSyntax: true,
    strict: true,
    skipLibCheck: true,
    types: ["bun"],
  };

  if (!usedSymlink) {
    // Fallback: absolute paths so TypeScript can still resolve the SDK
    // source from the installed package location.
    compilerOptions.paths = {
      "@bastani/atomic": [join(pkgRoot, "src", "sdk", "index.ts")],
      "@bastani/atomic/workflows": [join(pkgRoot, "src", "sdk", "workflows.ts")],
    };
  }

  const tsconfig = { compilerOptions, include: GLOBAL_TSCONFIG_INCLUDE };

  await Bun.write(
    join(destRoot, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2) + "\n",
  );
}

/** Include globs shared by every generated global workflows tsconfig. */
const GLOBAL_TSCONFIG_INCLUDE = [
  "**/claude/**/*.ts",
  "**/copilot/**/*.ts",
  "**/opencode/**/*.ts",
  "**/helpers/**/*.ts",
];
