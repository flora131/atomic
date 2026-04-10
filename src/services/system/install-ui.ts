/**
 * Progress UI primitives for the first-run install flow (auto-sync).
 *
 * Renders a single persistent line:
 *
 *     ⠋ [██████▒▒▒▒▒▒] 3/7  tmux / psmux
 *
 * where the braille spinner animation is provided by `@clack/prompts`
 * and the bracketed bar tracks overall step progress (completed / total).
 * A final summary (✓/✗ per step) is printed after all steps finish, and
 * any captured stderr/stdout from a failed step is shown beneath it.
 *
 * Kept intentionally small — this is not a general-purpose progress
 * library, just what auto-sync needs to stop being visually noisy.
 */

import { spinner } from "@clack/prompts";
import { COLORS } from "@/theme/colors.ts";

const BAR_WIDTH = 18;
const BAR_FILLED = "█";
const BAR_EMPTY = "░";

/**
 * Semantic bar states:
 *   progress → blue (Catppuccin accent; "in flight")
 *   success  → green (universal "completed")
 *   error    → red   (universal "failed")
 *
 * The empty track stays dim regardless — only the filled portion carries
 * the status signal, which keeps the bar legible while still telegraphing
 * the outcome at a glance.
 */
type BarState = "progress" | "success" | "error";

function fillColor(state: BarState): string {
  switch (state) {
    case "success":
      return COLORS.green;
    case "error":
      return COLORS.red;
    case "progress":
    default:
      return COLORS.blue;
  }
}

/** Render a bracketed step-progress bar. `completed` is capped at `total`. */
function renderBar(
  completed: number,
  total: number,
  state: BarState,
): string {
  const safeTotal = Math.max(1, total);
  const ratio = Math.max(0, Math.min(1, completed / safeTotal));
  const filled = Math.round(ratio * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return (
    COLORS.bold +
    fillColor(state) +
    BAR_FILLED.repeat(filled) +
    COLORS.reset +
    COLORS.dim +
    BAR_EMPTY.repeat(empty) +
    COLORS.reset
  );
}

function formatLine(
  completed: number,
  total: number,
  label: string,
  state: BarState = "progress",
): string {
  const bar = renderBar(completed, total, state);
  const counter = `${COLORS.dim}${completed}/${total}${COLORS.reset}`;
  return `${bar}  ${counter}  ${label}`;
}

export interface StepResult {
  label: string;
  ok: boolean;
  /** Error message (if any) surfaced in the final summary. */
  error?: string;
}

/**
 * Runs a sequence of async steps with a single persistent spinner line
 * showing stepped progress. Each step's failure is collected rather than
 * thrown, mirroring auto-sync's "best-effort" contract.
 *
 * Returns the per-step results in submission order so the caller can
 * render a summary.
 */
export async function runSteps(
  steps: Array<{ label: string; fn: () => Promise<unknown> }>,
): Promise<StepResult[]> {
  const total = steps.length;
  const results: StepResult[] = [];
  const s = spinner();

  // Start with 0/total so the user sees the bar immediately.
  s.start(formatLine(0, total, steps[0]?.label ?? ""));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    s.message(formatLine(i, total, step.label));

    try {
      await step.fn();
      results.push({ label: step.label, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ label: step.label, ok: false, error: message });
    }
  }

  // Stop with a filled bar + final label so the user sees we reached the
  // end rather than leaving the last in-flight step pinned. Bar color
  // flips to the universal status colors: green when every step
  // succeeded, red when any step failed. The per-step ✓/✗ rows printed
  // afterwards provide the detailed breakdown.
  const okCount = results.filter((r) => r.ok).length;
  const allOk = okCount === total;
  const finalLabel = allOk
    ? `${COLORS.green}Setup complete${COLORS.reset}`
    : `${COLORS.red}Setup finished with errors${COLORS.reset}`;
  s.stop(formatLine(total, total, finalLabel, allOk ? "success" : "error"));

  return results;
}

/**
 * Print a compact per-step summary after `runSteps`. Successes render as
 * a single dim line; failures render with a red cross and an indented
 * excerpt of the captured error.
 */
export function printSummary(results: StepResult[]): void {
  for (const result of results) {
    if (result.ok) {
      console.log(
        `  ${COLORS.green}✓${COLORS.reset} ${COLORS.dim}${result.label}${COLORS.reset}`,
      );
    } else {
      console.log(
        `  ${COLORS.red}✗${COLORS.reset} ${result.label}`,
      );
      if (result.error) {
        // Indent the first ~4 lines of the error so it reads as a nested
        // block rather than wall-of-text.
        const lines = result.error.split("\n").slice(0, 4);
        for (const line of lines) {
          console.log(`    ${COLORS.dim}${line}${COLORS.reset}`);
        }
      }
    }
  }
}
