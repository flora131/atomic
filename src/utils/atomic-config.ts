/**
 * Atomic configuration file utilities for persisting project settings.
 *
 * The .atomic.json file stores project-level configuration including
 * the selected agent type and source control system.
 */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { type AgentKey } from "../config";
import { type SourceControlType } from "../config";

/** Config file name stored in project root */
const CONFIG_FILENAME = ".atomic.json";

/**
 * Atomic project configuration schema.
 *
 * Stored in .atomic.json at the project root.
 */
export interface AtomicConfig {
  /** Version of config schema */
  version?: number;
  /** Selected agent type */
  agent?: AgentKey;
  /** Selected source control type */
  scm?: SourceControlType;
  /** Timestamp of last init */
  lastUpdated?: string;
}

/**
 * Read atomic config from project directory.
 *
 * @param projectDir - The project root directory containing .atomic.json
 * @returns The parsed config or null if file doesn't exist or is invalid
 */
export async function readAtomicConfig(
  projectDir: string
): Promise<AtomicConfig | null> {
  const configPath = join(projectDir, CONFIG_FILENAME);
  try {
    const content = await readFile(configPath, "utf-8");
    return JSON.parse(content) as AtomicConfig;
  } catch {
    return null;
  }
}

/**
 * Save atomic config to project directory.
 *
 * Merges updates with existing config, automatically sets version and lastUpdated.
 *
 * @param projectDir - The project root directory
 * @param updates - Partial config to merge with existing settings
 */
export async function saveAtomicConfig(
  projectDir: string,
  updates: Partial<AtomicConfig>
): Promise<void> {
  const configPath = join(projectDir, CONFIG_FILENAME);
  const existing = (await readAtomicConfig(projectDir)) ?? {};

  const newConfig: AtomicConfig = {
    ...existing,
    ...updates,
    version: 1,
    lastUpdated: new Date().toISOString(),
  };

  await writeFile(
    configPath,
    JSON.stringify(newConfig, null, 2) + "\n",
    "utf-8"
  );
}

/**
 * Get the selected SCM type from atomic config.
 *
 * Convenience function for reading just the SCM selection.
 *
 * @param projectDir - The project root directory
 * @returns The selected SCM type or null if not configured
 */
export async function getSelectedScm(
  projectDir: string
): Promise<SourceControlType | null> {
  const config = await readAtomicConfig(projectDir);
  return config?.scm ?? null;
}
