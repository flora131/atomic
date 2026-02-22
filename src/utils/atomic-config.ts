/**
 * Atomic configuration file utilities for persisting project settings.
 *
 * Project/source-control selections are stored in `.atomic/settings.json`.
 * Resolution order:
 * 1) local `.atomic/settings.json` (project override)
 * 2) global `~/.atomic/settings.json` (default fallback)
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { type AgentKey } from "../config";
import { type SourceControlType } from "../config";
import { SETTINGS_SCHEMA_URL } from "./settings-schema";

const SETTINGS_DIR = ".atomic";
const SETTINGS_FILENAME = "settings.json";

/**
 * Atomic project configuration schema.
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

type JsonRecord = Record<string, unknown>;

function getGlobalSettingsPath(): string {
  const home = process.env.ATOMIC_SETTINGS_HOME ?? homedir();
  return join(home, SETTINGS_DIR, SETTINGS_FILENAME);
}

function getLocalSettingsPath(projectDir: string): string {
  return join(projectDir, SETTINGS_DIR, SETTINGS_FILENAME);
}

async function readJsonFile(path: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as JsonRecord;
  } catch {
    return null;
  }
}

function pickAtomicConfig(record: JsonRecord | null): AtomicConfig | null {
  if (!record) return null;

  const config: AtomicConfig = {};
  const version = record.version;
  const agent = record.agent;
  const scm = record.scm;
  const lastUpdated = record.lastUpdated;

  if (typeof version === "number") config.version = version;
  if (typeof agent === "string") config.agent = agent as AgentKey;
  if (typeof scm === "string") config.scm = scm as SourceControlType;
  if (typeof lastUpdated === "string") config.lastUpdated = lastUpdated;

  return Object.keys(config).length > 0 ? config : null;
}

function mergeConfigs(...configs: Array<AtomicConfig | null>): AtomicConfig | null {
  const merged: AtomicConfig = {};
  for (const config of configs) {
    if (!config) continue;
    if (config.version !== undefined) merged.version = config.version;
    if (config.agent !== undefined) merged.agent = config.agent;
    if (config.scm !== undefined) merged.scm = config.scm;
    if (config.lastUpdated !== undefined) merged.lastUpdated = config.lastUpdated;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Read atomic config with local override semantics.
 */
export async function readAtomicConfig(projectDir: string): Promise<AtomicConfig | null> {
  const localConfig = pickAtomicConfig(await readJsonFile(getLocalSettingsPath(projectDir)));
  const globalConfig = pickAtomicConfig(await readJsonFile(getGlobalSettingsPath()));

  // global < local settings
  return mergeConfigs(globalConfig, localConfig);
}

/**
 * Save project config to `.atomic/settings.json`.
 */
export async function saveAtomicConfig(
  projectDir: string,
  updates: Partial<AtomicConfig>
): Promise<void> {
  const localPath = getLocalSettingsPath(projectDir);

  const localSettings = (await readJsonFile(localPath)) ?? {};
  const localExistingConfig = pickAtomicConfig(localSettings);
  const currentConfig = localExistingConfig ?? {};

  const newConfig: AtomicConfig = {
    ...currentConfig,
    ...updates,
    version: 1,
    lastUpdated: new Date().toISOString(),
  };

  const nextSettings: JsonRecord = {
    ...localSettings,
    ...newConfig,
    $schema: SETTINGS_SCHEMA_URL,
  };

  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, JSON.stringify(nextSettings, null, 2) + "\n", "utf-8");
}

/**
 * Get selected SCM using local override + global fallback.
 */
export async function getSelectedScm(projectDir: string): Promise<SourceControlType | null> {
  const config = await readAtomicConfig(projectDir);
  return config?.scm ?? null;
}
