/**
 * Progress UI primitives for the first-run install flow (auto-sync).
 *
 * Renders an OpenCode-inspired single-line progress bar:
 *
 *     ⠋ ■■■■■■■■■■■■■■■■■■････････････  50%  tmux / psmux
 *
 * where the braille spinner is provided by `@clack/prompts` and the bar
 * uses Catppuccin Mocha accent colors (Blue for progress, Green for
 * success, Red for error) with true-color → 256-color → basic ANSI
 * fallback.
 *
 * Steps are grouped into **phases**. Steps within a phase run in parallel
 * (via `Promise.all`); phases themselves run sequentially so later phases
 * can depend on earlier ones (e.g. npm must be available before
 * `npm install -g` tasks). The progress bar advances and the label
 * updates in real-time as individual steps complete within a phase.
 *
 * A final summary (✓/✗ per step) is printed after all steps finish, and
 * any captured stderr/stdout from a failed step is shown beneath it.
 *
 * Kept intentionally small — this is not a general-purpose progress
 * library, just what auto-sync needs to stop being visually noisy.
 */

import { spinner } from "@clack/prompts";
import { COLORS } from "@/theme/colors.ts";
import {
  supportsTrueColor,
  supports256Color,
} from "@/services/system/detect.ts";

const BAR_WIDTH = 30;
const BAR_FILLED = "■";
const BAR_EMPTY = "･";

/**
 * Semantic bar states mapped to Catppuccin Mocha colors:
 *   progress → Blue  #89b4fa (accent; "in flight")
 *   success  → Green #a6e3a1 (universal "completed")
 *   error    → Red   #f38ba8 (universal "failed")
 *
 * The empty track stays dim regardless — only the filled portion carries
 * the status signal, which keeps the bar legible while still telegraphing
 * the outcome at a glance.
 */
type BarState = "progress" | "success" | "error";

function fillColor(state: BarState): string {
  if (supportsTrueColor()) {
    switch (state) {
      case "success":
        return "\x1b[38;2;166;227;161m"; // Catppuccin Green #a6e3a1
      case "error":
        return "\x1b[38;2;243;139;168m"; // Catppuccin Red   #f38ba8
      case "progress":
      default:
        return "\x1b[38;2;137;180;250m"; // Catppuccin Blue  #89b4fa
    }
  }
  if (supports256Color()) {
    switch (state) {
      case "success":
        return "\x1b[38;5;150m";
      case "error":
        return "\x1b[38;5;211m";
      case "progress":
      default:
        return "\x1b[38;5;111m";
    }
  }
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

/** Render a progress bar: colored filled ■ + dim empty ･ */
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
  const safeTotal = Math.max(1, total);
  const pct = Math.round(
    Math.max(0, Math.min(1, completed / safeTotal)) * 100,
  );
  const percent = `${COLORS.dim}${String(pct).padStart(3)}%${COLORS.reset}`;
  return `${bar}  ${percent}  ${label}`;
}

export interface StepResult {
  label: string;
  ok: boolean;
  /** Error message (if any) surfaced in the final summary. */
  error?: string;
}

export interface Step {
  label: string;
  fn: () => Promise<unknown>;
}

/** A phase is a group of steps that run in parallel. */
export type Phase = Step[];

/**
 * Runs phases of async steps with a single persistent spinner line
 * showing stepped progress. Steps within each phase run in parallel;
 * phases run sequentially so later phases can depend on earlier ones.
 *
 * Each step's failure is collected rather than thrown, mirroring
 * auto-sync's "best-effort" contract.
 *
 * Returns the per-step results in phase/submission order so the caller
 * can render a summary.
 */
export async function runSteps(phases: Phase[]): Promise<StepResult[]> {
  const total = phases.reduce((n, phase) => n + phase.length, 0);
  const results: StepResult[] = [];
  const s = spinner();
  let completed = 0;

  // Start with 0/total so the user sees the bar immediately.
  s.start(formatLine(0, total, phases[0]?.[0]?.label ?? ""));

  for (const phase of phases) {
    // Show all in-flight labels for this phase.
    const inFlight = new Set(phase.map((step) => step.label));
    s.message(formatLine(completed, total, [...inFlight].join(", ")));

    // Run every step in this phase concurrently.
    const phaseResults = await Promise.all(
      phase.map(async (step): Promise<StepResult> => {
        try {
          await step.fn();
          completed++;
          inFlight.delete(step.label);
          if (inFlight.size > 0) {
            s.message(
              formatLine(completed, total, [...inFlight].join(", ")),
            );
          }
          return { label: step.label, ok: true };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          completed++;
          inFlight.delete(step.label);
          if (inFlight.size > 0) {
            s.message(
              formatLine(completed, total, [...inFlight].join(", ")),
            );
          }
          return { label: step.label, ok: false, error: message };
        }
      }),
    );

    results.push(...phaseResults);
  }

  // Stop with a filled bar + final label. Bar color flips to the
  // universal status colors: green when every step succeeded, red when
  // any step failed.
  const okCount = results.filter((r) => r.ok).length;
  const allOk = okCount === total;
  const finalState: BarState = allOk ? "success" : "error";
  const finalLabel = allOk
    ? `${fillColor("success")}Setup complete${COLORS.reset}`
    : `${fillColor("error")}Setup finished with errors${COLORS.reset}`;
  s.stop(formatLine(total, total, finalLabel, finalState));

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
