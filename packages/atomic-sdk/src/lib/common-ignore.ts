/**
 * Common gitignore-style filter for agent config copy operations.
 *
 * Uses the `ignore` package (gitignore-compatible glob matching) so that
 * per-agent `exclude` lists only need to contain meaningful,
 * domain-specific entries — OS junk, dependency dirs, lockfiles, and
 * similar noise are handled here.
 */

import ignore, { type Ignore } from "ignore";

/**
 * Patterns that should never be copied during agent config operations.
 *
 * These mirror the most common entries found in a typical `.gitignore`
 * and cover OS-generated files, dependency directories, lockfiles, and
 * build artifacts.
 */
const COMMON_IGNORE_PATTERNS: readonly string[] = [
  // macOS
  ".DS_Store",
  "__MACOSX/",
  "._*",

  // Windows
  "Thumbs.db",

  // Dependencies
  "node_modules/",

  // Lockfiles
  "bun.lock",

  // Logs
  "*.log",
];

/**
 * Create an {@link Ignore} filter pre-loaded with common gitignore
 * patterns. Pass the returned instance as `ignoreFilter` in
 * {@link CopyOptions} so agent-specific `exclude` lists stay focused
 * on meaningful entries.
 */
export function createCommonIgnoreFilter(): Ignore {
  return ignore().add(COMMON_IGNORE_PATTERNS);
}
