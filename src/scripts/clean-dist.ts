#!/usr/bin/env bun
/**
 * Removes the dist directory relative to the repo root.
 *
 * Usage:
 *   bun run src/scripts/clean-dist.ts
 */

import { rm, access } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const DIST = resolve(ROOT, "dist");

/**
 * Removes the repo-local dist directory and verifies it no longer exists.
 *
 * @throws {Error} with path-specific message if dist still exists after removal.
 */
export async function cleanDist(): Promise<void> {
  await rm(DIST, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

  const stillExists = await access(DIST).then(
    () => true,
    () => false,
  );

  if (stillExists) {
    throw new Error(`Cleanup failed: "${DIST}" still exists after removal`);
  }
}

// Run when executed directly (not imported).
if (import.meta.main) {
  await cleanDist();
  console.log(`Removed: ${DIST}`);
}
