/**
 * Lightweight shared constants for build/release scripts.
 *
 * This module is intentionally free of heavy dependencies (e.g. the
 * workflow SDK) so that scripts like bump-version can run before
 * `bun install` in CI.
 */

/** npm package name of the workflow SDK. */
export const SDK_PACKAGE_NAME = "@bastani/atomic-workflows";

/** Repo-relative path to the workflow SDK package directory. */
export const WORKFLOW_SDK_DIR = "packages/workflow-sdk";

/** package.json files whose `version` field is bumped together. */
export const VERSION_FILES = [
  "package.json",
  `${WORKFLOW_SDK_DIR}/package.json`,
];
