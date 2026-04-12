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

import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { SETTINGS_SCHEMA_URL } from "@/services/config/settings-schema.ts";
import { ensureDir } from "@/services/system/copy.ts";
import { errorMessage } from "@/sdk/errors.ts";
import type { AgentKey, SourceControlType } from "@/services/config/definitions.ts";

export interface TrustedPathEntry {
  workspacePath: string;
  provider: AgentKey;
}

interface AtomicSettings {
  $schema?: string;
  scm?: SourceControlType;
  version?: number;
  lastUpdated?: string;
  trustedPaths?: TrustedPathEntry[];
  telemetryEnabled?: boolean;
}

/** Runtime guard for parsed JSON to ensure it's a plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Global settings path: ~/.atomic/settings.json */
function globalSettingsPath(): string {
  const home = process.env.ATOMIC_SETTINGS_HOME ?? homedir();
  return join(home, ".atomic", "settings.json");
}

async function loadSettingsFile(path: string): Promise<AtomicSettings> {
  try {
    const parsed: unknown = await Bun.file(path).json();
    if (isPlainObject(parsed)) return parsed as AtomicSettings;
  } catch {
    // File missing or invalid JSON — fall through to default
  }
  return {};
}

async function writeGlobalSettings(settings: AtomicSettings): Promise<void> {
  settings.$schema = SETTINGS_SCHEMA_URL;
  const path = globalSettingsPath();
  await ensureDir(dirname(path));
  await Bun.write(path, JSON.stringify(settings, null, 2));
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

export async function upsertTrustedWorkspacePath(
  workspacePath: string,
  provider: AgentKey,
): Promise<void> {
  try {
    const settings = await loadSettingsFile(globalSettingsPath());
    settings.trustedPaths = normalizeTrustedPaths([
      ...(settings.trustedPaths ?? []),
      { workspacePath, provider },
    ]);
    await writeGlobalSettings(settings);
  } catch (e) {
    console.warn(`[settings] failed to upsert trusted path: ${errorMessage(e)}`);
  }
}

/**
 * Set telemetry enabled/disabled in global settings.
 */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  try {
    const settings = await loadSettingsFile(globalSettingsPath());
    settings.telemetryEnabled = enabled;
    await writeGlobalSettings(settings);
  } catch (e) {
    console.warn(`[settings] failed to set telemetry: ${errorMessage(e)}`);
  }
}
