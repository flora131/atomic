import type { BusEvent } from "@/services/events/bus-events.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  EventHandler,
  SubagentCompleteEventData,
  SubagentStartEventData,
  SubagentUpdateEventData,
} from "@/services/agents/types.ts";
import {
  isGenericSubagentTaskLabel,
} from "@/services/events/adapters/provider-shared.ts";
import { normalizeAgentTaskMetadata } from "@/services/events/adapters/task-turn-normalization.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import type { OpenCodeTaskToolMetadata } from "@/services/events/adapters/providers/opencode/tool-state.ts";

type OpenCodeSubagentEventHandlerDependencies = {
  bus: EventBus;
  sessionId: string;
  getSubagentTracker: () => SubagentToolTracker | null;
  isOwnedSession: (eventSessionId: string) => boolean;
  asString: (value: unknown) => string | undefined;
  resolveToolCorrelationId: (correlationId: string | undefined) => string | undefined;
  resolveKnownSubagentCorrelation: (
    subagentId: string,
    subagentSessionId: string | undefined,
  ) => string | undefined;
  taskToolMetadata: Map<string, OpenCodeTaskToolMetadata>;
  getPendingTaskToolCorrelationIds: () => string[];
  subagentIdToCorrelationId: Map<string, string>;
  getOwnedSessionIds: () => Set<string>;
  subagentSessionToAgentId: Map<string, string>;
  subagentSessionToCorrelationId: Map<string, string>;
  toolUseIdToSubagentId: Map<string, string>;
  earlyToolEvents: Map<string, Array<unknown>>;
  resolveNextPendingTaskToolCorrelationId: () => string | undefined;
  registerPreferredToolCorrelationAlias: (
    preferredCorrelationId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  removePendingTaskToolCorrelationId: (correlationId: string) => void;
  recordPendingSubagentCorrelationId: (correlationId: string) => void;
  removePendingSubagentCorrelationId: (correlationId: string) => void;
  replayEarlyToolEvents: (
    agentId: string,
    ...keys: Array<string | undefined>
  ) => void;
};

export class OpenCodeSubagentEventHandlers {
  constructor(private readonly deps: OpenCodeSubagentEventHandlerDependencies) {}

  createSubagentStartHandler(runId: number): EventHandler<"subagent.start"> {
    return (event) => {
      const data = event.data as SubagentStartEventData;
      const dataRecord = data as Record<string, unknown>;
      const subagentSessionId = this.deps.asString(dataRecord.subagentSessionId);
      const rawSdkCorrelationId = this.deps.asString(
        data.toolUseId ?? data.toolUseID ?? data.toolCallId,
      );
      const canonicalRawCorrelationId = this.deps.resolveToolCorrelationId(rawSdkCorrelationId)
        ?? rawSdkCorrelationId;
      const hasTaskCorrelation = Boolean(
        canonicalRawCorrelationId
          && (
            this.deps.taskToolMetadata.has(canonicalRawCorrelationId)
            || this.deps.getPendingTaskToolCorrelationIds().includes(canonicalRawCorrelationId)
          ),
      );
      const isKnownSubagent = this.deps.subagentIdToCorrelationId.has(data.subagentId);
      if (!this.deps.isOwnedSession(event.sessionId) && !hasTaskCorrelation && !isKnownSubagent) {
        return;
      }

      this.deps.getSubagentTracker()?.registerAgent(data.subagentId);
      if (subagentSessionId) {
        this.deps.getOwnedSessionIds().add(subagentSessionId);
        this.deps.subagentSessionToAgentId.set(subagentSessionId, data.subagentId);
      }

      let sdkCorrelationId = this.deps.resolveToolCorrelationId(rawSdkCorrelationId);
      let parentToolUseId = this.deps.resolveToolCorrelationId(this.deps.asString(
        dataRecord.parentToolUseId
          ?? dataRecord.parent_tool_use_id
          ?? dataRecord.parentToolUseID,
      ));
      if (!sdkCorrelationId) {
        sdkCorrelationId = this.deps.resolveKnownSubagentCorrelation(data.subagentId, subagentSessionId);
      }
      if (!parentToolUseId) {
        parentToolUseId = this.deps.resolveKnownSubagentCorrelation(data.subagentId, subagentSessionId);
      }

      const hasSdkMetadata = sdkCorrelationId
        ? this.deps.taskToolMetadata.has(sdkCorrelationId)
        : false;
      if (!hasSdkMetadata && parentToolUseId && this.deps.taskToolMetadata.has(parentToolUseId)) {
        sdkCorrelationId = parentToolUseId;
      }

      if (!sdkCorrelationId) {
        const inferredTaskToolId = this.deps.resolveNextPendingTaskToolCorrelationId();
        if (inferredTaskToolId) {
          sdkCorrelationId = inferredTaskToolId;
          parentToolUseId = parentToolUseId ?? inferredTaskToolId;
        }
      } else if (!this.deps.taskToolMetadata.has(sdkCorrelationId)) {
        const inferredTaskToolId = this.deps.resolveNextPendingTaskToolCorrelationId();
        if (inferredTaskToolId && inferredTaskToolId !== sdkCorrelationId) {
          this.deps.registerPreferredToolCorrelationAlias(inferredTaskToolId, sdkCorrelationId);
          sdkCorrelationId = inferredTaskToolId;
          parentToolUseId = parentToolUseId ?? inferredTaskToolId;
        }
      }

      const metadata = (sdkCorrelationId ? this.deps.taskToolMetadata.get(sdkCorrelationId) : undefined)
        ?? (parentToolUseId ? this.deps.taskToolMetadata.get(parentToolUseId) : undefined);
      const effectiveTask = metadata?.description || data.task;
      const normalizedTask = isGenericSubagentTaskLabel(effectiveTask)
        ? (this.deps.asString(dataRecord.description) ?? effectiveTask)
        : effectiveTask;
      const normalizedMetadata = normalizeAgentTaskMetadata({
        task: normalizedTask,
        agentType: data.subagentType,
        isBackground: metadata?.isBackground
          ?? (dataRecord.isBackground as boolean | undefined),
        toolInput: dataRecord.toolInput,
      });

      if (sdkCorrelationId) {
        const existingMappedAgentId = this.deps.toolUseIdToSubagentId.get(sdkCorrelationId);
        if (existingMappedAgentId && existingMappedAgentId !== data.subagentId) {
          return;
        }
        this.deps.toolUseIdToSubagentId.set(sdkCorrelationId, data.subagentId);
        this.deps.subagentIdToCorrelationId.set(data.subagentId, sdkCorrelationId);
        this.deps.removePendingTaskToolCorrelationId(sdkCorrelationId);
      }
      if (parentToolUseId && parentToolUseId !== sdkCorrelationId) {
        this.deps.toolUseIdToSubagentId.set(parentToolUseId, data.subagentId);
        if (!sdkCorrelationId) {
          this.deps.subagentIdToCorrelationId.set(data.subagentId, parentToolUseId);
        }
        this.deps.removePendingTaskToolCorrelationId(parentToolUseId);
      }
      if (subagentSessionId) {
        const knownCorrelationId = sdkCorrelationId ?? parentToolUseId;
        if (knownCorrelationId) {
          this.deps.subagentSessionToCorrelationId.set(subagentSessionId, knownCorrelationId);
        }
      }
      for (const [knownSubagentSessionId, knownCorrelationId] of this.deps.subagentSessionToCorrelationId.entries()) {
        const resolvedKnownCorrelationId = this.deps.resolveToolCorrelationId(knownCorrelationId)
          ?? knownCorrelationId;
        const resolvedSdkCorrelationId = sdkCorrelationId
          ? (this.deps.resolveToolCorrelationId(sdkCorrelationId) ?? sdkCorrelationId)
          : undefined;
        const resolvedParentToolUseId = parentToolUseId
          ? (this.deps.resolveToolCorrelationId(parentToolUseId) ?? parentToolUseId)
          : undefined;
        if (
          resolvedKnownCorrelationId !== resolvedSdkCorrelationId
          && resolvedKnownCorrelationId !== resolvedParentToolUseId
        ) {
          continue;
        }
        this.deps.getOwnedSessionIds().add(knownSubagentSessionId);
        this.deps.subagentSessionToAgentId.set(knownSubagentSessionId, data.subagentId);
      }

      this.deps.replayEarlyToolEvents(
        data.subagentId,
        data.subagentId,
        rawSdkCorrelationId,
        sdkCorrelationId,
        parentToolUseId,
      );

      if (rawSdkCorrelationId && !this.deps.taskToolMetadata.has(rawSdkCorrelationId)) {
        this.deps.recordPendingSubagentCorrelationId(rawSdkCorrelationId);
      } else if (rawSdkCorrelationId) {
        this.deps.removePendingSubagentCorrelationId(rawSdkCorrelationId);
      }
      if (sdkCorrelationId) {
        this.deps.removePendingSubagentCorrelationId(sdkCorrelationId);
      }

      const busEvent: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: data.subagentId,
          toolCallId: sdkCorrelationId ?? data.subagentId,
          agentType: data.subagentType ?? "unknown",
          task: normalizedMetadata.task,
          isBackground: normalizedMetadata.isBackground,
          sdkCorrelationId,
        },
      };
      this.deps.bus.publish(busEvent);
    };
  }

  createSubagentCompleteHandler(runId: number): EventHandler<"subagent.complete"> {
    return (event) => {
      const data = event.data as SubagentCompleteEventData;
      const isKnownSubagent = this.deps.subagentIdToCorrelationId.has(data.subagentId)
        || Array.from(this.deps.subagentSessionToAgentId.values()).includes(data.subagentId);
      if (!this.deps.isOwnedSession(event.sessionId) && !isKnownSubagent) {
        return;
      }
      this.deps.getSubagentTracker()?.removeAgent(data.subagentId);
      this.deps.subagentIdToCorrelationId.delete(data.subagentId);
      for (const [subagentSessionId, agentId] of this.deps.subagentSessionToAgentId.entries()) {
        if (agentId === data.subagentId) {
          this.deps.subagentSessionToAgentId.delete(subagentSessionId);
          this.deps.getOwnedSessionIds().delete(subagentSessionId);
          this.deps.subagentSessionToCorrelationId.delete(subagentSessionId);
        }
      }
      for (const [toolUseId, subagentId] of this.deps.toolUseIdToSubagentId.entries()) {
        if (subagentId === data.subagentId) {
          this.deps.toolUseIdToSubagentId.delete(toolUseId);
          this.deps.taskToolMetadata.delete(toolUseId);
          this.deps.removePendingTaskToolCorrelationId(toolUseId);
          this.deps.removePendingSubagentCorrelationId(toolUseId);
          this.deps.earlyToolEvents.delete(toolUseId);
        }
      }
      this.deps.earlyToolEvents.delete(data.subagentId);
      this.deps.bus.publish({
        type: "stream.agent.complete",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: data.subagentId,
          success: data.success,
          result: data.result ? String(data.result) : undefined,
        },
      });
    };
  }

  createSubagentUpdateHandler(runId: number): EventHandler<"subagent.update"> {
    return (event) => {
      const data = event.data as SubagentUpdateEventData;
      const isKnownSubagent = this.deps.subagentIdToCorrelationId.has(data.subagentId)
        || Array.from(this.deps.subagentSessionToAgentId.values()).includes(data.subagentId);
      if (!this.deps.isOwnedSession(event.sessionId) && !isKnownSubagent) return;
      this.deps.bus.publish({
        type: "stream.agent.update",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId: data.subagentId,
          currentTool: data.currentTool,
          toolUses: data.toolUses,
        },
      });
    };
  }
}
