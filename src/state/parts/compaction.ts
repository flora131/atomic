/**
 * Parts Compaction for Memory Pressure
 *
 * Pure functions for compacting a message's Part[] array when a workflow stage
 * completes. Completed stages accumulate tool parts, reasoning parts, and
 * verbose text that are no longer needed at full fidelity. Compaction replaces
 * these verbose parts with a single `CompactionPart` summary, dramatically
 * reducing the memory footprint of long-running workflows.
 *
 * The compaction runs as a post-processing step inside
 * `upsertWorkflowStepComplete()` — it fires only when a
 * `workflow-step-complete` event carries a `compaction` config.
 *
 * **What is compacted:**
 * - `tool` parts with status `completed` or `error`
 * - `reasoning` parts (extended thinking output)
 * - `text` parts that are not actively streaming
 *
 * **What is preserved (never compacted):**
 * - `workflow-step` parts (stage indicators)
 * - `task-list` parts (task tracker)
 * - `task-result` parts (task outcomes)
 * - `compaction` parts (existing summaries)
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
  CompactionPart,
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
 * Configuration for parts compaction on stage completion.
 *
 * Controls which part types are compacted and the minimum threshold
 * for triggering compaction (to avoid unnecessary work on small arrays).
 */
export interface PartsCompactionConfig {
  /**
   * Minimum number of compactable parts that must exist for compaction
   * to be triggered. Below this threshold, parts are left as-is.
   * @default 3
   */
  readonly minCompactableParts: number;

  /**
   * Whether to compact `text` parts belonging to the completed stage.
   * When false, only `tool` and `reasoning` parts are compacted.
   * @default true
   */
  readonly compactText: boolean;

  /**
   * Whether to compact `reasoning` parts belonging to the completed stage.
   * @default true
   */
  readonly compactReasoning: boolean;

  /**
   * Whether to compact `tool` parts belonging to the completed stage.
   * @default true
   */
  readonly compactTools: boolean;
}

/**
 * Result returned by `compactStageParts()`.
 */
export interface CompactionResult {
  /** The compacted parts array. */
  readonly parts: Part[];
  /** Whether compaction was actually applied. */
  readonly compacted: boolean;
  /** Number of parts that were replaced by the compaction summary. */
  readonly removedCount: number;
  /** Total estimated bytes reclaimed (sum of text content lengths). */
  readonly reclaimedBytes: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default minimum compactable parts threshold. */
export const DEFAULT_MIN_COMPACTABLE_PARTS = 3;

/**
 * Create a `PartsCompactionConfig` with sensible defaults.
 */
export function createDefaultPartsCompactionConfig(
  overrides?: Partial<PartsCompactionConfig>,
): PartsCompactionConfig {
  return {
    minCompactableParts: overrides?.minCompactableParts ?? DEFAULT_MIN_COMPACTABLE_PARTS,
    compactText: overrides?.compactText ?? true,
    compactReasoning: overrides?.compactReasoning ?? true,
    compactTools: overrides?.compactTools ?? true,
  };
}

// ---------------------------------------------------------------------------
// Part Classification
// ---------------------------------------------------------------------------

/** Part types that are never compacted. */
const PRESERVED_TYPES = new Set<Part["type"]>([
  "workflow-step",
  "task-list",
  "task-result",
  "compaction",
  "agent",
  "agent-list",
  "skill-load",
  "mcp-snapshot",
]);

/**
 * Determine whether a part is compactable given the config.
 */
function isCompactable(part: Part, config: PartsCompactionConfig): boolean {
  if (PRESERVED_TYPES.has(part.type)) {
    return false;
  }

  switch (part.type) {
    case "text": {
      if (!config.compactText) return false;
      // Don't compact actively streaming text
      return !(part as TextPart).isStreaming;
    }
    case "reasoning":
      return config.compactReasoning;
    case "tool": {
      if (!config.compactTools) return false;
      const toolPart = part as ToolPart;
      // Only compact completed or errored tools, not pending/running ones
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
 * Build a human-readable summary of the compacted parts.
 */
function buildCompactionSummary(
  nodeName: string,
  compactedParts: ReadonlyArray<Part>,
): string {
  const counts = new Map<string, number>();
  for (const part of compactedParts) {
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
    return `${nodeName} stage compacted`;
  }

  return `${nodeName}: ${segments.join(", ")} compacted`;
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
 * Compact parts belonging to a completed workflow stage.
 *
 * Replaces compactable parts (tool, reasoning, text) that fall within the
 * completed stage's boundary with a single `CompactionPart` summary.
 *
 * Parts outside the stage boundary and preserved types are left untouched.
 *
 * @param parts       - The current message parts array.
 * @param completedNodeId - The nodeId of the completed workflow step.
 * @param workflowId  - The workflowId for correlation.
 * @param nodeName    - Human-readable name of the completed step (for summary).
 * @param config      - Compaction configuration.
 * @returns A `CompactionResult` with the new parts array and statistics.
 */
export function compactStageParts(
  parts: ReadonlyArray<Part>,
  completedNodeId: string,
  workflowId: string,
  nodeName: string,
  config: PartsCompactionConfig,
): CompactionResult {
  const noopResult: CompactionResult = {
    parts: [...parts],
    compacted: false,
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

  // Identify compactable parts within the stage boundary.
  // The stage's content is between (stepIndex, nextStepIndex) — exclusive
  // on both ends. The step part itself is preserved; the next step part
  // belongs to the subsequent stage.
  const compactableIndices: number[] = [];
  const compactedParts: Part[] = [];
  let reclaimedBytes = 0;

  for (let i = stepIndex + 1; i < nextStepIndex; i++) {
    const part = parts[i]!;
    if (isCompactable(part, config)) {
      compactableIndices.push(i);
      compactedParts.push(part);
      reclaimedBytes += estimatePartBytes(part);
    }
  }

  // Check minimum threshold
  if (compactableIndices.length < config.minCompactableParts) {
    return noopResult;
  }

  // Build the compaction summary part
  const compactionPart: CompactionPart = {
    id: createPartId(),
    type: "compaction",
    summary: buildCompactionSummary(nodeName, compactedParts),
    createdAt: new Date().toISOString(),
  };

  // Build the new parts array: replace compactable parts with the summary
  const indicesToRemove = new Set(compactableIndices);
  const newParts: Part[] = [];
  let inserted = false;

  for (let i = 0; i < parts.length; i++) {
    if (indicesToRemove.has(i)) {
      // Insert the compaction part at the position of the first removed part
      if (!inserted) {
        newParts.push(compactionPart);
        inserted = true;
      }
      // Skip removed parts
      continue;
    }
    newParts.push(parts[i]!);
  }

  return {
    parts: newParts,
    compacted: true,
    removedCount: compactableIndices.length,
    reclaimedBytes,
  };
}
