/**
 * Codebase scout: deterministic helpers for the deep-research-codebase workflow.
 *
 * Responsibilities:
 *   1. Discover the codebase root (git toplevel, falling back to cwd).
 *   2. List all source files, honoring `.gitignore` via git ls-files in repos
 *      and via `rg --files` in non-repo directories that still have one.
 *   3. Count lines of code per file using batched `wc -l`.
 *   4. Render a compact directory tree (depth-bounded) for prompt context.
 *   5. Build "partition units" by aggregating LOC at depth-1, then drilling
 *      down on any unit that is too large to live in a single explorer.
 *   6. Bin-pack partition units into N balanced groups (largest-first).
 *
 * Everything here is pure TypeScript + child_process — no LLM calls.
 */

// Use Bun.spawnSync instead of node:child_process for consistency with the rest of the codebase.

import * as linguistLanguages from "linguist-languages";
import ignore, { type Ignore } from "ignore";
import ignoreByDefault from "ignore-by-default";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix as posixPath, relative, sep } from "node:path";

/**
 * Source-file extensions we treat as "code" for LOC accounting.
 *
 * Derived from GitHub Linguist (`linguist-languages`), filtered to
 * `type === "programming"`. Linguist tracks 500+ programming languages and
 * keeps the canonical extension list per language up to date — using it
 * removes a maintenance burden and picks up obscure-but-legitimate
 * languages we'd never enumerate by hand.
 *
 * Three modifications layered on top of the raw linguist data:
 *
 *   1. **Multi-segment extensions are skipped.** Linguist lists entries like
 *      `.coffee.md` (Literate CoffeeScript) and `.gradle.kts` (Gradle Kotlin
 *      DSL). Our `isCodeFile()` only sees the tail after the final dot, so
 *      collapsing `.coffee.md` to `md` would mis-classify Markdown as code.
 *      Skipping them is safe because the base languages they extend always
 *      list a single-segment extension as well (`.coffee`, `.kts`).
 *   2. **EXCLUDE_EXTENSIONS denylist.** A handful of single-segment
 *      extensions that programming-typed languages claim but which in
 *      practice almost always mean a non-code file (`.md` is claimed by
 *      GCC Machine Description but means Markdown 99.9% of the time).
 *   3. **SCHEMA_EXTENSIONS allowlist.** Schemas/DSLs that linguist
 *      categorises as `type: "data"` but which materially shape codebase
 *      behaviour and belong in research scope.
 */
const SCHEMA_EXTENSIONS = ["sql", "graphql", "proto"] as const;

/**
 * Single-segment extensions that linguist's `programming`-typed languages
 * claim but which in real-world codebases almost always mean a non-code
 * file. Each entry needs a one-line justification.
 */
const EXCLUDE_EXTENSIONS = new Set<string>([
  "md", // claimed by "GCC Machine Description"; almost always Markdown.
]);

const CODE_EXTENSIONS: Set<string> = (() => {
  const out = new Set<string>();
  const langs = linguistLanguages as unknown as Record<
    string,
    { type?: string; extensions?: readonly string[] }
  >;
  for (const lang of Object.values(langs)) {
    if (lang?.type !== "programming") continue;
    for (const ext of lang.extensions ?? []) {
      const cleaned = ext.replace(/^\./, "").toLowerCase();
      // Skip multi-segment extensions — see file-level comment.
      if (cleaned.includes(".")) continue;
      if (EXCLUDE_EXTENSIONS.has(cleaned)) continue;
      out.add(cleaned);
    }
  }
  for (const ext of SCHEMA_EXTENSIONS) out.add(ext);
  return out;
})();

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

/** Per-file LOC + path. */
export type FileStats = { path: string; loc: number };

/**
 * A "partition unit" is the atomic chunk of work that gets bin-packed into
 * an explorer. It is always one directory (possibly drilled down to depth 2)
 * with all of the code files that live anywhere underneath it.
 */
export type PartitionUnit = {
  /** Repo-relative path, e.g. "src/cli" or "packages/foo/src". */
  path: string;
  loc: number;
  fileCount: number;
  /** Repo-relative file paths inside this unit (full recursive listing). */
  files: string[];
};

export type CodebaseScout = {
  /** Absolute path to the repository root. */
  root: string;
  totalLoc: number;
  totalFiles: number;
  /** Compact rendered directory tree (depth-bounded) for prompt context. */
  tree: string;
  /** Partition units, sorted by LOC descending. */
  units: PartitionUnit[];
};

/** Resolve the project root. Prefers `git rev-parse --show-toplevel`. */
export function getCodebaseRoot(): string {
  const r = Bun.spawnSync({
    cmd: ["git", "rev-parse", "--show-toplevel"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.success && r.stdout) {
    return r.stdout.toString().trim();
  }
  return process.cwd();
}

function isCodeFile(p: string): boolean {
  const dot = p.lastIndexOf(".");
  if (dot < 0 || dot === p.length - 1) return false;
  const ext = p.slice(dot + 1).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

/**
 * List all files in the repository, honoring `.gitignore` whenever possible.
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
function listAllFiles(root: string): string[] {
  // Bun.spawnSync throws (rather than returning success:false) when the
  // executable is missing from PATH, so each branch is wrapped in try/catch
  // and falls through to the next discovery strategy on error.
  try {
    const git = Bun.spawnSync({
      cmd: ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      cwd: root,
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
      stdout: "pipe",
      stderr: "pipe",
    });
    if (rg.success && rg.stdout) {
      return rg.stdout.toString().split("\n").filter((l) => l.length > 0);
    }
  } catch { /* rg not on PATH — fall through to in-process walker */ }

  return walkWithIgnore(root);
}

/**
 * Count lines for a batch of files using `wc -l`. Output format:
 *   "  N filename"
 *   "  N total"   (when more than one file is passed)
 *
 * We batch to avoid command-line length limits.
 */
function countLines(root: string, files: string[]): Map<string, number> {
  const result = new Map<string, number>();
  if (files.length === 0) return result;

  const BATCH = 200;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const r = Bun.spawnSync({
      cmd: ["wc", "-l", "--", ...batch],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (!r.stdout) continue;
    for (const line of r.stdout.toString().split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(.+)$/);
      // Regex groups are typed `string | undefined` under strict mode even
      // when the whole match succeeded — guard explicitly.
      const countStr = m?.[1];
      const filename = m?.[2]?.trim();
      if (countStr === undefined || filename === undefined) continue;
      if (filename === "total") continue;
      result.set(filename, parseInt(countStr, 10));
    }
  }
  return result;
}

/** Group file stats by directory at the given depth (1-indexed). */
function aggregateAtDepth(files: FileStats[], depth: number): PartitionUnit[] {
  const map = new Map<string, PartitionUnit>();
  for (const f of files) {
    const parts = f.path.split("/");
    const key = parts.length >= depth
      ? parts.slice(0, depth).join("/")
      : (parts.slice(0, parts.length - 1).join("/") || "(root)");
    let cur = map.get(key);
    if (!cur) {
      cur = { path: key, loc: 0, fileCount: 0, files: [] };
      map.set(key, cur);
    }
    cur.loc += f.loc;
    cur.fileCount += 1;
    cur.files.push(f.path);
  }
  return [...map.values()];
}

/**
 * Build candidate partition units. Starts at depth 1 and drills down on any
 * unit that is too large (> 20% of total LOC) to balance partitions better.
 * A single drill-down pass is enough for typical codebases — we deliberately
 * do not recurse to keep behavior predictable.
 */
function buildPartitionUnits(files: FileStats[]): PartitionUnit[] {
  if (files.length === 0) return [];

  const totalLoc = files.reduce((s, f) => s + f.loc, 0);
  const drillThreshold = Math.max(Math.floor(totalLoc * 0.2), 1);

  const units = aggregateAtDepth(files, 1);

  // Drill down on oversized units (single pass).
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    // noUncheckedIndexedAccess makes units[i] possibly undefined; we know
    // it's defined because i < units.length, but TS can't prove that.
    if (unit === undefined) continue;
    if (unit.loc <= drillThreshold) continue;
    const subFiles = files.filter((f) =>
      f.path === unit.path || f.path.startsWith(unit.path + "/"),
    );
    const subUnits = aggregateAtDepth(subFiles, 2);
    if (subUnits.length > 1) {
      units.splice(i, 1, ...subUnits);
      i += subUnits.length - 1;
    }
  }

  return units.sort((a, b) => b.loc - a.loc);
}

/**
 * Render a compact, depth-bounded ASCII tree of the codebase. Used as prompt
 * context for the scout's architectural-overview LLM call.
 *
 * - `maxDepth`: how many directory levels to descend before stopping.
 * - `maxLines`: hard cap on output lines; we append "└── ..." if exceeded.
 *
 * Only directories show recursive file counts; leaf files appear as bare names.
 */
function renderTree(files: string[], maxDepth = 3, maxLines = 200): string {
  type Node = { children: Map<string, Node>; isFile: boolean; fileCount: number };
  const root: Node = { children: new Map(), isFile: false, fileCount: 0 };

  for (const file of files) {
    const parts = file.split("/");
    let cur = root;
    cur.fileCount += 1;
    for (let i = 0; i < parts.length && i < maxDepth; i++) {
      const part = parts[i];
      if (part === undefined) continue; // unreachable in practice
      let child = cur.children.get(part);
      if (!child) {
        child = { children: new Map(), isFile: false, fileCount: 0 };
        cur.children.set(part, child);
      }
      child.fileCount += 1;
      cur = child;
      if (i === parts.length - 1) cur.isFile = true;
    }
  }

  const lines: string[] = [];
  let truncated = false;

  function walk(node: Node, prefix: string): void {
    if (truncated) return;
    const entries = [...node.children.entries()].sort((a, b) => {
      const aIsDir = a[1].children.size > 0;
      const bIsDir = b[1].children.size > 0;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a[0].localeCompare(b[0]);
    });
    for (let i = 0; i < entries.length; i++) {
      if (lines.length >= maxLines) {
        lines.push(prefix + "└── ...");
        truncated = true;
        return;
      }
      const entry = entries[i];
      if (entry === undefined) continue; // unreachable in practice
      const [name, child] = entry;
      const last = i === entries.length - 1;
      const branch = last ? "└── " : "├── ";
      const isDir = child.children.size > 0;
      const label = isDir ? `${name}/  (${child.fileCount} files)` : name;
      lines.push(prefix + branch + label);
      walk(child, prefix + (last ? "    " : "│   "));
      if (truncated) return;
    }
  }

  walk(root, "");
  return lines.join("\n");
}

/**
 * Run the full scout: list files, count LOC, render tree, build partition units.
 */
export function scoutCodebase(root: string): CodebaseScout {
  const allPaths = listAllFiles(root);
  const codePaths = allPaths.filter(isCodeFile);
  const locMap = countLines(root, codePaths);

  const fileStats: FileStats[] = codePaths.map((p) => ({
    path: p,
    loc: locMap.get(p) ?? 0,
  }));

  const totalLoc = fileStats.reduce((s, f) => s + f.loc, 0);
  const totalFiles = fileStats.length;
  const treeSource = allPaths.length > 0 ? allPaths : codePaths;
  const tree = renderTree(treeSource, 3, 200);
  const units = buildPartitionUnits(fileStats);

  return { root, totalLoc, totalFiles, tree, units };
}

/**
 * Bin-pack partition units into `count` balanced groups. Greedy
 * largest-first: assign each unit to the currently-lightest bin.
 *
 * If there are fewer units than requested bins, the result has exactly
 * `units.length` non-empty bins (we never return empty bins).
 */
export function partitionUnits(
  units: PartitionUnit[],
  count: number,
): PartitionUnit[][] {
  if (units.length === 0) return [];
  const n = Math.max(1, Math.min(count, units.length));
  const bins: PartitionUnit[][] = Array.from({ length: n }, () => []);
  const totals: number[] = Array.from({ length: n }, () => 0);

  const sorted = [...units].sort((a, b) => b.loc - a.loc);
  for (const u of sorted) {
    let minIdx = 0;
    let minTotal = totals[0] ?? 0;
    for (let i = 1; i < n; i++) {
      const t = totals[i] ?? 0;
      if (t < minTotal) {
        minIdx = i;
        minTotal = t;
      }
    }
    const bin = bins[minIdx];
    if (bin === undefined) continue; // unreachable: minIdx ∈ [0, n)
    bin.push(u);
    totals[minIdx] = minTotal + u.loc;
  }

  return bins;
}
