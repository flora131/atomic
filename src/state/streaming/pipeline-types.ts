import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { HitlResponseRecord } from "@/lib/ui/hitl-response.ts";
import type { PermissionOption } from "@/services/agents/types.ts";
import type { WorkflowRuntimeTaskResultEnvelope, WorkflowRuntimeTaskStatus } from "@/services/workflows/runtime-contracts.ts";
import type { ToolExecutionStatus } from "@/state/parts/types.ts";

type ToolStatus = ToolExecutionStatus;

export type { ToolStatus };

export interface ToolStartEvent {
  type: "tool-start";
  runId?: number;
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolMetadata?: Record<string, unknown>;
  startedAt?: string;
  agentId?: string;
}

export interface ToolCompleteEvent {
  type: "tool-complete";
  runId?: number;
  toolId: string;
  toolName?: string;
  output: unknown;
  success: boolean;
  error?: string;
  input?: Record<string, unknown>;
  toolMetadata?: Record<string, unknown>;
  agentId?: string;
}

export interface TextDeltaEvent {
  type: "text-delta";
  runId?: number;
  delta: string;
  agentId?: string;
}

export interface TextCompleteEvent {
  type: "text-complete";
  runId?: number;
  fullText: string;
  messageId: string;
}

export type ThinkingProvider = "claude" | "opencode" | "copilot" | "unknown";

export interface ThinkingMetaEvent {
  type: "thinking-meta";
  runId?: number;
  thinkingSourceKey: string;
  targetMessageId: string;
  streamGeneration: number;
  thinkingText: string;
  thinkingMs: number;
  agentId?: string;
  includeReasoningPart?: boolean;
  provider?: ThinkingProvider;
}

export interface ThinkingCompleteEvent {
  type: "thinking-complete";
  runId?: number;
  sourceKey: string;
  durationMs: number;
  agentId?: string;
}

export interface HitlRequestEvent {
  type: "tool-hitl-request";
  runId?: number;
  toolId: string;
  request: {
    requestId: string;
    header: string;
    question: string;
    options: PermissionOption[];
    multiSelect: boolean;
    respond: (answer: string | string[]) => void;
  };
}

export interface HitlResponseEvent {
  type: "tool-hitl-response";
  runId?: number;
  toolId: string;
  response: HitlResponseRecord;
}

export interface ParallelAgentsEvent {
  type: "parallel-agents";
  runId?: number;
  agents: ParallelAgent[];
  isLastMessage: boolean;
}

export interface AgentTerminalEvent {
  type: "agent-terminal";
  runId?: number;
  agentId: string;
  status: "completed" | "error";
  result?: string;
  error?: string;
  completedAt?: string;
}

export interface TaskListUpdateEvent {
  type: "task-list-update";
  runId?: number;
  tasks: Array<{
    id: string;
    title: string;
    status: WorkflowRuntimeTaskStatus;
    blockedBy?: string[];
  }>;
}

export interface TaskResultUpsertEvent {
  type: "task-result-upsert";
  runId?: number;
  envelope: WorkflowRuntimeTaskResultEnvelope;
}

export interface ToolPartialResultEvent {
  type: "tool-partial-result";
  runId?: number;
  toolId: string;
  partialOutput: string;
  agentId?: string;
}

export interface WorkflowStepStartEvent {
  type: "workflow-step-start";
  runId?: number;
  workflowId: string;
  nodeId: string;
  nodeName: string;
  indicator: string;
}

export interface WorkflowStepCompleteEvent {
  type: "workflow-step-complete";
  runId?: number;
  workflowId: string;
  nodeId: string;
  nodeName: string;
  status: "completed" | "error" | "skipped";
  durationMs: number;
  error?: string;
  /** When present, triggers parts truncation for the completed stage. */
  truncation?: {
    minTruncationParts: number;
    truncateText: boolean;
    truncateReasoning: boolean;
    truncateTools: boolean;
  };
}

export type StreamPartEvent =
  | TextDeltaEvent
  | TextCompleteEvent
  | ThinkingMetaEvent
  | ThinkingCompleteEvent
  | ToolStartEvent
  | ToolCompleteEvent
  | ToolPartialResultEvent
  | HitlRequestEvent
  | HitlResponseEvent
  | ParallelAgentsEvent
  | AgentTerminalEvent
  | TaskListUpdateEvent
  | TaskResultUpsertEvent
  | WorkflowStepStartEvent
  | WorkflowStepCompleteEvent;
