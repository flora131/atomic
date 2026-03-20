/**
 * Utilities for merging JSON configuration files
 */

import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  servers?: Record<string, unknown>;
  lspServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function mergeNamedObjectMap(
  destination: Record<string, unknown> | undefined,
  source: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!destination && !source) {
    return undefined;
  }

  return {
    ...destination,
    ...source,
  };
}

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

  const [srcContent, destContent] = await Promise.all([
    readFile(srcPath, "utf-8"),
    readFile(destPath, "utf-8"),
  ]);

  const srcConfig: McpConfig = JSON.parse(srcContent);
  const destConfig: McpConfig = JSON.parse(destContent);

  // Merge top-level config - preserve destination's other keys
  const mergedConfig: McpConfig = {
    ...destConfig,
    ...srcConfig,
  };

  mergedConfig.mcpServers = mergeNamedObjectMap(destConfig.mcpServers, srcConfig.mcpServers);
  mergedConfig.servers = mergeNamedObjectMap(destConfig.servers, srcConfig.servers);
  mergedConfig.lspServers = mergeNamedObjectMap(destConfig.lspServers, srcConfig.lspServers);

  await writeFile(destPath, JSON.stringify(mergedConfig, null, 2) + "\n");
}
