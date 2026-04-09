/**
 * User settings persistence
 *
 * Stores user settings (e.g., model selection) across sessions.
 * Settings are resolved in priority order:
 *   1. .atomic/settings.json   (project-local, higher priority)
 *   2. ~/.atomic/settings.json (global, lower priority)
 *
 * The --model CLI flag takes precedence over both (handled at call site).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { SETTINGS_SCHEMA_URL } from "@/services/config/settings-schema.ts";
import { ensureDirSync } from "@/services/system/copy.ts";
import type { AgentKey } from "@/services/config/definitions.ts";

export interface TrustedPathEntry {
  workspacePath: string;
  provider: AgentKey;
}

interface AtomicSettings {
  $schema?: string;
  scm?: "github" | "sapling";
  version?: number;
  lastUpdated?: string;
  trustedPaths?: TrustedPathEntry[];
}

/** Global settings path: ~/.atomic/settings.json */
function globalSettingsPath(): string {
  const home = process.env.ATOMIC_SETTINGS_HOME ?? homedir();
  return join(home, ".atomic", "settings.json");
}

function loadSettingsFileSync(path: string): AtomicSettings {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as AtomicSettings;
    }
  } catch {
    // Silently fail
  }
  return {};
}

async function loadSettingsFile(path: string): Promise<AtomicSettings> {
  try {
    return await Bun.file(path).json() as AtomicSettings;
  } catch {
    // Silently fail (file doesn't exist or invalid JSON)
  }
  return {};
}

function writeGlobalSettingsSync(settings: AtomicSettings): void {
  const path = globalSettingsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) ensureDirSync(dir);
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
}

function normalizeTrustedPathEntry(entry: TrustedPathEntry): TrustedPathEntry {
  return {
    workspacePath: resolve(entry.workspacePath),
    provider: entry.provider,
  };
}

function normalizeTrustedPaths(entries: TrustedPathEntry[] | undefined): TrustedPathEntry[] {
  const deduped = new Map<string, TrustedPathEntry>();

  for (const entry of entries ?? []) {
    if (
      typeof entry.workspacePath !== "string" ||
      typeof entry.provider !== "string"
    ) {
      continue;
    }

    const normalizedEntry = normalizeTrustedPathEntry(entry);
    deduped.set(
      `${normalizedEntry.provider}:${normalizedEntry.workspacePath}`,
      normalizedEntry,
    );
  }

  return Array.from(deduped.values());
}

export async function isTrustedWorkspacePath(
  workspacePath: string,
  provider: AgentKey,
): Promise<boolean> {
  const settings = await loadSettingsFile(globalSettingsPath());
  const normalizedWorkspacePath = resolve(workspacePath);

  return normalizeTrustedPaths(settings.trustedPaths).some((entry) =>
    entry.provider === provider && entry.workspacePath === normalizedWorkspacePath
  );
}

export function upsertTrustedWorkspacePath(
  workspacePath: string,
  provider: AgentKey,
): void {
  try {
    const settings = loadSettingsFileSync(globalSettingsPath());
    settings.$schema = SETTINGS_SCHEMA_URL;
    settings.trustedPaths = normalizeTrustedPaths([
      ...(settings.trustedPaths ?? []),
      { workspacePath, provider },
    ]);
    writeGlobalSettingsSync(settings);
  } catch {
    // Silently fail
  }
}

/**
 * Set telemetry enabled/disabled in global settings.
 */
export function setTelemetryEnabled(enabled: boolean): void {
  try {
    const settings = loadSettingsFileSync(globalSettingsPath());
    settings.$schema = SETTINGS_SCHEMA_URL;
    (settings as Record<string, unknown>).telemetryEnabled = enabled;
    writeGlobalSettingsSync(settings);
  } catch {
    // Silently fail
  }
}
