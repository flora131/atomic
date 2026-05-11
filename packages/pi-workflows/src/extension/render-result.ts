/**
 * Render the workflow tool result as a compact string/object for display in chat.
 * Honors isPartial for streaming live progress.
 * cross-ref: pi-subagents src/extension/index.ts renderResult slot
 */

import type { StageSnapshot } from "../store-types.js";

export interface WorkflowRunEntry {
  runId: string;
  name: string;
  status: string;
}

export interface WorkflowInputEntry {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

export type WorkflowToolResult =
  | { action: "list"; workflows: string[] }
  | { action: "status"; runs: WorkflowRunEntry[] }
  | { action: "inputs"; name: string; inputs: WorkflowInputEntry[]; error?: string }
  | {
      action: "run";
      name?: string;
      runId: string;
      status: string;
      result?: Record<string, unknown>;
      error?: string;
      stages?: StageSnapshot[];
      /** @deprecated legacy compat — prefer error/stages */
      message?: string;
    }
  | { action: "kill"; runId: string; status: string; message: string }
  | { action: "resume"; runId: string; status: string; message: string }
  | { action: string; message: string };

export interface RenderResultOpts {
  isPartial?: boolean;
}

/**
 * Returns a compact human-readable string describing the tool result.
 * Used in the renderResult slot of the workflow tool registration.
 */
export function renderResult(result: WorkflowToolResult, opts?: RenderResultOpts): string {
  const partial = opts?.isPartial === true;

  if ("action" in result) {
    switch (result.action) {
      case "list": {
        const r = result as { action: "list"; workflows: string[] };
        if (r.workflows.length === 0) return "workflow list: (none registered)";
        return `workflow list: ${r.workflows.join(", ")}`;
      }
      case "status": {
        const r = result as { action: "status"; runs: WorkflowRunEntry[] };
        if (r.runs.length === 0) return "workflow status: (no in-flight runs)";
        const lines = r.runs.map((run) => `  ${run.runId}  ${run.name}  ${run.status}`);
        return `workflow status:\n${lines.join("\n")}`;
      }
      case "inputs": {
        const r = result as { action: "inputs"; name: string; inputs: WorkflowInputEntry[] };
        if (r.inputs.length === 0) return `workflow inputs: "${r.name}" has no declared inputs`;
        const lines = r.inputs.map((i) => {
          const req = i.required ? " (required)" : "";
          const def = i.default !== undefined ? ` [default: ${String(i.default)}]` : "";
          return `  ${i.name}: ${i.type}${req}${def}${i.description ? " — " + i.description : ""}`;
        });
        return `workflow inputs for "${r.name}":\n${lines.join("\n")}`;
      }
      case "run": {
        const r = result as {
          action: "run";
          name?: string;
          runId: string;
          status: string;
          result?: Record<string, unknown>;
          error?: string;
          stages?: StageSnapshot[];
          message?: string;
        };
        if (partial) return `workflow run ${r.runId}: ${r.status} (in progress…)`;
        if (r.error) {
          const label = r.name ? ` (${r.name})` : "";
          return `workflow run ${r.runId}${label}: ${r.status} — ${r.error}`;
        }
        // Legacy compat: if stages absent, fall back to message field
        if (r.stages === undefined) {
          return `workflow run ${r.runId}: ${r.message ?? r.status}`;
        }
        const stageCount = r.stages.length;
        const resultSummary = r.result ? ` result: ${JSON.stringify(r.result)}` : "";
        const label = r.name ? ` (${r.name})` : "";
        return `workflow run ${r.runId}${label}: ${r.status}, ${stageCount} stage(s)${resultSummary}`;
      }
      case "kill": {
        const r = result as { action: "kill"; runId: string; status: string; message: string };
        return `workflow kill ${r.runId}: ${r.message}`;
      }
      case "resume": {
        const r = result as { action: "resume"; runId: string; status: string; message: string };
        return `workflow resume ${r.runId}: ${r.message}`;
      }
      default:
        return `workflow: ${"message" in result ? result.message : JSON.stringify(result)}`;
    }
  }

  return JSON.stringify(result);
}
