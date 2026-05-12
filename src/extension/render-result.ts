/**
 * Render the workflow tool result for chat / LLM-tool surfaces.
 *
 * Rich background-workflow surfaces (status list, per-run detail) delegate
 * to the canonical Catppuccin renderers in `src/tui/`. Compact one-liners
 * (list/run/kill/resume) stay inline here.
 *
 * cross-ref:
 *  - src/tui/status-list.ts  band-header status list
 *  - src/tui/run-detail.ts   per-run detail block
 *  - pi-subagents src/extension/index.ts renderResult slot
 */

import type { RunSnapshot, StageSnapshot } from "../shared/store-types.js";
import type { RunDetail } from "../runs/background/status.js";
import { renderInputsSchema } from "../shared/render-inputs-schema.js";
import { renderStatusList } from "../tui/status-list.js";
import { renderRunDetail } from "../tui/run-detail.js";
import { deriveGraphTheme } from "../tui/graph-theme.js";

// ---------------------------------------------------------------------------
// Result variants
// ---------------------------------------------------------------------------

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
  /**
   * Allowed values when `type` is `"select"` — surfaces in the picker as a
   * radio row and in the pretty inputs listing as a `values:` line.
   */
  choices?: readonly string[];
  /** Optional hint shown when the field is empty in the interactive picker. */
  placeholder?: string;
}

type ListResult = { action: "list"; workflows: string[] };
type StatusResult = {
  action: "status";
  runs: WorkflowRunEntry[];
  /**
   * Optional snapshot data for rich rendering. When present the
   * canonical band-header status list is rendered; when absent the
   * compact one-line-per-run text form is rendered (back-compat).
   */
  snapshots?: RunSnapshot[];
};
type StatusDetailResult =
  | {
      action: "statusDetail";
      runId: string;
      detail: RunDetail;
    }
  | {
      action: "statusDetail";
      runId: string;
      error: string;
    };
type InputsResult = { action: "inputs"; name: string; inputs: WorkflowInputEntry[]; error?: string };
type RunResult = {
  action: "run";
  name?: string;
  runId: string;
  status: string;
  result?: Record<string, unknown>;
  error?: string;
  stages?: StageSnapshot[];
  /**
   * Free-form message carried by the result. Carries the "started in
   * background" copy emitted by `runDetached()`; foreground-completion
   * results don't set this since `error`/`stages` cover them.
   */
  message?: string;
};
type KillResult = { action: "kill"; runId: string; status: string; message: string };
type ResumeResult = { action: "resume"; runId: string; status: string; message: string };

export type WorkflowToolResult =
  | ListResult
  | StatusResult
  | StatusDetailResult
  | InputsResult
  | RunResult
  | KillResult
  | ResumeResult;

export interface RenderResultOpts {
  isPartial?: boolean;
  /**
   * Suppress ANSI colour output (CLI flag paths / non-TTY consumers).
   * When false/undefined the canonical Catppuccin chrome is rendered.
   */
  plain?: boolean;
}

/**
 * Returns a human-readable string describing the tool result. Multi-line
 * rich blocks for `status` / `statusDetail`; compact one-liners for the
 * remaining variants.
 *
 * Note: type assertions inside each `case` arm are required because the
 * fallback default below (`{ action: string }`) prevents TypeScript from
 * narrowing the union via `switch (result.action)`.
 */
export function renderResult(result: WorkflowToolResult, opts?: RenderResultOpts): string {
  const partial = opts?.isPartial === true;
  const themed = opts?.plain !== true;

  switch (result.action) {
    case "list": {
      const r = result as ListResult;
      if (r.workflows.length === 0) return "workflow list: (none registered)";
      return `workflow list: ${r.workflows.join(", ")}`;
    }

    case "status": {
      const r = result as StatusResult;
      if (r.snapshots) {
        return renderStatusList(r.snapshots, {
          theme: themed ? deriveGraphTheme({}) : undefined,
        });
      }
      if (r.runs.length === 0) return "workflow status: (no in-flight runs)";
      const lines = r.runs.map((run) => `  ${run.runId}  ${run.name}  ${run.status}`);
      return `workflow status:\n${lines.join("\n")}`;
    }

    case "statusDetail": {
      if ("error" in result) {
        const r = result as Extract<StatusDetailResult, { error: string }>;
        return `workflow status id=${r.runId}: ${r.error}`;
      }
      const r = result as Extract<StatusDetailResult, { detail: RunDetail }>;
      return renderRunDetail(r.detail, {
        theme: themed ? deriveGraphTheme({}) : undefined,
      });
    }

    case "inputs": {
      const r = result as InputsResult;
      return renderInputsSchema(r.name, r.inputs);
    }

    case "run": {
      const r = result as RunResult;
      if (partial) return `workflow run ${r.runId}: ${r.status} (in progress…)`;
      if (r.status === "failed" && !r.runId) {
        // Not-found path — render the error verbatim, no fake runId banner.
        const label = r.name ? ` (${r.name})` : "";
        return `workflow run${label}: ${r.error ?? "workflow not found"}`;
      }
      if (r.error) {
        const label = r.name ? ` (${r.name})` : "";
        return `workflow run ${r.runId}${label}: ${r.status} — ${r.error}`;
      }
      // Background dispatch — `runDetached()` returns status "running" and
      // a message; the workflow surfaces progress via store / overlay.
      const label = r.name ? ` (${r.name})` : "";
      return `workflow run ${r.runId}${label}: started in background — ${r.message ?? r.status}`;
    }

    case "kill": {
      const r = result as KillResult;
      return `workflow kill ${r.runId}: ${r.message}`;
    }

    case "resume": {
      const r = result as ResumeResult;
      return `workflow resume ${r.runId}: ${r.message}`;
    }

    default: {
      // Runtime guard — handles values coerced from external sources.
      const fallback = result as { action: string; message?: string };
      return `workflow: ${fallback.message ?? JSON.stringify(result)}`;
    }
  }
}
