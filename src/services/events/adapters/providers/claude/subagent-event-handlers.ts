import type { EventBus } from "@/services/events/event-bus.ts";
import type {
  AgentEvent,
  EventHandler,
  EventType,
  SubagentCompleteEventData,
  SubagentStartEventData,
  SubagentUpdateEventData,
} from "@/services/agents/types.ts";
import { isGenericSubagentTaskLabel } from "@/services/events/adapters/provider-shared.ts";
import { normalizeAgentTaskMetadata } from "@/services/events/adapters/task-turn-normalization.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import type { ClaudeEarlyToolStartEvent, ClaudeTaskToolMetadata } from "@/services/events/adapters/providers/claude/tool-state.ts";

type ClaudeSubagentEventHandlerDependencies = {
  bus: EventBus;
  sessionId: string;
  getSubagentTracker: () => SubagentToolTracker | null;
  resolveEventSessionId: (event: AgentEvent<EventType>) => string;
  getSyntheticForegroundAgent: () => { sawNativeSubagentStart: boolean } | null;
  publishSyntheticAgentComplete: (runId: number, success: boolean, error?: string) => void;
  asString: (value: unknown) => string | undefined;
  resolveToolCorrelationId: (correlationId: string | undefined) => string | undefined;
  hasKnownSubagentId: (subagentId: string) => boolean;
  taskToolMetadata: Map<string, ClaudeTaskToolMetadata>;
  getPendingTaskToolCorrelationIds: () => string[];
  resolveNextPendingTaskToolCorrelationId: () => string | undefined;
  activeSubagentIds: Set<string>;
  nativeSubagentIdToAgentId: Map<string, string>;
  getOwnedSessionIds: () => Set<string>;
  subagentSessionToAgentId: Map<string, string>;
  activeSubagentBackgroundById: Map<string, boolean>;
  getCurrentBackgroundAttributionAgentId: () => string | null;
  setCurrentBackgroundAttributionAgentId: (value: string | null) => void;
  toolUseIdToSubagentId: Map<string, string>;
  removePendingTaskToolCorrelationId: (correlationId: string) => void;
  earlyToolEvents: Map<string, ClaudeEarlyToolStartEvent[]>;
  replayEarlyToolStart: (parentAgentId: string, event: ClaudeEarlyToolStartEvent, runId: number) => void;
  resolveCanonicalAgentId: (agentId: string | undefined) => string | undefined;
  resolveBackgroundAttributionFallbackAgentId: () => string | undefined;
};

export class ClaudeSubagentEventHandlers {
  constructor(private readonly deps: ClaudeSubagentEventHandlerDependencies) {}

  createSubagentStartHandler(runId: number): EventHandler<"subagent.start"> {
    return (event) => {
      const data = event.data as SubagentStartEventData;
      const dataRecord = data as Record<string, unknown>;
      const eventSessionId = this.deps.resolveEventSessionId(event);
      const subagentSessionId = this.deps.asString(
        dataRecord.subagentSessionId
          ?? dataRecord.subagent_session_id
          ?? dataRecord.session_id
          ?? dataRecord.sessionId,
      );
      const syntheticForegroundAgent = this.deps.getSyntheticForegroundAgent();
      if (syntheticForegroundAgent) {
        syntheticForegroundAgent.sawNativeSubagentStart = true;
        this.deps.publishSyntheticAgentComplete(runId, true);
      }

      const rawSdkCorrelationId = this.deps.asString(
        data.toolUseId ?? data.toolUseID ?? data.toolCallId,
      );
      let sdkCorrelationId = this.deps.resolveToolCorrelationId(rawSdkCorrelationId);
      let parentToolUseId = this.deps.resolveToolCorrelationId(this.deps.asString(
        dataRecord.parentToolUseId
          ?? dataRecord.parent_tool_use_id
          ?? dataRecord.parentToolUseID
          ?? dataRecord.parentToolCallId
          ?? dataRecord.parent_tool_call_id
          ?? dataRecord.parentToolCallID,
      ));
      const isKnownSubagent = this.deps.hasKnownSubagentId(data.subagentId);
      const hasTaskCorrelation = Boolean(
        sdkCorrelationId
        && (
          this.deps.taskToolMetadata.has(sdkCorrelationId)
          || this.deps.getPendingTaskToolCorrelationIds().includes(sdkCorrelationId)
        ),
      );
      const hasParentTaskCorrelation = Boolean(
        parentToolUseId
        && (
          this.deps.taskToolMetadata.has(parentToolUseId)
          || this.deps.getPendingTaskToolCorrelationIds().includes(parentToolUseId)
        ),
      );
      if (
        eventSessionId !== this.deps.sessionId
        && !this.deps.getOwnedSessionIds().has(eventSessionId)
        && !isKnownSubagent
        && !hasTaskCorrelation
        && !hasParentTaskCorrelation
      ) {
        return;
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
      } else if (!parentToolUseId && !this.deps.taskToolMetadata.has(sdkCorrelationId)) {
        const inferredTaskToolId = this.deps.resolveNextPendingTaskToolCorrelationId();
        if (inferredTaskToolId) {
          parentToolUseId = inferredTaskToolId;
          if (!this.deps.taskToolMetadata.has(sdkCorrelationId)) {
            sdkCorrelationId = inferredTaskToolId;
          }
        }
      }

      const metadata = (sdkCorrelationId ? this.deps.taskToolMetadata.get(sdkCorrelationId) : undefined)
        ?? (parentToolUseId ? this.deps.taskToolMetadata.get(parentToolUseId) : undefined);
      const metadataTaskDescription = this.deps.asString(metadata?.description);
      const subagentTaskDescription = this.deps.asString(
        dataRecord.description
          ?? dataRecord.prompt
          ?? dataRecord.taskDescription
          ?? dataRecord.task_description
          ?? dataRecord.title,
      );
      const effectiveTask = metadataTaskDescription
        ?? subagentTaskDescription
        ?? this.deps.asString(data.task);
      const normalizedTask = isGenericSubagentTaskLabel(effectiveTask)
        ? (subagentTaskDescription ?? effectiveTask)
        : effectiveTask;
      const normalizedMetadata = normalizeAgentTaskMetadata({
        task: normalizedTask,
        agentType: data.subagentType,
        isBackground: metadata?.isBackground
          ?? (dataRecord.isBackground as boolean | undefined),
        toolInput: dataRecord.toolInput,
      });
      const agentId = parentToolUseId ?? sdkCorrelationId ?? data.subagentId;

      this.deps.getSubagentTracker()?.registerAgent(agentId, {
        isBackground: normalizedMetadata.isBackground,
      });
      this.deps.activeSubagentIds.add(agentId);
      this.deps.nativeSubagentIdToAgentId.set(data.subagentId, agentId);
      if (subagentSessionId && subagentSessionId !== this.deps.sessionId) {
        this.deps.getOwnedSessionIds().add(subagentSessionId);
        this.deps.subagentSessionToAgentId.set(subagentSessionId, agentId);
      }
      if (eventSessionId !== this.deps.sessionId) {
        this.deps.getOwnedSessionIds().add(eventSessionId);
        this.deps.subagentSessionToAgentId.set(eventSessionId, agentId);
      }
      this.deps.activeSubagentBackgroundById.set(agentId, normalizedMetadata.isBackground);
      if (normalizedMetadata.isBackground && !this.deps.getCurrentBackgroundAttributionAgentId()) {
        this.deps.setCurrentBackgroundAttributionAgentId(agentId);
      }

      if (sdkCorrelationId) {
        this.deps.toolUseIdToSubagentId.set(sdkCorrelationId, agentId);
        this.deps.removePendingTaskToolCorrelationId(sdkCorrelationId);
      }
      if (parentToolUseId && parentToolUseId !== sdkCorrelationId) {
        this.deps.toolUseIdToSubagentId.set(parentToolUseId, agentId);
        this.deps.removePendingTaskToolCorrelationId(parentToolUseId);
      }

      for (const key of [agentId, sdkCorrelationId, parentToolUseId]) {
        if (!key) continue;
        const earlyTools = this.deps.earlyToolEvents.get(key);
        if (!earlyTools) continue;
        for (const tool of earlyTools) {
          this.deps.replayEarlyToolStart(agentId, tool, runId);
        }
        this.deps.earlyToolEvents.delete(key);
      }

      this.deps.bus.publish({
        type: "stream.agent.start",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId,
          toolCallId: agentId,
          agentType: data.subagentType ?? "unknown",
          task: normalizedMetadata.task,
          isBackground: normalizedMetadata.isBackground,
          sdkCorrelationId: agentId,
        },
      });
    };
  }

  createSubagentCompleteHandler(runId: number): EventHandler<"subagent.complete"> {
    return (event) => {
      const data = event.data as SubagentCompleteEventData;
      const eventSessionId = this.deps.resolveEventSessionId(event);
      if (
        eventSessionId !== this.deps.sessionId
        && !this.deps.getOwnedSessionIds().has(eventSessionId)
        && !this.deps.hasKnownSubagentId(data.subagentId)
      ) {
        return;
      }
      const agentId = this.deps.resolveCanonicalAgentId(data.subagentId) ?? data.subagentId;
      this.deps.getSubagentTracker()?.removeAgent(agentId);
      this.deps.activeSubagentIds.delete(agentId);
      this.deps.activeSubagentBackgroundById.delete(agentId);
      this.deps.earlyToolEvents.delete(agentId);
      this.deps.nativeSubagentIdToAgentId.delete(data.subagentId);
      for (const [toolUseId, subagentId] of this.deps.toolUseIdToSubagentId.entries()) {
        if (subagentId === agentId) {
          this.deps.toolUseIdToSubagentId.delete(toolUseId);
          this.deps.taskToolMetadata.delete(toolUseId);
          this.deps.removePendingTaskToolCorrelationId(toolUseId);
          this.deps.earlyToolEvents.delete(toolUseId);
        }
      }
      for (const [subagentSessionId, mappedAgentId] of this.deps.subagentSessionToAgentId.entries()) {
        if (mappedAgentId === agentId) {
          this.deps.subagentSessionToAgentId.delete(subagentSessionId);
          this.deps.getOwnedSessionIds().delete(subagentSessionId);
        }
      }
      if (this.deps.getCurrentBackgroundAttributionAgentId() === agentId) {
        this.deps.setCurrentBackgroundAttributionAgentId(
          this.deps.resolveBackgroundAttributionFallbackAgentId() ?? null,
        );
      }

      this.deps.bus.publish({
        type: "stream.agent.complete",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId,
          success: data.success,
          result: typeof data.result === "string" ? data.result : undefined,
          error: typeof (data as Record<string, unknown>).error === "string"
            ? (data as Record<string, unknown>).error as string
            : undefined,
        },
      });
    };
  }

  createSubagentUpdateHandler(runId: number): EventHandler<"subagent.update"> {
    return (event) => {
      const data = event.data as SubagentUpdateEventData;
      const eventSessionId = this.deps.resolveEventSessionId(event);
      if (
        eventSessionId !== this.deps.sessionId
        && !this.deps.getOwnedSessionIds().has(eventSessionId)
        && !this.deps.hasKnownSubagentId(data.subagentId)
      ) {
        return;
      }
      const agentId = this.deps.resolveCanonicalAgentId(data.subagentId) ?? data.subagentId;
      this.deps.bus.publish({
        type: "stream.agent.update",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          agentId,
          currentTool: data.currentTool,
          toolUses: data.toolUses,
        },
      });
    };
  }
}
