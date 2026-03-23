/**
 * Parts Truncation for Memory Pressure
 *
 * Pure functions for truncating a message's Part[] array when a workflow stage
 * completes. Completed stages accumulate tool parts, reasoning parts, and
 * verbose text that are no longer needed at full fidelity. Truncation replaces
 * these verbose parts with a single `TruncationPart` summary, dramatically
 * reducing the memory footprint of long-running workflows.
 *
 * The truncation runs as a post-processing step inside
 * `upsertWorkflowStepComplete()` — it fires only when a
 * `workflow-step-complete` event carries a `truncation` config.
 *
 * **What is truncated:**
 * - `tool` parts with status `completed` or `error`
 * - `reasoning` parts (extended thinking output)
 * - `text` parts that are not actively streaming
 *
 * **What is preserved (never truncated):**
 * - `workflow-step` parts (stage indicators)
 * - `task-list` parts (task tracker)
 * - `task-result` parts (task outcomes)
 * - `truncation` parts (existing summaries)
 * - `agent` parts (parallel agent displays)
 * - `agent-list` parts
 * - `skill-load` parts
 * - `mcp-snapshot` parts
 * - Parts created *after* the completed step (belong to the next stage)
 *
 * All functions are stateless and pure.
 */

import type {
  Part,
  TruncationPart,
  TextPart,
  ToolPart,
  ReasoningPart,
  WorkflowStepPart,
} from "@/state/parts/types.ts";
import { createPartId } from "@/state/parts/id.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for parts truncation on stage completion.
 *
 * Controls which part types are truncated and the minimum threshold
 * for triggering truncation (to avoid unnecessary work on small arrays).
 */
export interface PartsTruncationConfig {
  /**
   * Minimum number of truncatable parts that must exist for truncation
   * to be triggered. Below this threshold, parts are left as-is.
   * @default 5
   */
  readonly minTruncationParts: number;

  /**
   * Whether to truncate `text` parts belonging to the completed stage.
   * When false, only `tool` and `reasoning` parts are truncated.
   * @default true
   */
  readonly truncateText: boolean;

  /**
   * Whether to truncate `reasoning` parts belonging to the completed stage.
   * @default true
   */
  readonly truncateReasoning: boolean;

  /**
   * Whether to truncate `tool` parts belonging to the completed stage.
   * @default true
   */
  readonly truncateTools: boolean;
}

/**
 * Result returned by `truncateStageParts()`.
 */
export interface TruncationResult {
  /** The truncated parts array. */
  readonly parts: Part[];
  /** Whether truncation was actually applied. */
  readonly truncated: boolean;
  /** Number of parts that were replaced by the truncation summary. */
  readonly removedCount: number;
  /** Total estimated bytes reclaimed (sum of text content lengths). */
  readonly reclaimedBytes: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default minimum truncatable parts threshold. */
export const DEFAULT_MIN_TRUNCATION_PARTS = 5;

/**
 * Create a `PartsTruncationConfig` with sensible defaults.
 */
export function createDefaultPartsTruncationConfig(
  overrides?: Partial<PartsTruncationConfig>,
): PartsTruncationConfig {
  return {
    minTruncationParts: overrides?.minTruncationParts ?? DEFAULT_MIN_TRUNCATION_PARTS,
    truncateText: overrides?.truncateText ?? true,
    truncateReasoning: overrides?.truncateReasoning ?? true,
    truncateTools: overrides?.truncateTools ?? true,
  };
}

// ---------------------------------------------------------------------------
// Part Classification
// ---------------------------------------------------------------------------

/** Part types that are never truncated. */
const PRESERVED_TYPES = new Set<Part["type"]>([
  "workflow-step",
  "task-list",
  "task-result",
  "truncation",
  "agent",
  "agent-list",
  "skill-load",
  "mcp-snapshot",
]);

/**
 * Determine whether a part is truncatable given the config.
 */
function isTruncatable(part: Part, config: PartsTruncationConfig): boolean {
  if (PRESERVED_TYPES.has(part.type)) {
    return false;
  }

  switch (part.type) {
    case "text": {
      if (!config.truncateText) return false;
      // Don't truncate actively streaming text
      return !(part as TextPart).isStreaming;
    }
    case "reasoning":
      return config.truncateReasoning;
    case "tool": {
      if (!config.truncateTools) return false;
      const toolPart = part as ToolPart;
      // Only truncate completed or errored tools, not pending/running ones
      return toolPart.state.status === "completed" || toolPart.state.status === "error";
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Boundary Detection
// ---------------------------------------------------------------------------

/**
 * Find the completed workflow step's part index.
 *
 * Returns `null` if no matching part is found.
 */
function findStepPartIndex(
  parts: ReadonlyArray<Part>,
  completedNodeId: string,
  workflowId: string,
): number | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (
      p.type === "workflow-step" &&
      (p as WorkflowStepPart).nodeId === completedNodeId &&
      (p as WorkflowStepPart).workflowId === workflowId
    ) {
      return i;
    }
  }
  return null;
}

/**
 * Find the index of the next workflow-step part after a given index.
 *
 * The stage's content lives between the step part and the next step
 * part (or end of array). Returns `parts.length` if no next step exists.
 */
function findNextStepIndex(
  parts: ReadonlyArray<Part>,
  afterIndex: number,
  workflowId: string,
): number {
  for (let i = afterIndex + 1; i < parts.length; i++) {
    const p = parts[i]!;
    if (
      p.type === "workflow-step" &&
      (p as WorkflowStepPart).workflowId === workflowId
    ) {
      return i;
    }
  }
  return parts.length;
}

// ---------------------------------------------------------------------------
// Summary Generation
// ---------------------------------------------------------------------------

/**
 * Build a human-readable summary of the truncated parts.
 */
function buildTruncationSummary(
  nodeId: string,
  truncatedParts: ReadonlyArray<Part>,
): string {
  const counts = new Map<string, number>();
  for (const part of truncatedParts) {
    counts.set(part.type, (counts.get(part.type) ?? 0) + 1);
  }

  const segments: string[] = [];
  const toolCount = counts.get("tool") ?? 0;
  const textCount = counts.get("text") ?? 0;
  const reasoningCount = counts.get("reasoning") ?? 0;

  if (toolCount > 0) segments.push(`${toolCount} tool call${toolCount > 1 ? "s" : ""}`);
  if (textCount > 0) segments.push(`${textCount} text block${textCount > 1 ? "s" : ""}`);
  if (reasoningCount > 0) segments.push(`${reasoningCount} reasoning block${reasoningCount > 1 ? "s" : ""}`);

  if (segments.length === 0) {
    return `${nodeId} stage truncated`;
  }

  return `${nodeId}: ${segments.join(", ")} truncated`;
}

/**
 * Estimate the memory footprint of a part (in bytes of text content).
 */
function estimatePartBytes(part: Part): number {
  switch (part.type) {
    case "text":
      return (part as TextPart).content.length;
    case "reasoning":
      return (part as ReasoningPart).content.length;
    case "tool": {
      const tp = part as ToolPart;
      let bytes = JSON.stringify(tp.input).length;
      if (tp.state.status === "completed" && tp.state.output !== undefined) {
        bytes += JSON.stringify(tp.state.output).length;
      }
      if (tp.partialOutput) {
        bytes += tp.partialOutput.length;
      }
      return bytes;
    }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Core Compaction Function
// ---------------------------------------------------------------------------

/**
 * Truncate parts belonging to a completed workflow stage.
 *
 * Replaces truncatable parts (tool, reasoning, text) that fall within the
 * completed stage's boundary with a single `TruncationPart` summary.
 *
 * Parts outside the stage boundary and preserved types are left untouched.
 *
 * @param parts       - The current message parts array.
 * @param completedNodeId - The nodeId of the completed workflow step.
 * @param workflowId  - The workflowId for correlation.
 * @param config      - Truncation configuration.
 * @returns A `TruncationResult` with the new parts array and statistics.
 */
export function truncateStageParts(
  parts: ReadonlyArray<Part>,
  completedNodeId: string,
  workflowId: string,
  config: PartsTruncationConfig,
): TruncationResult {
  const noopResult: TruncationResult = {
    parts: [...parts],
    truncated: false,
    removedCount: 0,
    reclaimedBytes: 0,
  };

  // Find the completed step's part (marks the start of the stage)
  const stepIndex = findStepPartIndex(parts, completedNodeId, workflowId);
  if (stepIndex === null) {
    return noopResult;
  }

  // Find the end of this stage's parts (next step or end of array)
  const nextStepIndex = findNextStepIndex(parts, stepIndex, workflowId);

  // Identify truncatable parts within the stage boundary.
  // The stage's content is between (stepIndex, nextStepIndex) — exclusive
  // on both ends. The step part itself is preserved; the next step part
  // belongs to the subsequent stage.
  const truncatableIndices: number[] = [];
  const truncatedParts: Part[] = [];
  let reclaimedBytes = 0;

  for (let i = stepIndex + 1; i < nextStepIndex; i++) {
    const part = parts[i]!;
    if (isTruncatable(part, config)) {
      truncatableIndices.push(i);
      truncatedParts.push(part);
      reclaimedBytes += estimatePartBytes(part);
    }
  }

  // Check minimum threshold
  if (truncatableIndices.length < config.minTruncationParts) {
    return noopResult;
  }

  // Build the truncation summary part
  const truncationPart: TruncationPart = {
    id: createPartId(),
    type: "truncation",
    summary: buildTruncationSummary(completedNodeId, truncatedParts),
    createdAt: new Date().toISOString(),
  };

  // Build the new parts array: replace truncatable parts with the summary
  const indicesToRemove = new Set(truncatableIndices);
  const newParts: Part[] = [];
  let inserted = false;

  for (let i = 0; i < parts.length; i++) {
    if (indicesToRemove.has(i)) {
      // Insert the truncation part at the position of the first removed part
      if (!inserted) {
        newParts.push(truncationPart);
        inserted = true;
      }
      // Skip removed parts
      continue;
    }
    newParts.push(parts[i]!);
  }

  return {
    parts: newParts,
    truncated: true,
    removedCount: truncatableIndices.length,
    reclaimedBytes,
  };
}
