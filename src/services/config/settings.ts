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
  model?: Record<string, string>; // agentType -> modelId
  reasoningEffort?: Record<string, string>; // agentType -> effort level
  prerelease?: boolean;
  trustedPaths?: TrustedPathEntry[];
}

const CLAUDE_CANONICAL_MODELS = ["opus", "sonnet", "haiku"] as const;

function extractClaudeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.includes("/")) return trimmed;
  const parts = trimmed.split("/");
  return parts.length >= 2 ? parts.slice(1).join("/") : trimmed;
}

function normalizeClaudeModelPreference(modelId: string): string {
  const normalized = extractClaudeModelId(modelId).trim().toLowerCase();
  if (!normalized || normalized === "default") {
    return "opus";
  }

  const canonical = CLAUDE_CANONICAL_MODELS.find((name) =>
    normalized === name || normalized.includes(name)
  );
  if (canonical) {
    return canonical;
  }

  return extractClaudeModelId(modelId).trim();
}

function normalizeModelPreference(agentType: string, modelId: string): string {
  if (agentType !== "claude") {
    return modelId;
  }

  return normalizeClaudeModelPreference(modelId);
}

/** Global settings path: ~/.atomic/settings.json */
function globalSettingsPath(): string {
  const home = process.env.ATOMIC_SETTINGS_HOME ?? homedir();
  return join(home, ".atomic", "settings.json");
}

/** Local settings path: {cwd}/.atomic/settings.json (CWD-scoped by design) */
function localSettingsPath(): string {
  const cwd = process.env.ATOMIC_SETTINGS_CWD ?? process.cwd();
  return join(cwd, ".atomic", "settings.json");
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

/**
 * Get the effective model preference for an agent type.
 * Checks local (.atomic/settings.json) first, then global (~/.atomic/settings.json).
 */
export async function getModelPreference(agentType: string): Promise<string | undefined> {
  // Local overrides global
  const localModel = (await loadSettingsFile(localSettingsPath())).model?.[agentType];
  if (localModel) {
    return normalizeModelPreference(agentType, localModel);
  }
  const globalModel = (await loadSettingsFile(globalSettingsPath())).model?.[agentType];
  if (globalModel) {
    return normalizeModelPreference(agentType, globalModel);
  }
  return undefined;
}

/**
 * Save a model preference to the global settings file (~/.atomic/settings.json).
 */
export function saveModelPreference(agentType: string, modelId: string): void {
  try {
    const settings = loadSettingsFileSync(globalSettingsPath());
    settings.$schema = SETTINGS_SCHEMA_URL;
    settings.model = settings.model ?? {};
    settings.model[agentType] = normalizeModelPreference(agentType, modelId);
    writeGlobalSettingsSync(settings);
  } catch {
    // Silently fail
  }
}

/**
 * Get the persisted reasoning effort preference for an agent type.
 * Checks local (.atomic/settings.json) first, then global (~/.atomic/settings.json).
 */
export async function getReasoningEffortPreference(agentType: string): Promise<string | undefined> {
  const local = await loadSettingsFile(localSettingsPath());
  if (local.reasoningEffort?.[agentType]) {
    return local.reasoningEffort[agentType];
  }
  const global = await loadSettingsFile(globalSettingsPath());
  return global.reasoningEffort?.[agentType];
}

/**
 * Save a reasoning effort preference to the global settings file (~/.atomic/settings.json).
 */
export function saveReasoningEffortPreference(agentType: string, effort: string): void {
  try {
    const settings = loadSettingsFileSync(globalSettingsPath());
    settings.$schema = SETTINGS_SCHEMA_URL;
    settings.reasoningEffort = settings.reasoningEffort ?? {};
    settings.reasoningEffort[agentType] = effort;
    writeGlobalSettingsSync(settings);
  } catch {
    // Silently fail
  }
}

/**
 * Clear a persisted reasoning effort preference (e.g., when switching to a non-reasoning model).
 */
export function clearReasoningEffortPreference(agentType: string): void {
  try {
    const settings = loadSettingsFileSync(globalSettingsPath());
    if (settings.reasoningEffort?.[agentType]) {
      delete settings.reasoningEffort[agentType];
      settings.$schema = SETTINGS_SCHEMA_URL;
      writeGlobalSettingsSync(settings);
    }
  } catch {
    // Silently fail
  }
}

/**
 * Get the prerelease channel preference.
 * Only checks global settings (~/.atomic/settings.json) since this is an install-level setting.
 */
export function getPrereleasePreference(): boolean {
  return loadSettingsFileSync(globalSettingsPath()).prerelease === true;
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
