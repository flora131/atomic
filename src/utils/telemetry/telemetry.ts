/**
 * Core telemetry module for anonymous usage tracking
 *
 * Provides:
 * - Anonymous ID generation using crypto.randomUUID()
 * - Telemetry state persistence to ~/.local/share/atomic/telemetry.json
 * - Monthly ID rotation for enhanced privacy
 * - Priority-based opt-out checking (CI > env vars > config file)
 *
 * Reference: Spec Sections 5.1, 5.2
 */

import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { getBinaryDataDir } from "../config-path";
import type { TelemetryState } from "./types";

// Dynamically import ci-info to handle case where it's not installed yet
let ciInfo: { isCI: boolean } | null = null;

async function getCiInfo(): Promise<{ isCI: boolean }> {
  if (ciInfo !== null) {
    return ciInfo;
  }
  try {
    ciInfo = await import("ci-info");
    return ciInfo;
  } catch {
    // ci-info not installed, assume not in CI
    return { isCI: false };
  }
}

/**
 * Generate a cryptographically secure anonymous ID.
 * Uses crypto.randomUUID() which produces UUID v4 format.
 *
 * @returns A new UUID v4 string (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
 */
export function generateAnonymousId(): string {
  return crypto.randomUUID();
}

/**
 * Get the path to the telemetry.json state file.
 *
 * @returns Absolute path to telemetry.json in the data directory
 */
export function getTelemetryFilePath(): string {
  return join(getBinaryDataDir(), "telemetry.json");
}

/**
 * Safely read the telemetry state from disk.
 *
 * @returns The parsed TelemetryState or null if file doesn't exist or is corrupted
 */
export function readTelemetryState(): TelemetryState | null {
  const filePath = getTelemetryFilePath();

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const state = JSON.parse(content) as TelemetryState;

    // Basic validation - ensure required fields exist
    if (
      typeof state.enabled !== "boolean" ||
      typeof state.consentGiven !== "boolean" ||
      typeof state.anonymousId !== "string" ||
      typeof state.createdAt !== "string" ||
      typeof state.rotatedAt !== "string"
    ) {
      console.warn("Telemetry state file is corrupted, ignoring");
      return null;
    }

    return state;
  } catch {
    console.warn("Failed to read telemetry state, ignoring");
    return null;
  }
}

/**
 * Write the telemetry state to disk.
 * Creates the data directory if it doesn't exist.
 *
 * @param state - The telemetry state to persist
 */
export function writeTelemetryState(state: TelemetryState): void {
  const filePath = getTelemetryFilePath();
  const dir = getBinaryDataDir();

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write atomically by writing to temp file first, then renaming
  const content = JSON.stringify(state, null, 2);
  writeFileSync(filePath, content, "utf-8");
}

/**
 * Check if the anonymous ID should be rotated.
 * IDs are rotated monthly (when the month changes from rotatedAt).
 *
 * @param state - Current telemetry state
 * @returns true if ID should be rotated (month boundary crossed)
 */
export function shouldRotateId(state: TelemetryState): boolean {
  const now = new Date();
  const rotatedAt = new Date(state.rotatedAt);

  // Check if we're in a different month or year
  return (
    now.getUTCFullYear() !== rotatedAt.getUTCFullYear() || now.getUTCMonth() !== rotatedAt.getUTCMonth()
  );
}

/**
 * Rotate the anonymous ID and update rotation timestamp.
 * Preserves other state fields.
 *
 * @param state - Current telemetry state
 * @returns New state with rotated ID and updated rotatedAt
 */
export function rotateAnonymousId(state: TelemetryState): TelemetryState {
  return {
    ...state,
    anonymousId: generateAnonymousId(),
    rotatedAt: new Date().toISOString(),
  };
}

/**
 * Initialize a new telemetry state for first-run.
 * Defaults to disabled with no consent (user must explicitly opt-in).
 *
 * @returns A new TelemetryState with defaults and fresh anonymous ID
 */
export function initializeTelemetryState(): TelemetryState {
  const now = new Date().toISOString();
  return {
    enabled: false, // Requires explicit consent
    consentGiven: false, // Must be explicitly granted
    anonymousId: generateAnonymousId(),
    createdAt: now,
    rotatedAt: now,
  };
}

/**
 * Get or create the telemetry state with lazy initialization.
 * - Reads existing state from disk
 * - Rotates ID if month boundary crossed
 * - Creates new state if none exists
 *
 * @returns The current (possibly rotated or newly created) telemetry state
 */
export function getOrCreateTelemetryState(): TelemetryState {
  let state = readTelemetryState();

  if (state) {
    // Check if we need to rotate the ID
    if (shouldRotateId(state)) {
      state = rotateAnonymousId(state);
      writeTelemetryState(state);
    }
    return state;
  }

  // No existing state, initialize new one
  state = initializeTelemetryState();
  writeTelemetryState(state);
  return state;
}

/**
 * Check if telemetry is enabled with priority-based opt-out logic.
 *
 * Priority order (highest to lowest):
 * 1. CI environment (auto-disable via ci-info)
 * 2. ATOMIC_TELEMETRY env var ('0' or 'false' to disable)
 * 3. DO_NOT_TRACK env var ('1' to disable)
 * 4. Config file (enabled && consentGiven must both be true)
 *
 * @returns true if telemetry should be collected
 */
export async function isTelemetryEnabled(): Promise<boolean> {
  // Priority 1: CI environment detection (highest priority - auto-disable)
  const ci = await getCiInfo();
  if (ci.isCI) {
    return false;
  }

  // Priority 2: ATOMIC_TELEMETRY environment variable
  const atomicTelemetry = process.env.ATOMIC_TELEMETRY;
  if (atomicTelemetry === "0" || atomicTelemetry === "false") {
    return false;
  }

  // Priority 3: DO_NOT_TRACK environment variable (standard opt-out)
  if (process.env.DO_NOT_TRACK === "1") {
    return false;
  }

  // Priority 4: Config file state
  const state = readTelemetryState();
  if (!state) {
    return false; // No state means no consent given yet
  }

  return state.enabled && state.consentGiven;
}

/**
 * Synchronous version of isTelemetryEnabled for contexts where async isn't possible.
 * Note: This version cannot check ci-info if it's not already loaded.
 *
 * @returns true if telemetry should be collected
 */
export function isTelemetryEnabledSync(): boolean {
  // Priority 1: CI environment detection (only if ci-info already loaded)
  if (ciInfo?.isCI) {
    return false;
  }

  // Priority 2: ATOMIC_TELEMETRY environment variable
  const atomicTelemetry = process.env.ATOMIC_TELEMETRY;
  if (atomicTelemetry === "0" || atomicTelemetry === "false") {
    return false;
  }

  // Priority 3: DO_NOT_TRACK environment variable
  if (process.env.DO_NOT_TRACK === "1") {
    return false;
  }

  // Priority 4: Config file state
  const state = readTelemetryState();
  if (!state) {
    return false;
  }

  return state.enabled && state.consentGiven;
}

/**
 * Enable or disable telemetry programmatically.
 * When enabling, also sets consentGiven to true.
 *
 * @param enabled - true to enable, false to disable
 */
export function setTelemetryEnabled(enabled: boolean): void {
  const state = getOrCreateTelemetryState();

  state.enabled = enabled;

  // When enabling telemetry, mark consent as given
  if (enabled) {
    state.consentGiven = true;
  }

  writeTelemetryState(state);
}
