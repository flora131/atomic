/**
 * Unified stream-part pipeline utilities.
 *
 * Provides a single event reducer for updating assistant messages from
 * streaming events (text, thinking metadata, tools, HITL, and agents).
 */

import type { ChatMessage, MessageToolCall } from "../chat.tsx";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import type { HitlResponseRecord } from "../utils/hitl-response.ts";
import type { PermissionOption } from "../../sdk/types.ts";
import { type PartId, createPartId } from "./id.ts";
import { upsertPart, findLastPartIndex } from "./store.ts";
import { handleTextDelta } from "./handlers.ts";
import { normalizeMarkdownNewlines } from "../utils/format.ts";
import type {
  AgentPart,
  Part,
  ReasoningPart,
  TaskListPart,
  TextPart,
  ToolPart,
  ToolState,
  WorkflowStepPart,
} from "./types.ts";

type ToolStatus = MessageToolCall["status"];

interface ToolStartEvent {
  type: "tool-start";
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
  startedAt?: string;
  /** Sub-agent ID if this event is scoped to a workflow sub-agent */
  agentId?: string;
}

interface ToolCompleteEvent {
  type: "tool-complete";
  toolId: string;
  toolName?: string;
  output: unknown;
  success: boolean;
  error?: string;
  input?: Record<string, unknown>;
  /** Sub-agent ID if this event is scoped to a workflow sub-agent */
  agentId?: string;
}

interface TextDeltaEvent {
  type: "text-delta";
  delta: string;
  /** Sub-agent ID if this event is scoped to a workflow sub-agent */
  agentId?: string;
}

interface TextCompleteEvent {
  type: "text-complete";
  fullText: string;
  messageId: string;
}

export type ThinkingProvider = "claude" | "opencode" | "copilot" | "unknown";

export interface ThinkingMetaEvent {
  type: "thinking-meta";
  thinkingSourceKey: string;
  targetMessageId: string;
  streamGeneration: number;
  thinkingText: string;
  thinkingMs: number;
  /**
   * Off by default to keep current UI behavior until dedicated
   * reasoning rendering task is complete.
   */
  includeReasoningPart?: boolean;
  provider?: ThinkingProvider;
}

interface HitlRequestEvent {
  type: "tool-hitl-request";
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

interface HitlResponseEvent {
  type: "tool-hitl-response";
  toolId: string;
  response: HitlResponseRecord;
}

interface ParallelAgentsEvent {
  type: "parallel-agents";
  agents: ParallelAgent[];
  isLastMessage: boolean;
}

interface WorkflowStepStartEvent {
  type: "workflow-step-start";
  nodeId: string;
  nodeName: string;
  startedAt: number;
}

interface WorkflowStepCompleteEvent {
  type: "workflow-step-complete";
  nodeId: string;
  status: "success" | "error" | "skipped";
  completedAt: number;
  durationMs?: number;
}

interface TaskListUpdateEvent {
  type: "task-list-update";
  tasks: Array<{
    id: string;
    title: string;
    status: string;
  }>;
}

interface ToolPartialResultEvent {
  type: "tool-partial-result";
  toolId: string;
  partialOutput: string;
}

export type StreamPartEvent =
  | TextDeltaEvent
  | TextCompleteEvent
  | ThinkingMetaEvent
  | ToolStartEvent
  | ToolCompleteEvent
  | ToolPartialResultEvent
  | HitlRequestEvent
  | HitlResponseEvent
  | ParallelAgentsEvent
  | WorkflowStepStartEvent
  | WorkflowStepCompleteEvent
  | TaskListUpdateEvent;

const reasoningPartIdBySourceRegistry = new WeakMap<ChatMessage, Map<string, PartId>>();

function isHitlToolName(toolName: string): boolean {
  return toolName === "AskUserQuestion" || toolName === "question" || toolName === "ask_user";
}

export function toToolState(
  status: ToolStatus,
  output: unknown,
  fallbackStartedAt: string,
  existingState?: ToolState,
): ToolState {
  switch (status) {
    case "pending":
      return { status: "pending" };
    case "running":
      return {
        status: "running",
        startedAt: existingState?.status === "running" ? existingState.startedAt : fallbackStartedAt,
      };
    case "completed":
      return {
        status: "completed",
        output,
        durationMs: existingState?.status === "completed" ? existingState.durationMs : 0,
      };
    case "error":
      return {
        status: "error",
        error: existingState?.status === "error"
          ? existingState.error
          : (typeof output === "string" && output.trim() ? output : "Tool execution failed"),
        output,
      };
    case "interrupted": {
      let durationMs: number | undefined;
      if (existingState?.status === "running") {
        const startedAtMs = new Date(existingState.startedAt).getTime();
        durationMs = Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : undefined;
      }
      return { status: "interrupted", partialOutput: output, durationMs };
    }
  }
}

function finalizeLastStreamingTextPart(parts: Part[]): Part[] {
  const updated = [...parts];
  const lastTextIdx = findLastPartIndex(
    updated,
    (part) => part.type === "text" && (part as TextPart).isStreaming,
  );
  if (lastTextIdx >= 0) {
    updated[lastTextIdx] = {
      ...(updated[lastTextIdx] as TextPart),
      isStreaming: false,
    };
  }
  return updated;
}

export function finalizeStreamingReasoningParts(parts: Part[]): Part[] {
  let changed = false;
  const updated = parts.map((part) => {
    if (part.type !== "reasoning" || !part.isStreaming) {
      return part;
    }
    changed = true;
    return {
      ...part,
      isStreaming: false,
    };
  });

  return changed ? updated : parts;
}

export function finalizeStreamingReasoningInMessage<T extends { parts?: Part[] }>(message: T): T {
  if (!message.parts || message.parts.length === 0) {
    return message;
  }

  const finalizedParts = finalizeStreamingReasoningParts(message.parts);
  if (finalizedParts === message.parts) {
    return message;
  }

  return {
    ...message,
    parts: finalizedParts,
  };
}

function mergeToolCallOutput(
  toolCall: MessageToolCall,
  output: unknown,
): unknown {
  if (!isHitlToolName(toolCall.toolName) || !toolCall.hitlResponse) {
    return output !== undefined ? output : toolCall.output;
  }
  const outputObject = (
    output !== null
    && typeof output === "object"
  )
    ? output as Record<string, unknown>
    : {};
  return {
    ...outputObject,
    answer: toolCall.hitlResponse.answerText,
    cancelled: toolCall.hitlResponse.cancelled,
    responseMode: toolCall.hitlResponse.responseMode,
    displayText: toolCall.hitlResponse.displayText,
  };
}

function upsertToolCallStart(
  toolCalls: MessageToolCall[] | undefined,
  event: ToolStartEvent,
): MessageToolCall[] {
  const current = toolCalls ?? [];
  let matched = false;
  const updated = current.map((toolCall) => {
    if (toolCall.id !== event.toolId) return toolCall;
    matched = true;
    return {
      ...toolCall,
      toolName: event.toolName,
      input: event.input,
      status: "running" as const,
    };
  });
  if (matched) return updated;
  return [
    ...updated,
    {
      id: event.toolId,
      toolName: event.toolName,
      input: event.input,
      status: "running" as const,
    },
  ];
}

function upsertToolPartStart(parts: Part[], event: ToolStartEvent): Part[] {
  const existingIdx = parts.findIndex(
    (part) => part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
  );

  if (existingIdx >= 0) {
    const existing = parts[existingIdx] as ToolPart;
    const updated = [...parts];
    const startedAt = existing.state.status === "running"
      ? existing.state.startedAt
      : (event.startedAt ?? new Date().toISOString());
    updated[existingIdx] = {
      ...existing,
      toolName: event.toolName,
      input: event.input,
      state: { status: "running", startedAt },
    };
    return updated;
  }

  const finalized = finalizeLastStreamingTextPart(parts);
  const toolPart: ToolPart = {
    id: createPartId(),
    type: "tool",
    toolCallId: event.toolId,
    toolName: event.toolName,
    input: event.input,
    state: { status: "running", startedAt: event.startedAt ?? new Date().toISOString() },
    createdAt: new Date().toISOString(),
  };
  return upsertPart(finalized, toolPart);
}

function upsertToolCallComplete(
  toolCalls: MessageToolCall[] | undefined,
  event: ToolCompleteEvent,
): MessageToolCall[] {
  const current = toolCalls ?? [];
  let matched = false;
  const updated = current.map((toolCall) => {
    if (toolCall.id !== event.toolId) return toolCall;
    matched = true;
    const updatedInput = (event.input && Object.keys(toolCall.input).length === 0)
      ? event.input
      : toolCall.input;
    const updatedToolName = toolCall.toolName === "unknown"
      ? (event.toolName ?? "unknown")
      : toolCall.toolName;
    return {
      ...toolCall,
      toolName: updatedToolName,
      input: updatedInput,
      output: mergeToolCallOutput(toolCall, event.output),
      status: event.success ? ("completed" as const) : ("error" as const),
    };
  });

  if (matched) return updated;

  return [
    ...updated,
    {
      id: event.toolId,
      toolName: event.toolName ?? "unknown",
      input: event.input ?? {},
      output: event.output,
      status: event.success ? ("completed" as const) : ("error" as const),
    },
  ];
}

function upsertToolPartComplete(parts: Part[], event: ToolCompleteEvent): Part[] {
  const toolPartIdx = parts.findIndex(
    (part) => part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
  );

  if (toolPartIdx >= 0) {
    const existing = parts[toolPartIdx] as ToolPart;
    let durationMs = 0;
    if (existing.state.status === "running") {
      const startedAtMs = new Date(existing.state.startedAt).getTime();
      durationMs = Number.isFinite(startedAtMs)
        ? Math.max(0, Date.now() - startedAtMs)
        : 0;
    }
    const updatedInput = (event.input && Object.keys(existing.input).length === 0)
      ? event.input
      : existing.input;
    const newState: ToolState = event.success
      ? { status: "completed", output: event.output, durationMs }
      : { status: "error", error: event.error || "Unknown error", output: event.output };

    const updated = [...parts];
    updated[toolPartIdx] = {
      ...existing,
      toolName: existing.toolName === "unknown" ? (event.toolName ?? "unknown") : existing.toolName,
      input: updatedInput,
      output: event.output,
      state: newState,
    };
    return updated;
  }

  const toolPart: ToolPart = {
    id: createPartId(),
    type: "tool",
    toolCallId: event.toolId,
    toolName: event.toolName ?? "unknown",
    input: event.input ?? {},
    output: event.output,
    state: event.success
      ? { status: "completed", output: event.output, durationMs: 0 }
      : { status: "error", error: event.error || "Unknown error", output: event.output },
    createdAt: new Date().toISOString(),
  };
  return upsertPart(parts, toolPart);
}

function upsertHitlRequest(parts: Part[], event: HitlRequestEvent): Part[] {
  const toolPartIdx = parts.findIndex(
    (part) => part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
  );

  if (toolPartIdx >= 0) {
    const existing = parts[toolPartIdx] as ToolPart;
    const updated = [...parts];
    updated[toolPartIdx] = {
      ...existing,
      pendingQuestion: event.request,
    };
    return updated;
  }

  const toolPart: ToolPart = {
    id: createPartId(),
    type: "tool",
    toolCallId: event.toolId,
    toolName: "AskUserQuestion",
    input: {},
    state: { status: "running", startedAt: new Date().toISOString() },
    pendingQuestion: event.request,
    createdAt: new Date().toISOString(),
  };
  return upsertPart(parts, toolPart);
}

function applyHitlResponse(
  message: ChatMessage,
  event: HitlResponseEvent,
): ChatMessage {
  const nextToolCalls = (message.toolCalls ?? []).map((toolCall) => {
    if (toolCall.id !== event.toolId) return toolCall;
    return {
      ...toolCall,
      output: {
        ...(toolCall.output && typeof toolCall.output === "object"
          ? toolCall.output as Record<string, unknown>
          : {}),
        answer: event.response.answerText,
        cancelled: event.response.cancelled,
        responseMode: event.response.responseMode,
        displayText: event.response.displayText,
      },
      hitlResponse: event.response,
    };
  });

  let nextParts = message.parts;
  if (message.parts && message.parts.length > 0) {
    const updatedParts = [...message.parts];
    const toolPartIdx = updatedParts.findIndex(
      (part) => part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
    );
    if (toolPartIdx >= 0) {
      const toolPart = updatedParts[toolPartIdx] as ToolPart;
      updatedParts[toolPartIdx] = {
        ...toolPart,
        pendingQuestion: undefined,
        hitlResponse: event.response,
      };
      nextParts = updatedParts;
    }
  }

  return {
    ...message,
    toolCalls: nextToolCalls,
    parts: nextParts,
  };
}

function upsertThinkingMeta(
  message: ChatMessage,
  event: ThinkingMetaEvent,
): ChatMessage {
  if (!event.includeReasoningPart) {
    const nextMessage: ChatMessage = {
      ...message,
      thinkingMs: event.thinkingMs,
      thinkingText: event.thinkingText || undefined,
    };
    return carryReasoningPartRegistry(message, nextMessage);
  }

  const parts = [...(message.parts ?? [])];
  const registry = cloneReasoningPartRegistry(message);

  let existingIdx = -1;
  const existingPartId = registry.get(event.thinkingSourceKey);
  if (existingPartId) {
    existingIdx = parts.findIndex(
      (part) => part.id === existingPartId && part.type === "reasoning",
    );
    if (existingIdx < 0) {
      registry.delete(event.thinkingSourceKey);
    }
  }

  if (existingIdx < 0) {
    existingIdx = parts.findIndex(
      (part) => part.type === "reasoning" && (part as ReasoningPart).thinkingSourceKey === event.thinkingSourceKey,
    );
    if (existingIdx >= 0) {
      registry.set(event.thinkingSourceKey, parts[existingIdx]!.id);
    }
  }

  if (existingIdx >= 0) {
    const existing = parts[existingIdx] as ReasoningPart;
    parts[existingIdx] = {
      ...existing,
      thinkingSourceKey: event.thinkingSourceKey,
      content: event.thinkingText,
      durationMs: event.thinkingMs,
      isStreaming: true,
    };
  } else if (event.thinkingText.trim().length > 0) {
    const reasoningPart: ReasoningPart = {
      id: createPartId(),
      type: "reasoning",
      thinkingSourceKey: event.thinkingSourceKey,
      content: event.thinkingText,
      durationMs: event.thinkingMs,
      isStreaming: true,
      createdAt: new Date().toISOString(),
    };
    const firstTextIdx = parts.findIndex((part) => part.type === "text");
    if (firstTextIdx >= 0) {
      parts.splice(firstTextIdx, 0, reasoningPart);
    } else {
      parts.push(reasoningPart);
    }
    registry.set(event.thinkingSourceKey, reasoningPart.id);
  }

  const nextMessage: ChatMessage = {
    ...message,
    parts,
    thinkingMs: event.thinkingMs,
    thinkingText: event.thinkingText || undefined,
  };

  reasoningPartIdBySourceRegistry.set(nextMessage, registry);
  return nextMessage;
}

function cloneReasoningPartRegistry(message: ChatMessage): Map<string, PartId> {
  const existing = reasoningPartIdBySourceRegistry.get(message);
  if (existing) {
    return new Map(existing);
  }

  const rebuilt = new Map<string, PartId>();
  for (const part of message.parts ?? []) {
    if (part.type !== "reasoning") {
      continue;
    }
    const sourceKey = (part as ReasoningPart).thinkingSourceKey;
    if (sourceKey && sourceKey.trim().length > 0) {
      rebuilt.set(sourceKey, part.id);
    }
  }
  return rebuilt;
}

function carryReasoningPartRegistry(from: ChatMessage, to: ChatMessage): ChatMessage {
  const existing = reasoningPartIdBySourceRegistry.get(from);
  if (existing) {
    reasoningPartIdBySourceRegistry.set(to, new Map(existing));
  }
  return to;
}

function hasSubagentCall(message: Pick<ChatMessage, "parallelAgents" | "toolCalls">): boolean {
  if ((message.parallelAgents?.length ?? 0) > 0) return true;
  return (message.toolCalls ?? []).some(
    (toolCall) => toolCall.toolName === "Task" || toolCall.toolName === "task",
  );
}

function normalizeParallelAgentResult(result: string | undefined): string | undefined {
  if (typeof result !== "string") return undefined;
  const normalized = normalizeMarkdownNewlines(result);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeParallelAgents(agents: ParallelAgent[]): ParallelAgent[] {
  let changed = false;
  const normalizedAgents = agents.map((agent) => {
    if (typeof agent.result !== "string") return agent;
    const normalizedResult = normalizeParallelAgentResult(agent.result);
    if (normalizedResult === agent.result) return agent;

    changed = true;
    if (normalizedResult) {
      return {
        ...agent,
        result: normalizedResult,
      };
    }

    const { result: _result, ...rest } = agent;
    return rest;
  });

  return changed ? normalizedAgents : agents;
}

export function shouldGroupSubagentTrees(
  message: Pick<ChatMessage, "parallelAgents" | "toolCalls" | "parts">,
  _isLastMessage: boolean,
): boolean {
  const agents = message.parallelAgents ?? [];
  if (agents.length === 0) return false;
  if (!hasSubagentCall(message)) return false;
  return true;
}

function getAgentInsertIndex(parts: Part[]): number {
  let lastTaskToolIdx = -1;
  let lastToolIdx = -1;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part.type !== "tool") continue;
    lastToolIdx = i;
    const toolName = (part as ToolPart).toolName;
    if (toolName === "Task" || toolName === "task") {
      lastTaskToolIdx = i;
    }
  }

  let idx = parts.length;
  if (lastTaskToolIdx >= 0) {
    idx = lastTaskToolIdx + 1;
  } else if (lastToolIdx >= 0) {
    idx = lastToolIdx + 1;
  }

  while (idx < parts.length && parts[idx]?.type === "agent") {
    idx++;
  }
  return idx;
}

function insertAgentPartAtTaskBoundary(parts: Part[], agentPart: AgentPart): Part[] {
  const insertIdx = getAgentInsertIndex(parts);
  return [
    ...parts.slice(0, insertIdx),
    agentPart,
    ...parts.slice(insertIdx),
  ];
}

export function mergeParallelAgentsIntoParts(
  parts: Part[],
  parallelAgents: ParallelAgent[],
  messageTimestamp: string,
  groupIntoSingleTree: boolean,
): Part[] {
  const normalizedAgents = normalizeParallelAgents(parallelAgents);
  const nonAgentParts: Part[] = parts.filter((part) => part.type !== "agent");
  const existingAgentParts = parts.filter((part): part is AgentPart => part.type === "agent");

  if (normalizedAgents.length === 0) {
    return nonAgentParts;
  }

  if (groupIntoSingleTree) {
    const existingGroupedPart = existingAgentParts.find((part) => part.parentToolPartId === undefined) ?? existingAgentParts[0];
    const groupedPart: AgentPart = {
      id: existingGroupedPart?.id ?? createPartId(),
      type: "agent",
      agents: normalizedAgents,
      parentToolPartId: undefined,
      createdAt: existingGroupedPart?.createdAt ?? messageTimestamp,
    };
    return insertAgentPartAtTaskBoundary(nonAgentParts, groupedPart);
  }

  const existingByParent = new Map<PartId | undefined, AgentPart>();
  for (const existing of existingAgentParts) {
    if (!existingByParent.has(existing.parentToolPartId)) {
      existingByParent.set(existing.parentToolPartId, existing);
    }
  }

  const agentsByToolCall = new Map<string | undefined, ParallelAgent[]>();
  for (const agent of normalizedAgents) {
    const toolCallId = agent.taskToolCallId;
    const grouped = agentsByToolCall.get(toolCallId) ?? [];
    grouped.push(agent);
    agentsByToolCall.set(toolCallId, grouped);
  }

  const finalParts: Part[] = [];
  const handledToolCallIds = new Set<string>();

  let currentGroup: ToolPart[] = [];
  let currentGroupAgents: ParallelAgent[] = [];

  for (let i = 0; i < nonAgentParts.length; i++) {
    const part = nonAgentParts[i];
    if (!part) continue;
    finalParts.push(part);

    if (part.type === "tool" && (part.toolName === "Task" || part.toolName === "task")) {
      const toolPart = part as ToolPart;
      currentGroup.push(toolPart);
      const agents = agentsByToolCall.get(toolPart.toolCallId);
      if (agents) {
        currentGroupAgents.push(...agents);
        if (toolPart.toolCallId) {
          handledToolCallIds.add(toolPart.toolCallId);
        }
      }
    }

    let endsGroup = false;
    if (currentGroup.length > 0) {
      if (i === nonAgentParts.length - 1) {
        endsGroup = true;
      } else {
        const nextPart = nonAgentParts[i + 1];
        if (!nextPart) {
          endsGroup = true;
        } else if (nextPart.type === "tool") {
          const toolName = (nextPart as ToolPart).toolName;
          if (toolName !== "Task" && toolName !== "task") {
            endsGroup = true;
          }
        } else if (nextPart.type === "text") {
          if ((nextPart as TextPart).content.trim().length > 0) {
            endsGroup = true;
          }
        }
      }
    }

    if (endsGroup) {
      if (currentGroupAgents.length > 0) {
        const lastToolPart = currentGroup[currentGroup.length - 1];
        if (lastToolPart) {
          const parentToolPartId = lastToolPart.id;
          const existingPart = existingByParent.get(parentToolPartId);

          const agentPart: AgentPart = {
            id: existingPart?.id ?? createPartId(),
            type: "agent",
            agents: currentGroupAgents,
            parentToolPartId,
            createdAt: existingPart?.createdAt ?? messageTimestamp,
          };
          finalParts.push(agentPart);
        }
      }
      currentGroup = [];
      currentGroupAgents = [];
    }
  }

  const remainingAgents: ParallelAgent[] = [];
  for (const [toolCallId, agents] of agentsByToolCall) {
    if (!toolCallId || !handledToolCallIds.has(toolCallId)) {
      remainingAgents.push(...agents);
    }
  }

  if (remainingAgents.length > 0) {
    const existingPart = existingByParent.get(undefined);
    const fallbackPart: AgentPart = {
      id: existingPart?.id ?? createPartId(),
      type: "agent",
      agents: remainingAgents,
      parentToolPartId: undefined,
      createdAt: existingPart?.createdAt ?? messageTimestamp,
    };
    const insertIdx = getAgentInsertIndex(finalParts);
    finalParts.splice(insertIdx, 0, fallbackPart);
  }

  return finalParts;
}

export function syncToolCallsIntoParts(
  parts: Part[],
  toolCalls: MessageToolCall[],
  messageTimestamp: string,
  messageId?: string,
): Part[] {
  let nextParts = [...parts];

  for (const toolCall of toolCalls) {
    const existingIdx = nextParts.findIndex(
      (part) => part.type === "tool" && (part as ToolPart).toolCallId === toolCall.id,
    );

    if (existingIdx >= 0) {
      const existing = nextParts[existingIdx] as ToolPart;
      nextParts[existingIdx] = {
        ...existing,
        toolName: toolCall.toolName,
        input: toolCall.input,
        output: toolCall.output,
        hitlResponse: toolCall.hitlResponse ?? existing.hitlResponse,
        state: toToolState(toolCall.status, toolCall.output, messageTimestamp, existing.state),
      };
      continue;
    }

    const fallbackId = messageId
      ? (`tool-${messageId}-${toolCall.id}` as unknown as PartId)
      : createPartId();
    nextParts.push({
      id: fallbackId,
      type: "tool",
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      input: toolCall.input,
      output: toolCall.output,
      hitlResponse: toolCall.hitlResponse,
      state: toToolState(toolCall.status, toolCall.output, messageTimestamp),
      createdAt: messageTimestamp,
    } satisfies ToolPart);
  }

  return nextParts;
}

/**
 * Route a part event into a specific agent's inlineParts sub-array.
 * Returns updated top-level parts array, or null if the agent was not found.
 */
function routeToAgentInlineParts(
  parts: Part[],
  agentId: string,
  applyFn: (inlineParts: Part[]) => Part[],
): Part[] | null {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part?.type !== "agent") continue;
    const agentPart = part as AgentPart;
    const agentIdx = agentPart.agents.findIndex((a) => a.id === agentId);
    if (agentIdx < 0) continue;

    const agent = agentPart.agents[agentIdx]!;
    const updatedInlineParts = applyFn(agent.inlineParts ?? []);
    const updatedAgents = [...agentPart.agents];
    updatedAgents[agentIdx] = { ...agent, inlineParts: updatedInlineParts };
    const updatedParts = [...parts];
    updatedParts[i] = { ...agentPart, agents: updatedAgents };
    return updatedParts;
  }
  return null;
}

export function applyStreamPartEvent(
  message: ChatMessage,
  event: StreamPartEvent,
): ChatMessage {
  switch (event.type) {
    case "text-delta": {
      // Agent-scoped routing: append text to agent's inline parts
      if (event.agentId && message.parts) {
        const routed = routeToAgentInlineParts(message.parts, event.agentId, (inlineParts) => {
          const lastText = inlineParts.length > 0 ? inlineParts[inlineParts.length - 1] : undefined;
          if (lastText && lastText.type === "text" && (lastText as TextPart).isStreaming) {
            const updated = [...inlineParts];
            updated[updated.length - 1] = {
              ...(lastText as TextPart),
              content: (lastText as TextPart).content + event.delta,
            };
            return updated;
          }
          return [...inlineParts, {
            id: createPartId(),
            type: "text",
            content: event.delta,
            isStreaming: true,
            createdAt: new Date().toISOString(),
          } as TextPart];
        });
        if (routed) {
          const nextMessage: ChatMessage = { ...message, parts: routed };
          return carryReasoningPartRegistry(message, nextMessage);
        }
        // Agent not yet in parts (race with useEffect baking) — drop the
        // delta rather than leaking sub-agent text into the main chat body.
        return message;
      }
      const withParts = handleTextDelta(message, event.delta);
      const nextMessage: ChatMessage = {
        ...withParts,
        content: message.content + event.delta,
      };
      return carryReasoningPartRegistry(message, nextMessage);
    }

    case "thinking-meta":
      return upsertThinkingMeta(message, event);

    case "tool-start": {
      // Agent-scoped routing: add tool to agent's inline parts
      if (event.agentId && message.parts) {
        const routed = routeToAgentInlineParts(message.parts, event.agentId, (inlineParts) => {
          return upsertToolPartStart(inlineParts, event);
        });
        if (routed) {
          const nextToolCalls = upsertToolCallStart(message.toolCalls, event);
          const nextMessage: ChatMessage = { ...message, toolCalls: nextToolCalls, parts: routed };
          return carryReasoningPartRegistry(message, nextMessage);
        }
        // Agent not yet in parts — drop rather than adding to main chat
        return message;
      }
      const nextToolCalls = upsertToolCallStart(message.toolCalls, event);
      const nextParts = upsertToolPartStart(message.parts ?? [], event);
      const nextMessage: ChatMessage = {
        ...message,
        toolCalls: nextToolCalls,
        parts: nextParts,
      };
      return carryReasoningPartRegistry(message, nextMessage);
    }

    case "tool-complete": {
      // Agent-scoped routing: update tool in agent's inline parts
      if (event.agentId && message.parts) {
        const routed = routeToAgentInlineParts(message.parts, event.agentId, (inlineParts) => {
          return upsertToolPartComplete(inlineParts, event);
        });
        if (routed) {
          const nextToolCalls = upsertToolCallComplete(message.toolCalls, event);
          const nextMessage: ChatMessage = { ...message, toolCalls: nextToolCalls, parts: routed };
          return carryReasoningPartRegistry(message, nextMessage);
        }
        // Agent not yet in parts — drop rather than adding to main chat
        return message;
      }
      const nextToolCalls = upsertToolCallComplete(message.toolCalls, event);
      const nextParts = upsertToolPartComplete(message.parts ?? [], event);
      const nextMessage: ChatMessage = {
        ...message,
        toolCalls: nextToolCalls,
        parts: nextParts,
      };
      return carryReasoningPartRegistry(message, nextMessage);
    }

    case "tool-partial-result": {
      const parts = [...(message.parts ?? [])];
      const toolPartIdx = parts.findIndex(
        (part) => part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
      );
      if (toolPartIdx >= 0) {
        const existing = parts[toolPartIdx] as ToolPart;
        parts[toolPartIdx] = {
          ...existing,
          partialOutput: (existing.partialOutput ?? "") + event.partialOutput,
        };
      }
      const nextMessage: ChatMessage = { ...message, parts };
      return carryReasoningPartRegistry(message, nextMessage);
    }

    case "tool-hitl-request": {
      const nextParts = upsertHitlRequest(message.parts ?? [], event);
      const nextMessage: ChatMessage = {
        ...message,
        parts: nextParts,
      };
      return carryReasoningPartRegistry(message, nextMessage);
    }

    case "tool-hitl-response":
      return carryReasoningPartRegistry(message, applyHitlResponse(message, event));

    case "text-complete":
      // Reconciliation is handled in useStreamConsumer (chat.tsx) — the
      // reducer does not need to act on this event directly.
      return message;

    case "parallel-agents": {
      const normalizedAgents = normalizeParallelAgents(event.agents);
      const nextParts = mergeParallelAgentsIntoParts(
        message.parts ?? [],
        normalizedAgents,
        message.timestamp,
        shouldGroupSubagentTrees({ ...message, parallelAgents: normalizedAgents }, event.isLastMessage),
      );
      const nextMessage: ChatMessage = {
        ...message,
        parallelAgents: normalizedAgents,
        parts: nextParts,
      };
      return carryReasoningPartRegistry(message, nextMessage);
    }

    case "workflow-step-start": {
      const stepPart: WorkflowStepPart = {
        id: createPartId(),
        type: "workflow-step",
        nodeId: event.nodeId,
        nodeName: event.nodeName,
        status: "running",
        startedAt: event.startedAt,
        createdAt: new Date().toISOString(),
      };
      const nextParts = upsertPart(message.parts ?? [], stepPart);
      const nextMessage: ChatMessage = { ...message, parts: nextParts };
      return carryReasoningPartRegistry(message, nextMessage);
    }

    case "workflow-step-complete": {
      const parts = [...(message.parts ?? [])];
      const stepIdx = parts.findIndex(
        (part) => part.type === "workflow-step" && (part as WorkflowStepPart).nodeId === event.nodeId,
      );
      if (stepIdx >= 0) {
        const existing = parts[stepIdx] as WorkflowStepPart;
        const durationMs = event.durationMs ?? (event.completedAt - (existing.startedAt ?? event.completedAt));
        parts[stepIdx] = {
          ...existing,
          status: event.status === "success" ? "completed" : "error",
          completedAt: event.completedAt,
          durationMs,
        };
      }
      const nextMessage: ChatMessage = { ...message, parts };
      return carryReasoningPartRegistry(message, nextMessage);
    }

    case "task-list-update": {
      const parts = [...(message.parts ?? [])];
      const taskItems = event.tasks.map((t) => ({
        id: t.id,
        content: t.title,
        status: normalizeTaskItemStatus(t.status),
      }));
      const existingIdx = parts.findIndex((part) => part.type === "task-list");
      if (existingIdx >= 0) {
        const existing = parts[existingIdx] as TaskListPart;
        parts[existingIdx] = { ...existing, items: taskItems };
      } else {
        const taskListPart: TaskListPart = {
          id: createPartId(),
          type: "task-list",
          items: taskItems,
          expanded: false,
          createdAt: new Date().toISOString(),
        };
        parts.push(taskListPart);
      }
      const nextMessage: ChatMessage = { ...message, parts };
      return carryReasoningPartRegistry(message, nextMessage);
    }
  }
}

/** Map raw status strings from workflow.task.update to TaskItem status values. */
function normalizeTaskItemStatus(status: string): "pending" | "in_progress" | "completed" | "error" {
  switch (status) {
    case "pending": return "pending";
    case "in_progress": return "in_progress";
    case "completed":
    case "complete":
    case "done":
    case "success":
      return "completed";
    case "error":
    case "failed":
      return "error";
    default:
      return "pending";
  }
}
