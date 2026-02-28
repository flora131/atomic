/**
 * Part Type Definitions
 *
 * Discriminated union types for the parts-based message rendering system.
 * Each ChatMessage contains an ordered Part[] array where each part
 * receives a monotonically increasing timestamp-encoded ID.
 */

import type { PartId } from "./id.ts";
import type { HitlResponseRecord } from "../utils/hitl-response.ts";
import type { PermissionOption } from "../../sdk/types.ts";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import type { TaskItem } from "../components/task-list-indicator.tsx";
import type { MessageSkillLoad } from "../chat.tsx";
import type { McpSnapshotView } from "../utils/mcp-output.ts";

/**
 * Common base for all part types.
 */
export interface BasePart {
  /** Unique identifier, encodes creation timestamp for ordering */
  id: PartId;
  /** Discriminant field for the part union */
  type: string;
  /** ISO 8601 timestamp, for display only (ordering uses id) */
  createdAt: string;
}

// ============================================================================
// TOOL STATE MACHINE
// ============================================================================

/**
 * Discriminated union for tool execution states.
 * No backward transitions allowed:
 *   pending → running → completed | error | interrupted
 */
export type ToolState =
  | { status: "pending" }
  | { status: "running"; startedAt: string }
  | { status: "completed"; output: unknown; durationMs: number }
  | { status: "error"; error: string; output?: unknown }
  | { status: "interrupted"; partialOutput?: unknown; durationMs?: number };

/**
 * Tool execution status union type.
 * Extracted from ToolState for components that only need the status.
 */
export type ToolExecutionStatus = ToolState["status"];

// ============================================================================
// CONCRETE PART TYPES
// ============================================================================

export interface TextPart extends BasePart {
  type: "text";
  /** Accumulated text (appended via deltas) */
  content: string;
  /** True while receiving deltas */
  isStreaming: boolean;
}

export interface ReasoningPart extends BasePart {
  type: "reasoning";
  thinkingSourceKey?: string;
  content: string;
  durationMs: number;
  isStreaming: boolean;
}

export interface ToolPart extends BasePart {
  type: "tool";
  /** SDK-native ID for correlation */
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  /** Incremental output streamed while tool is still running */
  partialOutput?: string;
  state: ToolState;
  hitlResponse?: HitlResponseRecord;

  /** HITL overlay fields (set when permission.requested fires) */
  pendingQuestion?: {
    requestId: string;
    header: string;
    question: string;
    options: PermissionOption[];
    multiSelect: boolean;
    respond: (answer: string | string[]) => void;
  };
}

export interface AgentPart extends BasePart {
  type: "agent";
  agents: ParallelAgent[];
  parentToolPartId?: PartId;
}

export interface TaskListPart extends BasePart {
  type: "task-list";
  items: TaskItem[];
  expanded: boolean;
}

export interface SkillLoadPart extends BasePart {
  type: "skill-load";
  skills: MessageSkillLoad[];
}

export interface McpSnapshotPart extends BasePart {
  type: "mcp-snapshot";
  snapshot: McpSnapshotView;
}

export interface CompactionPart extends BasePart {
  type: "compaction";
  summary: string;
}

export interface WorkflowStepPart extends BasePart {
  type: "workflow-step";
  nodeId: string;
  nodeName: string;
  status: "running" | "completed" | "error";
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

// ============================================================================
// PART UNION
// ============================================================================

/** Discriminated union of all message part types. */
export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | AgentPart
  | TaskListPart
  | SkillLoadPart
  | McpSnapshotPart
  | CompactionPart
  | WorkflowStepPart;
