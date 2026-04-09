/**
 * Config path resolution.
 *
 * Two installation modes:
 * 1. Source/Development: Running from source with `bun run src/cli.ts`
 * 2. npm/bun installed: Installed via `bun add -g @bastani/atomic`
 */

import { join } from "path";

/**
 * Get the root directory where config folders (.claude, .opencode, .github) are stored.
 *
 * Navigates up from the current file to the package/repo root:
 * src/services/config/config-path.ts -> ../../.. -> root
 */
export function getConfigRoot(): string {
  return join(import.meta.dir, "..", "..", "..");
}
