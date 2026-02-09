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

interface AtomicSettings {
  model?: Record<string, string>; // agentType -> modelId
}

/** Global settings path: ~/.atomic/settings.json */
function globalSettingsPath(): string {
  return join(homedir(), ".atomic", "settings.json");
}

/** Local settings path: {cwd}/.atomic/settings.json */
function localSettingsPath(): string {
  return join(process.cwd(), ".atomic", "settings.json");
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
  const local = loadSettingsFile(localSettingsPath());
  if (local.model?.[agentType]) {
    return local.model[agentType];
  }
  const global = loadSettingsFile(globalSettingsPath());
  return global.model?.[agentType];
}

/**
 * Save a model preference to the global settings file (~/.atomic/settings.json).
 */
export function saveModelPreference(agentType: string, modelId: string): void {
  try {
    const path = globalSettingsPath();
    const settings = loadSettingsFile(path);
    settings.model = settings.model ?? {};
    settings.model[agentType] = modelId;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // Silently fail
  }
}
