/**
 * Verification Reporter
 *
 * Translates VerificationResult into human-readable PASS/FAIL diagnostics
 * with offending node/edge/field identifiers.
 */

import type {
  VerificationResult,
  PropertyResult,
} from "@/services/workflows/verification/types.ts";

/** Property display names for human-readable output. */
const PROPERTY_NAMES: Record<string, string> = {
  reachability: "Reachability",
  termination: "Termination",
  deadlockFreedom: "Deadlock-Freedom",
  loopBounds: "Loop Bounds",
  stateDataFlow: "State Data-Flow",
  modelValidation: "Model Validation",
};

/**
 * Format a single property result as a diagnostic line.
 */
function formatPropertyResult(name: string, result: PropertyResult): string {
  const displayName = PROPERTY_NAMES[name] ?? name;
  if (result.verified) {
    return `  PASS  ${displayName}`;
  }

  let line = `  FAIL  ${displayName}`;
  if (result.counterexample) {
    line += `: ${result.counterexample}`;
  }
  return line;
}

/**
 * Format a full VerificationResult into a multi-line diagnostic report.
 *
 * @param workflowId - The workflow name/ID for the header
 * @param result - The verification result to format
 * @returns Multi-line string suitable for console output
 */
export function formatVerificationReport(
  workflowId: string,
  result: VerificationResult,
): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push(`Workflow "${workflowId}" passed all verification checks`);
  } else {
    lines.push(`Workflow "${workflowId}" failed verification`);
  }

  lines.push("");

  for (const [name, propResult] of Object.entries(result.properties)) {
    if (propResult === undefined) continue;
    lines.push(formatPropertyResult(name, propResult));
  }

  return lines.join("\n");
}

/**
 * Format a verification result as a startup warning message.
 * Returns a yellow ANSI-colored warning string.
 */
export function formatStartupWarning(workflowId: string): string {
  return `\x1b[33m● Warning: Failed to load workflow: ${workflowId}\x1b[0m`;
}
