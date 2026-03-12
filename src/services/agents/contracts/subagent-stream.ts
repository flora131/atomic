import type { MessageMetadata } from "@/services/agents/contracts/session.ts";

const SUBAGENT_LIFECYCLE_METADATA_KEY = "__atomicSubagentLifecycle";
const SUBAGENT_ROUTING_METADATA_KEY = "__atomicSubagentRouting";

export type SubagentLifecycleEventType = "start" | "update" | "complete";

export interface SubagentLifecycleMetadata {
  eventType: SubagentLifecycleEventType;
  subagentId: string;
  subagentType?: string;
  task?: string;
  toolCallId?: string;
  sdkCorrelationId?: string;
  currentTool?: string;
  toolUses?: number;
  success?: boolean;
  result?: unknown;
  error?: string;
  isBackground?: boolean;
}

export interface SubagentRoutingMetadata {
  agentId: string;
  sessionId?: string;
}

export function withSubagentLifecycleMetadata(
  metadata: MessageMetadata | undefined,
  lifecycle: SubagentLifecycleMetadata,
): MessageMetadata {
  return {
    ...(metadata ?? {}),
    [SUBAGENT_LIFECYCLE_METADATA_KEY]: lifecycle,
  };
}

export function readSubagentLifecycleMetadata(
  metadata: MessageMetadata | undefined,
): SubagentLifecycleMetadata | undefined {
  const value = asRecord(metadata?.[SUBAGENT_LIFECYCLE_METADATA_KEY]);
  if (!value) {
    return undefined;
  }

  const eventType = asLifecycleEventType(value.eventType);
  const subagentId = asString(value.subagentId);
  if (!eventType || !subagentId) {
    return undefined;
  }

  const subagentType = asString(value.subagentType);
  const task = asString(value.task);
  const toolCallId = asString(value.toolCallId);
  const sdkCorrelationId = asString(value.sdkCorrelationId);
  const currentTool = asString(value.currentTool);
  const toolUses = asNumber(value.toolUses);
  const success = asBoolean(value.success);
  const error = asString(value.error);
  const isBackground = asBoolean(value.isBackground);

  return {
    eventType,
    subagentId,
    ...(subagentType ? { subagentType } : {}),
    ...(task ? { task } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(sdkCorrelationId ? { sdkCorrelationId } : {}),
    ...(currentTool ? { currentTool } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(success !== undefined ? { success } : {}),
    ...(value.result !== undefined ? { result: value.result } : {}),
    ...(error ? { error } : {}),
    ...(isBackground !== undefined ? { isBackground } : {}),
  };
}

export function withSubagentRoutingMetadata(
  metadata: MessageMetadata | undefined,
  routing: SubagentRoutingMetadata,
): MessageMetadata {
  return {
    ...(metadata ?? {}),
    [SUBAGENT_ROUTING_METADATA_KEY]: routing,
  };
}

export function readSubagentRoutingMetadata(
  metadata: MessageMetadata | undefined,
): SubagentRoutingMetadata | undefined {
  const value = asRecord(metadata?.[SUBAGENT_ROUTING_METADATA_KEY]);
  if (!value) {
    return undefined;
  }

  const agentId = asString(value.agentId);
  const sessionId = asString(value.sessionId);
  if (!agentId) {
    return undefined;
  }

  return {
    agentId,
    ...(sessionId ? { sessionId } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asLifecycleEventType(value: unknown): SubagentLifecycleEventType | undefined {
  return value === "start" || value === "update" || value === "complete"
    ? value
    : undefined;
}
