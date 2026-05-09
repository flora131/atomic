/**
 * Canonical file-discovery primitive for the deep-research-codebase workflow.
 *
 * Exports a single function — `listAllFiles` — that every consumer (preflight,
 * scout, etc.) should import rather than re-implementing inline.
 *
 * Three discovery paths, tried in order:
 *   1. `git ls-files --cached --others --exclude-standard` (git repos)
 *   2. `rg --files --hidden`                               (rg installed)
 *   3. In-process `walkWithIgnore(root)`                   (last resort)
 *
 * Each path is wrapped in try/catch because `Bun.spawnSync` throws ENOENT
 * when the executable is missing from PATH (rather than returning
 * `success: false`). The function is guaranteed non-throwing; it returns
 * `[]` only if the in-process walker itself also fails (extremely unlikely).
 */

import ignore, { type Ignore } from "ignore";
import ignoreByDefault from "ignore-by-default";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix as posixPath, relative, sep } from "node:path";

/**
 * Recursively walk a directory tree, honoring nested `.gitignore` files at
 * every level and seeding with `ignore-by-default`'s minimal universal set
 * (`node_modules`, `.git`, `coverage`, etc.). Returns repo-relative paths.
 *
 * Used as the last-resort discovery fallback when neither `git ls-files` nor
 * `rg --files` is available. The walker matches `.gitignore` semantics:
 *   • Patterns from a `.gitignore` only apply to files at or below the
 *     `.gitignore`'s directory.
 *   • Inherited rules from ancestor directories continue to apply.
 *   • Negations and the rest of gitignore syntax come from the `ignore`
 *     package, which is the de facto JS implementation.
 *
 * Symlinks are intentionally not followed (avoids cycles).
 */
function walkWithIgnore(root: string): string[] {
  const out: string[] = [];

  const baseline: Ignore = ignore().add(ignoreByDefault.directories());
  walk(root, [{ basePath: "", matcher: baseline }]);

  function walk(
    dir: string,
    inheritedScopes: ReadonlyArray<{ basePath: string; matcher: Ignore }>,
  ): void {
    let scopes = inheritedScopes;
    try {
      const content = readFileSync(join(dir, ".gitignore"), "utf8");
      const here = ignore().add(content);
      // Normalize basePath to posix so it can be combined with `posix`
      // (forward-slash) entry paths via `posix.relative` below — mixing
      // separators in `path.relative` is undefined behaviour on Windows.
      const basePathRel = relative(root, dir);
      const basePath =
        sep === "/" ? basePathRel : basePathRel.split(sep).join("/");
      scopes = [
        ...inheritedScopes,
        { basePath, matcher: here },
      ];
    } catch {
      // No .gitignore at this level — keep inherited scopes.
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      // Skip everything that isn't a regular file or a regular directory —
      // most importantly, skip symlinks so we don't follow cycles.
      if (!entry.isFile() && !entry.isDirectory()) continue;

      const full = join(dir, entry.name);
      const rel = relative(root, full);
      // The `ignore` package requires forward-slash paths.
      const posix = sep === "/" ? rel : rel.split(sep).join("/");
      // Trailing slash so directory-only patterns (`dist/`) match.
      const probe = entry.isDirectory() ? `${posix}/` : posix;

      let ignored = false;
      for (const scope of scopes) {
        const within =
          scope.basePath === ""
            ? probe
            : posixPath.relative(scope.basePath, posix) +
              (entry.isDirectory() ? "/" : "");
        // If `within` escapes the scope (starts with `..`), the file isn't
        // under this .gitignore's reach — skip the check.
        if (within.startsWith("..")) continue;
        if (scope.matcher.ignores(within)) {
          ignored = true;
          break;
        }
      }
      if (ignored) continue;

      if (entry.isDirectory()) {
        walk(full, scopes);
      } else {
        out.push(rel);
      }
    }
  }

  return out;
}

/**
 * Build a child-process environment that won't make git ignore `cwd`.
 *
 * If `listAllFiles` is invoked from inside a git hook (pre-commit, pre-push,
 * etc.), the parent `git` process exports `GIT_DIR` / `GIT_WORK_TREE` /
 * `GIT_INDEX_FILE` so its child invocations operate on the same repo. Those
 * env vars take precedence over the spawned `git ls-files`'s `cwd`, so without
 * scrubbing them `git ls-files` would list the *parent* repo's tracked files
 * instead of `root`'s.
 */
function envForRoot(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (
      key === "GIT_DIR" ||
      key === "GIT_WORK_TREE" ||
      key === "GIT_INDEX_FILE" ||
      key === "GIT_OBJECT_DIRECTORY" ||
      key === "GIT_ALTERNATE_OBJECT_DIRECTORIES" ||
      key === "GIT_NAMESPACE" ||
      key === "GIT_CEILING_DIRECTORIES" ||
      key === "GIT_DISCOVERY_ACROSS_FILESYSTEM"
    ) continue;
    env[key] = value;
  }
  return env;
}

/**
 * List all files in `root`, honoring `.gitignore` whenever possible.
 *
 * Three discovery paths, tried in order — every path respects `.gitignore`:
 *
 *   1. **git ls-files** — for git repos. Combines `--cached` (tracked) with
 *      `--others --exclude-standard` (untracked-but-not-ignored) so a freshly
 *      created file the user hasn't `git add`-ed yet still appears, while
 *      anything matching `.gitignore` / `.git/info/exclude` is excluded.
 *   2. **ripgrep `rg --files --hidden`** — for non-git directories that still
 *      have a `.gitignore` (or `.ignore`). `rg` honors both without needing
 *      a repo, and always excludes `.git/`. `--hidden` keeps tracked dotfiles
 *      like `.github/`, `.claude/` visible (matching git's behavior).
 *   3. **In-process walker** — last-resort fallback when neither git nor rg
 *      is available. Uses the `ignore` package to honor every `.gitignore`
 *      it encounters (including nested ones), seeded with `ignore-by-default`
 *      for the universal-ignore baseline (`node_modules`, `.git`, etc.).
 */
export function listAllFiles(root: string): string[] {
  const env = envForRoot();

  // Bun.spawnSync throws (rather than returning success:false) when the
  // executable is missing from PATH, so each branch is wrapped in try/catch
  // and falls through to the next discovery strategy on error.
  try {
    const git = Bun.spawnSync({
      cmd: ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (git.success && git.stdout) {
      return git.stdout.toString().split("\n").filter((l) => l.length > 0);
    }
  } catch { /* git not on PATH — fall through to rg */ }

  try {
    const rg = Bun.spawnSync({
      cmd: ["rg", "--files", "--hidden"],
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (rg.success && rg.stdout) {
      return rg.stdout.toString().split("\n").filter((l) => l.length > 0);
    }
  } catch { /* rg not on PATH — fall through to in-process walker */ }

  return walkWithIgnore(root);
}
