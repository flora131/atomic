import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type { AgentMessage } from "@/services/agents/types.ts";
import { isSkillToolName } from "@/services/agents/clients/skill-invocation.ts";
import type {
  ClaudeActiveSubagentToolContext,
  ClaudeTaskToolMetadata,
} from "@/services/events/adapters/providers/claude/tool-state.ts";
import { SubagentToolTracker } from "@/services/events/adapters/subagent-tool-tracker.ts";
import { toolDebug } from "@/services/events/adapters/providers/claude/tool-debug-log.ts";

type ClaudeStreamChunkProcessorDependencies = {
  bus: EventBus;
  sessionId: string;
  getTextAccumulator: () => string;
  setTextAccumulator: (value: string) => void;
  preferClientToolHooks: () => boolean;
  taskToolMetadata: Map<string, ClaudeTaskToolMetadata>;
  toolUseIdToSubagentId: Map<string, string>;
  activeSubagentToolsById: Map<string, ClaudeActiveSubagentToolContext>;
  setCurrentBackgroundAttributionAgentId: (value: string | null) => void;
  resolveToolCorrelationId: (correlationId: string | undefined) => string | undefined;
  asString: (value: unknown) => string | undefined;
  asRecord: (value: unknown) => Record<string, unknown> | undefined;
  normalizeToolName: (value: unknown) => string;
  resolveToolStartId: (
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ) => string;
  resolveToolCompleteId: (
    explicitToolId: string | undefined,
    runId: number,
    toolName: string,
  ) => string;
  isTaskTool: (toolName: string) => boolean;
  extractTaskToolMetadata: (toolInput: unknown) => ClaudeTaskToolMetadata;
  recordPendingTaskToolCorrelationId: (correlationId: string) => void;
  resolveTaskOutputParentAgentId: (
    toolName: string,
    toolInput: Record<string, unknown>,
  ) => string | undefined;
  resolveSoleActiveSubagentId: () => string | undefined;
  resolveBackgroundAttributionFallbackAgentId: () => string | undefined;
  resolveSoleActiveSubagentToolParentAgentId: () => string | undefined;
  recordActiveSubagentToolContext: (
    toolId: string,
    toolName: string,
    parentAgentId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  removeActiveSubagentToolContext: (
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  resolveActiveSubagentToolContext: (
    ...correlationIds: Array<string | undefined>
  ) => ClaudeActiveSubagentToolContext | undefined;
  getSubagentTracker: () => SubagentToolTracker | null;
};

export class ClaudeStreamChunkProcessor {
  constructor(private readonly deps: ClaudeStreamChunkProcessorDependencies) {}

  process(
    chunk: AgentMessage,
    runId: number,
    messageId: string,
  ): void {
    if (chunk.type === "text" && typeof chunk.content === "string") {
      this.processTextChunk(chunk, runId, messageId);
      return;
    }

    if (chunk.type === "tool_use") {
      this.processToolUseChunk(chunk, runId);
      return;
    }

    if (chunk.type === "tool_result") {
      this.processToolResultChunk(chunk, runId);
    }
  }

  private processTextChunk(
    chunk: AgentMessage,
    runId: number,
    messageId: string,
  ): void {
    const textChunk = chunk as AgentMessage & {
      type: "text";
      content: string;
      metadata?: Record<string, unknown>;
    };
    const delta = textChunk.content;
    const metadata = textChunk.metadata;
    const parentToolCallId = this.deps.resolveToolCorrelationId(
      this.deps.asString(
        metadata?.parentToolCallId
        ?? metadata?.parent_tool_call_id
        ?? metadata?.parentToolUseId
        ?? metadata?.parent_tool_use_id,
      ),
    );

    if (parentToolCallId) {
      const agentId = this.deps.toolUseIdToSubagentId.get(parentToolCallId) ?? parentToolCallId;
      if (agentId && delta.length > 0) {
        const textEvent: BusEvent<"stream.text.delta"> = {
          type: "stream.text.delta",
          sessionId: this.deps.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            delta,
            messageId,
            agentId,
          },
        };
        this.deps.bus.publish(textEvent);
        return;
      }

      const context = this.deps.activeSubagentToolsById.get(parentToolCallId);
      const partialEvent: BusEvent<"stream.tool.partial_result"> = {
        type: "stream.tool.partial_result",
        sessionId: this.deps.sessionId,
        runId,
        timestamp: Date.now(),
        data: {
          toolCallId: parentToolCallId,
          partialOutput: delta,
          ...(context ? { parentAgentId: context.parentAgentId } : {}),
        },
      };
      this.deps.bus.publish(partialEvent);
      return;
    }

    this.deps.setTextAccumulator(this.deps.getTextAccumulator() + delta);
    if (delta.length === 0) {
      return;
    }

    const textEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: this.deps.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        delta,
        messageId,
      },
    };
    this.deps.bus.publish(textEvent);
  }

  private processToolUseChunk(
    chunk: AgentMessage,
    runId: number,
  ): void {
    if (this.deps.preferClientToolHooks()) {
      return;
    }

    const chunkRecord = chunk as unknown as Record<string, unknown>;
    const contentRecord = this.deps.asRecord(chunkRecord.content) ?? {};
    const metadataRecord = this.deps.asRecord(chunk.metadata) ?? {};
    const toolName = this.deps.normalizeToolName(
      contentRecord.name ?? chunkRecord.name ?? metadataRecord.toolName,
    );
    if (isSkillToolName(toolName)) {
      return;
    }

    const explicitToolId = this.deps.asString(
      contentRecord.toolUseId
        ?? contentRecord.toolUseID
        ?? contentRecord.id
        ?? chunkRecord.toolUseId
        ?? chunkRecord.toolUseID
        ?? chunkRecord.id
        ?? metadataRecord.toolId
        ?? metadataRecord.toolUseId
        ?? metadataRecord.toolUseID
        ?? metadataRecord.toolCallId,
    );
    const toolInput = this.deps.asRecord(contentRecord.input ?? chunkRecord.input) ?? {};
    const toolId = this.deps.resolveToolStartId(explicitToolId, runId, toolName);
    const sdkCorrelationId = explicitToolId ?? toolId;

    if (this.deps.isTaskTool(toolName) && sdkCorrelationId) {
      const metadata = this.deps.extractTaskToolMetadata(toolInput);
      this.deps.taskToolMetadata.set(sdkCorrelationId, metadata);
      this.deps.recordPendingTaskToolCorrelationId(sdkCorrelationId);
    }

    const taskOutputParentAgentId = this.deps.resolveTaskOutputParentAgentId(toolName, toolInput);
    const soleActiveId = this.deps.resolveSoleActiveSubagentId();
    const bgFallbackId = this.deps.resolveBackgroundAttributionFallbackAgentId();
    const activeToolFallbackId = this.deps.resolveSoleActiveSubagentToolParentAgentId();
    const inferredParentAgentId = taskOutputParentAgentId
      ?? soleActiveId
      ?? bgFallbackId
      ?? activeToolFallbackId;

    toolDebug("chunkToolStart:attribution", {
      sdkCorrelationId,
      toolName,
      toolId,
      taskOutputParentAgentId,
      soleActiveId,
      bgFallbackId,
      activeToolFallbackId,
      inferredParentAgentId,
    });

    if (inferredParentAgentId) {
      this.deps.recordActiveSubagentToolContext(
        toolId,
        toolName,
        inferredParentAgentId,
        explicitToolId,
      );
      if (this.deps.getSubagentTracker()?.hasAgent(inferredParentAgentId)) {
        this.deps.getSubagentTracker()?.onToolStart(inferredParentAgentId, toolName);
      }
      if (toolName.toLowerCase() === "taskoutput") {
        this.deps.setCurrentBackgroundAttributionAgentId(inferredParentAgentId);
      }
    }

    const startEvent: BusEvent<"stream.tool.start"> = {
      type: "stream.tool.start",
      sessionId: this.deps.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName,
        toolInput,
        sdkCorrelationId,
        ...(inferredParentAgentId ? { parentAgentId: inferredParentAgentId } : {}),
      },
    };
    this.deps.bus.publish(startEvent);
  }

  private processToolResultChunk(
    chunk: AgentMessage,
    runId: number,
  ): void {
    if (this.deps.preferClientToolHooks()) {
      return;
    }

    const chunkRecord = chunk as unknown as Record<string, unknown>;
    const content = chunkRecord.content;
    const metadataRecord = this.deps.asRecord(chunk.metadata) ?? {};
    const toolName = this.deps.normalizeToolName(
      chunkRecord.toolName ?? metadataRecord.toolName,
    );
    if (isSkillToolName(toolName)) {
      return;
    }

    const explicitToolId = this.deps.asString(
      chunkRecord.tool_use_id
        ?? chunkRecord.toolUseId
        ?? chunkRecord.toolUseID
        ?? metadataRecord.toolId
        ?? metadataRecord.toolUseId
        ?? metadataRecord.toolUseID
        ?? metadataRecord.toolCallId,
    );
    const toolId = this.deps.resolveToolCompleteId(explicitToolId, runId, toolName);
    const activeContext = this.deps.resolveActiveSubagentToolContext(toolId, explicitToolId);
    this.deps.removeActiveSubagentToolContext(toolId, explicitToolId);

    toolDebug("chunkToolComplete:attribution", {
      toolId,
      toolName,
      explicitToolId,
      activeContextParentAgentId: activeContext?.parentAgentId,
      hasTrackerAgent: activeContext ? this.deps.getSubagentTracker()?.hasAgent(activeContext.parentAgentId) : false,
    });

    if (activeContext && this.deps.getSubagentTracker()?.hasAgent(activeContext.parentAgentId)) {
      this.deps.getSubagentTracker()?.onToolComplete(activeContext.parentAgentId);
    }

    const contentRecord = this.deps.asRecord(content);
    const isError = chunkRecord.is_error === true
      || (typeof content === "object" && content !== null && "error" in content);
    const errorValue = contentRecord?.error;
    const completeEvent: BusEvent<"stream.tool.complete"> = {
      type: "stream.tool.complete",
      sessionId: this.deps.sessionId,
      runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName,
        toolResult: content,
        success: !isError,
        error: isError
          ? (typeof errorValue === "string" ? errorValue : String(content))
          : undefined,
        sdkCorrelationId: explicitToolId ?? toolId,
        ...(activeContext ? { parentAgentId: activeContext.parentAgentId } : {}),
      },
    };
    this.deps.bus.publish(completeEvent);
  }
}
