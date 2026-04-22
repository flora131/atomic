/**
 * Utilities for merging JSON configuration files
 */

import { resolve, dirname } from "node:path";
import { ensureDir, pathExists, copyFile } from "../services/system/copy.ts";

type McpConfig = Record<string, unknown>;

/** Keys that hold named-object maps (server registries). */
const SERVER_MAP_KEYS = ["mcpServers", "servers", "lspServers"] as const;

function stripKeys(config: McpConfig, keys: readonly string[]): McpConfig {
  if (keys.length === 0) return config;
  const next: McpConfig = { ...config };
  for (const key of keys) delete next[key];
  return next;
}

/**
 * Merge source JSON file into destination JSON file
 * - Preserves all existing keys in destination
 * - Adds/updates keys from source
 * - For MCP server maps: preserves user's servers, adds/updates CLI-managed servers
 * - `excludeKeys` are stripped from the source before merging so they
 *   never propagate to the destination (destination keeps its own value).
 *
 * @param srcPath Path to source JSON file
 * @param destPath Path to destination JSON file (will be modified in place)
 * @param excludeKeys Top-level source keys to drop before merging
 */
export async function mergeJsonFile(
  srcPath: string,
  destPath: string,
  excludeKeys: readonly string[] = [],
): Promise<void> {
  if (resolve(srcPath) === resolve(destPath)) {
    return;
  }

  const [rawSrcConfig, destConfig] = await Promise.all([
    Bun.file(srcPath).json() as Promise<McpConfig>,
    Bun.file(destPath).json() as Promise<McpConfig>,
  ]);

  const srcConfig = stripKeys(rawSrcConfig, excludeKeys);

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

/**
 * Sync a JSON file from source to destination.
 *
 * - Creates the destination's parent directory if needed
 * - When the destination exists and `merge` is true (the default),
 *   merges via {@link mergeJsonFile} (source keys win, server maps
 *   are merged individually)
 * - Otherwise copies the source as-is
 * - `excludeKeys` drops top-level keys from the source before writing,
 *   so they never land in the destination (applies to both the merge
 *   and no-destination-yet code paths).
 *
 * This is the single entry-point for the merge-or-copy pattern used
 * by both project-level onboarding and global config sync.
 */
export async function syncJsonFile(
  srcPath: string,
  destPath: string,
  merge: boolean = true,
  excludeKeys: readonly string[] = [],
): Promise<void> {
  await ensureDir(dirname(destPath));

  if (merge && (await pathExists(destPath))) {
    await mergeJsonFile(srcPath, destPath, excludeKeys);
    return;
  }

  if (excludeKeys.length === 0) {
    await copyFile(srcPath, destPath);
    return;
  }

  const srcConfig = (await Bun.file(srcPath).json()) as McpConfig;
  const stripped = stripKeys(srcConfig, excludeKeys);
  await Bun.write(destPath, JSON.stringify(stripped, null, 2) + "\n");
}
