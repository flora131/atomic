/**
 * Utilities for merging JSON configuration files
 */

import { resolve } from "node:path";

type McpConfig = Record<string, unknown>;

/** Keys that hold named-object maps (server registries). */
const SERVER_MAP_KEYS = ["mcpServers", "servers", "lspServers"] as const;

/**
 * Merge source JSON file into destination JSON file
 * - Preserves all existing keys in destination
 * - Adds/updates keys from source
 * - For MCP server maps: preserves user's servers, adds/updates CLI-managed servers
 *
 * @param srcPath Path to source JSON file
 * @param destPath Path to destination JSON file (will be modified in place)
 */
export async function mergeJsonFile(
  srcPath: string,
  destPath: string
): Promise<void> {
  if (resolve(srcPath) === resolve(destPath)) {
    return;
  }

  const [srcConfig, destConfig] = await Promise.all([
    Bun.file(srcPath).json() as Promise<McpConfig>,
    Bun.file(destPath).json() as Promise<McpConfig>,
  ]);

  // Merge top-level config - preserve destination's other keys
  const mergedConfig: McpConfig = {
    ...destConfig,
    ...srcConfig,
  };

  // Server maps are merged individually so the destination's existing
  // entries are preserved while source entries are added or updated.
  for (const key of SERVER_MAP_KEYS) {
    const dst = destConfig[key] as Record<string, unknown> | undefined;
    const src = srcConfig[key] as Record<string, unknown> | undefined;
    if (dst || src) {
      mergedConfig[key] = { ...dst, ...src };
    }
  }

  await Bun.write(destPath, JSON.stringify(mergedConfig, null, 2) + "\n");
}
