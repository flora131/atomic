/**
 * Event bus public type surface.
 */

export type BusEventType =
  | "stream.text.delta"
  | "stream.text.complete"
  | "stream.thinking.delta"
  | "stream.thinking.complete"
  | "stream.tool.start"
  | "stream.tool.complete"
  | "stream.tool.partial_result"
  | "stream.agent.start"
  | "stream.agent.update"
  | "stream.agent.complete"
  | "stream.session.start"
  | "stream.session.idle"
  | "stream.session.partial-idle"
  | "stream.session.error"
  | "stream.session.info"
  | "stream.session.warning"
  | "stream.session.title_changed"
  | "stream.session.truncation"
  | "stream.session.compaction"
  | "stream.turn.start"
  | "stream.turn.end"
  | "workflow.step.start"
  | "workflow.step.complete"
  | "workflow.task.update"
  | "workflow.task.statusChange"
  | "stream.permission.requested"
  | "stream.human_input_required"
  | "stream.session.retry"
  | "stream.skill.invoked"
  | "stream.usage";

export interface BusEventDataMap {
  "stream.text.delta": {
    delta: string;
    messageId: string;
    agentId?: string;
  };
  "stream.text.complete": {
    messageId: string;
    fullText: string;
  };
  "stream.thinking.delta": {
    delta: string;
    sourceKey: string;
    messageId: string;
    agentId?: string;
  };
  "stream.thinking.complete": {
    sourceKey: string;
    durationMs: number;
    agentId?: string;
  };
  "stream.tool.start": {
    toolId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    sdkCorrelationId?: string;
    toolMetadata?: Record<string, unknown>;
    parentAgentId?: string;
  };
  "stream.tool.complete": {
    toolId: string;
    toolName: string;
    toolInput?: Record<string, unknown>;
    toolResult: unknown;
    success: boolean;
    error?: string;
    sdkCorrelationId?: string;
    toolMetadata?: Record<string, unknown>;
    parentAgentId?: string;
  };
  "stream.tool.partial_result": {
    toolCallId: string;
    partialOutput: string;
    parentAgentId?: string;
  };
  "stream.agent.start": {
    agentId: string;
    toolCallId: string;
    agentType: string;
    task: string;
    isBackground: boolean;
    sdkCorrelationId?: string;
  };
  "stream.agent.update": {
    agentId: string;
    currentTool?: string;
    toolUses?: number;
  };
  "stream.agent.complete": {
    agentId: string;
    success: boolean;
    result?: string;
    error?: string;
  };
  "stream.session.start": {
    config?: Record<string, unknown>;
  };
  "stream.session.idle": {
    reason?: string;
  };
  "stream.session.partial-idle": {
    completionReason: string;
    activeBackgroundAgentCount: number;
  };
  "stream.session.error": {
    error: string;
    code?: string;
  };
  "stream.session.info": {
    infoType: string;
    message: string;
  };
  "stream.session.warning": {
    warningType: string;
    message: string;
  };
  "stream.session.title_changed": {
    title: string;
  };
  "stream.session.truncation": {
    tokenLimit: number;
    tokensRemoved: number;
    messagesRemoved: number;
  };
  "stream.session.compaction": {
    phase: "start" | "complete";
    success?: boolean;
    error?: string;
  };
  "stream.turn.start": {
    turnId: string;
  };
  "stream.turn.end": {
    turnId: string;
    finishReason?:
      | "tool-calls"
      | "stop"
      | "max-tokens"
      | "max-turns"
      | "error"
      | "unknown";
    rawFinishReason?: string;
  };
  "workflow.step.start": {
    workflowId: string;
    nodeId: string;
    nodeName: string;
  };
  "workflow.step.complete": {
    workflowId: string;
    nodeId: string;
    nodeName: string;
    status: "success" | "error" | "skipped";
    result?: unknown;
  };
  "workflow.task.update": {
    workflowId: string;
    tasks: import("@/services/workflows/runtime-contracts.ts").WorkflowRuntimeTask[];
  };
  "workflow.task.statusChange": {
    workflowId: string;
    taskIds: string[];
    newStatus: string;
    tasks: import("@/services/workflows/runtime-contracts.ts").WorkflowRuntimeTask[];
  };
  "stream.permission.requested": {
    requestId: string;
    toolName: string;
    toolInput?: Record<string, unknown>;
    question: string;
    header?: string;
    options: Array<{
      label: string;
      value: string;
      description?: string;
    }>;
    multiSelect?: boolean;
    respond?: (...args: unknown[]) => unknown;
    toolCallId?: string;
  };
  "stream.human_input_required": {
    requestId: string;
    question: string;
    header?: string;
    options?: Array<{
      label: string;
      description?: string;
    }>;
    nodeId: string;
    respond?: (...args: unknown[]) => unknown;
    toolCallId?: string;
  };
  "stream.session.retry": {
    attempt: number;
    delay: number;
    message: string;
    nextRetryAt: number;
  };
  "stream.skill.invoked": {
    skillName: string;
    skillPath?: string;
    agentId?: string;
  };
  "stream.usage": {
    inputTokens: number;
    outputTokens: number;
    model?: string;
    agentId?: string;
  };
}

export interface BusEvent<T extends BusEventType = BusEventType> {
  type: T;
  sessionId: string;
  runId: number;
  timestamp: number;
  data: BusEventDataMap[T];
}

export type BusHandler<T extends BusEventType> = (event: BusEvent<T>) => void;

export type WildcardHandler = (event: BusEvent) => void;

export interface EnrichedBusEvent extends BusEvent {
  resolvedToolId?: string;
  resolvedAgentId?: string;
  isSubagentTool?: boolean;
  suppressFromMainChat?: boolean;
  parentAgentId?: string;
}
