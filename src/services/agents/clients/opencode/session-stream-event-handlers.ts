import type { AgentEvent, AgentMessage } from "@/services/agents/types.ts";
import {
  withSubagentLifecycleMetadata,
  withSubagentRoutingMetadata,
} from "@/services/agents/contracts/subagent-stream.ts";
import type { OpenCodeSessionState } from "@/services/agents/clients/opencode/shared.ts";
import type { OpenCodeSessionRuntimeArgs } from "@/services/agents/clients/opencode/session-runtime-types.ts";
import type {
  OpenCodeSessionStreamController,
} from "@/services/agents/clients/opencode/session-stream-controller.ts";

export function createOpenCodeSessionStreamEventHandlers(args: {
  controller: OpenCodeSessionStreamController;
  runtimeArgs: OpenCodeSessionRuntimeArgs;
  sessionState: OpenCodeSessionState;
  isSubagentDispatch: boolean;
}): {
  handleDelta: (event: AgentEvent<"message.delta">) => void;
  handleSubagentStart: (event: AgentEvent<"subagent.start">) => void;
  handleSubagentUpdate: (event: AgentEvent<"subagent.update">) => void;
  handleSubagentComplete: (event: AgentEvent<"subagent.complete">) => void;
  handleToolStart: (event: AgentEvent<"tool.start">) => void;
  handleToolComplete: (event: AgentEvent<"tool.complete">) => void;
  handleIdle: (event: AgentEvent<"session.idle">) => void;
  handleError: (event: AgentEvent<"session.error">) => void;
  handleUsage: (event: AgentEvent<"usage">) => void;
} {
  const sessionAgentIds = new Map<string, string>();

  const enqueueDelta = (messageChunk: AgentMessage): void => {
    args.controller.enqueueDelta(messageChunk);
  };

  const buildToolUseId = (toolData: Record<string, unknown>): string =>
    (toolData.toolUseId as string | undefined)
    ?? (toolData.toolUseID as string | undefined)
    ?? (toolData.toolCallId as string | undefined)
    ?? args.controller.buildSyntheticToolUseId();

  const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim().length > 0 ? value : undefined;

  const withRoutingMetadata = (
    sessionId: string,
    metadata?: Record<string, unknown>,
  ): Record<string, unknown> | undefined => {
    const agentId = sessionAgentIds.get(sessionId);
    if (!agentId) {
      return metadata && Object.keys(metadata).length > 0 ? metadata : undefined;
    }

    return withSubagentRoutingMetadata(metadata, { agentId, sessionId });
  };

  return {
    handleDelta: (event) => {
      if (!args.controller.isRelatedSession(event.sessionId)) return;

      const delta = event.data?.delta as string | undefined;
      const contentType = event.data?.contentType as string | undefined;
      const thinkingSourceKey = event.data?.thinkingSourceKey as string | undefined;
      if (!delta) {
        return;
      }

      enqueueDelta({
        type: contentType === "thinking" ? "thinking" : "text",
        content: delta,
        role: "assistant",
        ...(contentType === "thinking"
          ? {
            metadata: withRoutingMetadata(event.sessionId, {
              provider: "opencode",
              thinkingSourceKey,
              streamingStats: {
                thinkingMs: 0,
                outputTokens: 0,
              },
            }),
          }
          : (() => {
            const metadata = withRoutingMetadata(event.sessionId);
            return metadata ? { metadata } : {};
          })()),
      });
    },
    handleSubagentStart: (event) => {
      if (!args.isSubagentDispatch) return;
      if (!args.controller.isRelatedSession(event.sessionId)) return;

      const data = event.data as Record<string, unknown>;
      const subagentSessionId = asString(data.subagentSessionId);
      const subagentId = asString(data.subagentId);
      if (subagentSessionId) {
        args.controller.registerRelatedSession(subagentSessionId);
        if (subagentId) {
          sessionAgentIds.set(subagentSessionId, subagentId);
        }
      }
      if (!subagentId) {
        return;
      }

      const toolCallId = asString(
        data.toolUseId
          ?? data.toolUseID
          ?? data.toolCallId
          ?? data.parentToolUseId
          ?? data.parent_tool_use_id
          ?? data.parentToolUseID,
      );
      enqueueDelta({
        type: "text",
        content: "",
        role: "assistant",
        metadata: withSubagentLifecycleMetadata(undefined, {
          eventType: "start",
          subagentId,
          ...(asString(data.subagentType) ? { subagentType: asString(data.subagentType) } : {}),
          ...(asString(data.task) ? { task: asString(data.task) } : {}),
          ...(toolCallId ? { toolCallId, sdkCorrelationId: toolCallId } : {}),
          ...(data.isBackground === true ? { isBackground: true } : {}),
        }),
      });
    },
    handleSubagentUpdate: (event) => {
      if (!args.isSubagentDispatch) return;
      if (!args.controller.isRelatedSession(event.sessionId)) return;

      const data = event.data as Record<string, unknown>;
      const subagentId = asString(data.subagentId);
      if (!subagentId) {
        return;
      }

      enqueueDelta({
        type: "text",
        content: "",
        role: "assistant",
        metadata: withSubagentLifecycleMetadata(undefined, {
          eventType: "update",
          subagentId,
          ...(asString(data.currentTool) ? { currentTool: asString(data.currentTool) } : {}),
          ...(typeof data.toolUses === "number" ? { toolUses: data.toolUses } : {}),
        }),
      });
    },
    handleSubagentComplete: (event) => {
      if (!args.isSubagentDispatch) return;
      if (!args.controller.isRelatedSession(event.sessionId)) return;

      const data = event.data as Record<string, unknown>;
      const subagentId = asString(data.subagentId);
      if (!subagentId) {
        return;
      }

      enqueueDelta({
        type: "text",
        content: "",
        role: "assistant",
        metadata: withSubagentLifecycleMetadata(undefined, {
          eventType: "complete",
          subagentId,
          success: data.success !== false,
          ...(data.result !== undefined ? { result: data.result } : {}),
          ...(asString(data.error) ? { error: asString(data.error) } : {}),
        }),
      });
    },
    handleToolStart: (event) => {
      if (!args.isSubagentDispatch) return;
      if (!args.controller.isRelatedSession(event.sessionId)) return;

      const toolData = event.data as Record<string, unknown>;
      const toolName = (toolData.toolName as string | undefined) ?? "unknown";
      const toolInput = (toolData.toolInput as Record<string, unknown> | undefined) ?? {};
      const toolUseId = buildToolUseId(toolData);

      if (!args.controller.markToolStarted(toolUseId)) {
        return;
      }

      enqueueDelta({
        type: "tool_use",
        content: {
          name: toolName,
          input: toolInput,
          toolUseId,
        },
        role: "assistant",
        metadata: withRoutingMetadata(event.sessionId, {
          toolName,
          toolId: toolUseId,
        }),
      });
    },
    handleToolComplete: (event) => {
      if (!args.isSubagentDispatch) return;
      if (!args.controller.isRelatedSession(event.sessionId)) return;

      const toolData = event.data as Record<string, unknown>;
      const toolName = (toolData.toolName as string | undefined) ?? "unknown";
      const toolUseId = buildToolUseId(toolData);

      if (!args.controller.markToolCompleted(toolUseId)) {
        return;
      }

      const success = (toolData.success as boolean | undefined) ?? true;
      const toolResult = success
        ? toolData.toolResult
        : { error: (toolData.error as string | undefined) ?? "Tool execution failed" };

      enqueueDelta({
        type: "tool_result",
        content: toolResult,
        role: "assistant",
        metadata: withRoutingMetadata(event.sessionId, {
          toolName,
          toolId: toolUseId,
          error: !success,
        }),
      });
    },
    handleIdle: (event) => {
      if (!args.controller.isRelatedSession(event.sessionId)) return;
      args.controller.markTerminalEventSeen();
    },
    handleError: (event) => {
      if (!args.controller.isRelatedSession(event.sessionId)) return;
      args.controller.setStreamError(
        new Error(String(event.data?.error ?? "Stream error")),
      );
      args.controller.markTerminalEventSeen();
      args.controller.markStreamDone();
    },
    handleUsage: (event) => {
      if (event.sessionId !== args.runtimeArgs.sessionId) return;
      const usageData = event.data as { inputTokens?: unknown; outputTokens?: unknown };
      if (typeof usageData.inputTokens === "number") {
        args.sessionState.inputTokens = usageData.inputTokens;
      }
      if (typeof usageData.outputTokens === "number") {
        args.sessionState.outputTokens = usageData.outputTokens;
      }
    },
  };
}
