/**
 * cli-flags — parse --workflow and --workflow-input-* argv flags, dispatch runtime.
 *
 * Entry points:
 *   registerWorkflowCliFlags(pi)   — register flag metadata with ExtensionAPI
 *   runWorkflowFromCliFlags(opts)  — parse argv, dispatch runtime, return result
 *
 * cross-ref: packages/pi-workflows/src/extension/index.ts (§5.13 flag registration)
 *            packages/pi-workflows/src/extension/runtime.ts (ExtensionRuntime.dispatch)
 */

import type { ExtensionAPI } from "./extension/index.js";
import type { ExtensionRuntime } from "./extension/runtime.js";
import type { WorkflowToolResult } from "./extension/render-result.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Parsed values extracted from argv for workflow execution. */
export interface WorkflowFlagValues {
  /** Workflow name from --workflow or --workflow=<name>. */
  workflow: string;
  /** Key/value inputs parsed from --workflow-input-<key>=<value> flags. */
  inputs: Record<string, unknown>;
}

export interface WorkflowCliAdapterOptions {
  /** ExtensionRuntime used to dispatch. */
  runtime: ExtensionRuntime;
  /**
   * Raw argv to parse.  Falls back to `process.argv.slice(2)` when omitted.
   * Pass an explicit array in tests to avoid touching the real process.
   */
  argv?: string[];
}

/** Result returned by runWorkflowFromCliFlags. */
export type WorkflowCliResult =
  | { handled: false }
  | { handled: true; status: "completed" | "failed"; result?: WorkflowToolResult; error?: string };

// ---------------------------------------------------------------------------
// Flag registration
// ---------------------------------------------------------------------------

/**
 * Register --workflow and --workflow-input-* flag metadata with the pi ExtensionAPI.
 * Safe to call when pi.registerFlag is absent (degrades silently).
 */
export function registerWorkflowCliFlags(pi: ExtensionAPI): void {
  if (typeof pi.registerFlag !== "function") return;

  pi.registerFlag({
    name: "workflow",
    description: "Run the named workflow headlessly (e.g. pi -p --workflow=<name>).",
    type: "string",
  });

  pi.registerFlag({
    name: "workflow-input-key",
    description:
      "Pass an input value to the workflow (repeat for multiple inputs, e.g. --workflow-input-<key>=<value>).",
    type: "string",
  });
}

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

/**
 * Attempt JSON parse; return original string on failure.
 */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Parse workflow flag values from a raw argv array.
 *
 * Supports:
 *   --workflow=<name>
 *   --workflow <name>
 *   --workflow-input-<key>=<value>
 *   --workflow-input-<key> <value>
 *
 * Values are JSON-parsed where possible (numbers, booleans, objects).
 * Returns null when --workflow is absent.
 */
export function parseWorkflowFlags(argv: string[]): WorkflowFlagValues | null {
  let workflow: string | null = null;
  const inputs: Record<string, unknown> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    // --workflow=<name>
    if (arg.startsWith("--workflow=")) {
      workflow = arg.slice("--workflow=".length);
      continue;
    }

    // --workflow <name>  (next token must exist and not start with --)
    if (arg === "--workflow") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        workflow = next;
        i++;
      }
      continue;
    }

    // --workflow-input-<key>=<value>
    const inputEqPrefix = "--workflow-input-";
    if (arg.startsWith(inputEqPrefix)) {
      const rest = arg.slice(inputEqPrefix.length);
      const eqIdx = rest.indexOf("=");
      if (eqIdx > 0) {
        const key = rest.slice(0, eqIdx);
        const raw = rest.slice(eqIdx + 1);
        inputs[key] = parseValue(raw);
      } else if (eqIdx === -1 && rest.length > 0) {
        // --workflow-input-<key> <value>
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          inputs[rest] = parseValue(next);
          i++;
        } else {
          // Flag present but no value — treat as boolean true
          inputs[rest] = true;
        }
      }
      continue;
    }
  }

  if (workflow === null) return null;

  return { workflow, inputs };
}

// ---------------------------------------------------------------------------
// Runtime dispatch
// ---------------------------------------------------------------------------

/**
 * Parse argv flags and dispatch via the provided runtime.
 *
 * Returns `{ handled: false }` when --workflow is absent.
 * Returns `{ handled: true, status, result?, error? }` otherwise.
 * Never silently swallows dispatch errors — real errors propagate as `status: "failed"`.
 */
export async function runWorkflowFromCliFlags(
  opts: WorkflowCliAdapterOptions,
): Promise<WorkflowCliResult> {
  const argv = opts.argv ?? process.argv.slice(2);
  const parsed = parseWorkflowFlags(argv);

  if (parsed === null) {
    return { handled: false };
  }

  try {
    const result = await opts.runtime.dispatch({
      action: "run",
      name: parsed.workflow,
      inputs: parsed.inputs,
    });

    if (result.action === "run") {
      const r = result as Extract<WorkflowToolResult, { action: "run" }>;
      const status = r.status === "failed" ? "failed" : "completed";
      return { handled: true, status, result, error: r.error };
    }

    // Unexpected action from dispatch — treat as completed with raw result
    return { handled: true, status: "completed", result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { handled: true, status: "failed", error: message };
  }
}
