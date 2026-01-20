/**
 * Utilities for merging JSON configuration files
 */

import { readFile, writeFile } from "fs/promises";

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Merge source JSON file into destination JSON file
 * - Preserves all existing keys in destination
 * - Adds/updates keys from source
 * - For mcpServers: preserves user's servers, adds/updates CLI-managed servers
 *
 * @param srcPath Path to source JSON file
 * @param destPath Path to destination JSON file (will be modified in place)
 */
export async function mergeJsonFile(
  srcPath: string,
  destPath: string
): Promise<void> {
  const srcContent = await readFile(srcPath, "utf-8");
  const destContent = await readFile(destPath, "utf-8");

  const srcConfig: McpConfig = JSON.parse(srcContent);
  const destConfig: McpConfig = JSON.parse(destContent);

  // Deep merge mcpServers - source values override destination for same keys
  const mergedServers = {
    ...destConfig.mcpServers,
    ...srcConfig.mcpServers,
  };

  // Merge top-level config - preserve destination's other keys
  const mergedConfig: McpConfig = {
    ...destConfig,
    ...srcConfig,
    mcpServers: mergedServers,
  };

  await writeFile(destPath, JSON.stringify(mergedConfig, null, 2) + "\n");
}
