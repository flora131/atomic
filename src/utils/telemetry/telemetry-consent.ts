/**
 * Telemetry consent module for user opt-in flow
 *
 * Provides:
 * - First-run detection via isFirstRun()
 * - Interactive consent prompt via promptTelemetryConsent()
 * - Orchestrated consent flow via handleTelemetryConsent()
 *
 * Reference: Spec Section 5.6 - UI Copy
 */

import { confirm, note, log } from "@clack/prompts";
import { isCancel } from "@clack/prompts";
import { readTelemetryState, setTelemetryEnabled } from "./telemetry";

/**
 * Check if this is the first time the telemetry system is being set up.
 * First run is detected by the absence of a telemetry.json state file.
 *
 * @returns true if no telemetry state exists (first run), false otherwise
 *
 * @example
 * ```ts
 * if (isFirstRun()) {
 *   await promptTelemetryConsent();
 * }
 * ```
 */
export function isFirstRun(): boolean {
  const state = readTelemetryState();
  return state === null;
}

/**
 * Display an informational consent prompt and ask the user to opt-in to telemetry.
 * Shows what IS collected and what is NEVER collected before asking for consent.
 *
 * @returns true if user consents, false if user declines or cancels
 *
 * @example
 * ```ts
 * const userConsented = await promptTelemetryConsent();
 * if (userConsented) {
 *   setTelemetryEnabled(true);
 * }
 * ```
 */
export async function promptTelemetryConsent(): Promise<boolean> {
  // Display what IS collected
  note(
    "What we collect:\n" +
      "  • Command names (init, help, etc.)\n" +
      "  • Agent type (claude, opencode, etc.)\n" +
      "  • Success/failure status",
    "Anonymous Telemetry"
  );

  // Display what is NEVER collected
  log.info(
    "We NEVER collect: prompts, file paths, code, or IP addresses."
  );

  // Display opt-out hint
  log.info(
    "You can opt out anytime with: ATOMIC_TELEMETRY=0"
  );

  // Ask for consent
  const result = await confirm({
    message: "Help improve Atomic by enabling anonymous telemetry?",
    initialValue: true,
  });

  // Handle cancellation (Ctrl+C)
  if (isCancel(result)) {
    return false;
  }

  return result;
}

/**
 * Orchestrate the complete telemetry consent flow.
 * Only prompts on first run; subsequent runs skip the prompt.
 *
 * Side effects:
 * - Creates telemetry.json state file with user's choice
 * - Sets enabled=true and consentGiven=true if user consents
 * - Sets enabled=false but still creates state file if user declines
 *   (this prevents re-prompting on subsequent runs)
 *
 * @example
 * ```ts
 * // In init command, after agent selection:
 * await handleTelemetryConsent();
 * ```
 */
export async function handleTelemetryConsent(): Promise<void> {
  // Only prompt on first run
  if (!isFirstRun()) {
    return;
  }

  // Get user's consent decision
  const consented = await promptTelemetryConsent();

  // Persist the choice (setTelemetryEnabled handles state creation)
  setTelemetryEnabled(consented);
}