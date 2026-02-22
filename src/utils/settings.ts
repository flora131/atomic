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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { SETTINGS_SCHEMA_URL } from "./settings-schema";

interface AtomicSettings {
  $schema?: string;
  model?: Record<string, string>; // agentType -> modelId
  reasoningEffort?: Record<string, string>; // agentType -> effort level
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

function loadSettingsFile(path: string): AtomicSettings {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as AtomicSettings;
    }
  } catch {
    // Silently fail
  }
  return {};
}

/**
 * Get the effective model preference for an agent type.
 * Checks local (.atomic/settings.json) first, then global (~/.atomic/settings.json).
 */
export function getModelPreference(agentType: string): string | undefined {
  // Local overrides global
  const localModel = loadSettingsFile(localSettingsPath()).model?.[agentType];
  if (localModel) {
    return normalizeModelPreference(agentType, localModel);
  }
  const globalModel = loadSettingsFile(globalSettingsPath()).model?.[agentType];
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
    const path = globalSettingsPath();
    const settings = loadSettingsFile(path);
    settings.$schema = SETTINGS_SCHEMA_URL;
    settings.model = settings.model ?? {};
    settings.model[agentType] = normalizeModelPreference(agentType, modelId);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // Silently fail
  }
}

/**
 * Get the persisted reasoning effort preference for an agent type.
 * Checks local (.atomic/settings.json) first, then global (~/.atomic/settings.json).
 */
export function getReasoningEffortPreference(agentType: string): string | undefined {
  const local = loadSettingsFile(localSettingsPath());
  if (local.reasoningEffort?.[agentType]) {
    return local.reasoningEffort[agentType];
  }
  const global = loadSettingsFile(globalSettingsPath());
  return global.reasoningEffort?.[agentType];
}

/**
 * Save a reasoning effort preference to the global settings file (~/.atomic/settings.json).
 */
export function saveReasoningEffortPreference(agentType: string, effort: string): void {
  try {
    const path = globalSettingsPath();
    const settings = loadSettingsFile(path);
    settings.$schema = SETTINGS_SCHEMA_URL;
    settings.reasoningEffort = settings.reasoningEffort ?? {};
    settings.reasoningEffort[agentType] = effort;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // Silently fail
  }
}

/**
 * Clear a persisted reasoning effort preference (e.g., when switching to a non-reasoning model).
 */
export function clearReasoningEffortPreference(agentType: string): void {
  try {
    const path = globalSettingsPath();
    const settings = loadSettingsFile(path);
    if (settings.reasoningEffort?.[agentType]) {
      delete settings.reasoningEffort[agentType];
      writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
    }
  } catch {
    // Silently fail
  }
}
