/**
 * User preferences persistence
 *
 * Stores user preferences (e.g., model selection) across sessions.
 * Preferences are stored as JSON in a platform-appropriate location.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { getBinaryDataDir, detectInstallationType } from "./config-path.ts";

interface AtomicPreferences {
  model?: Record<string, string>; // agentType -> modelId
}

function getPreferencesPath(): string {
  const installType = detectInstallationType();
  if (installType === "binary") {
    return join(getBinaryDataDir(), "preferences.json");
  }
  // For source/npm, store in repo root
  return join(import.meta.dir, "..", "..", "preferences.json");
}

export function loadPreferences(): AtomicPreferences {
  try {
    const path = getPreferencesPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as AtomicPreferences;
    }
  } catch {
    // Silently fail
  }
  return {};
}

export function saveModelPreference(agentType: string, modelId: string): void {
  try {
    const path = getPreferencesPath();
    const prefs = loadPreferences();
    prefs.model = prefs.model ?? {};
    prefs.model[agentType] = modelId;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(prefs, null, 2), "utf-8");
  } catch {
    // Silently fail
  }
}

export function getModelPreference(agentType: string): string | undefined {
  const prefs = loadPreferences();
  return prefs.model?.[agentType];
}
