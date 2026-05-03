/**
 * Lightweight shared constants for build/release scripts.
 *
 * This module is intentionally free of heavy dependencies so that
 * scripts like bump-version can run before `bun install` in CI.
 */

/** package.json files whose `version` field is bumped together. */
export const VERSION_FILES = [
  "package.json",
  "packages/atomic/package.json",
  "packages/atomic-sdk/package.json",
] as const;
