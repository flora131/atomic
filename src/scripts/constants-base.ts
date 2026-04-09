/**
 * Lightweight shared constants for build/release scripts.
 *
 * This module is intentionally free of heavy dependencies so that
 * scripts like bump-version can run before `bun install` in CI.
 */

/** npm package name. */
export const SDK_PACKAGE_NAME = "@bastani/atomic";

/** package.json files whose `version` field is bumped together. */
export const VERSION_FILES = [
  "package.json",
];
