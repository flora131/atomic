import type { AgentEvent, AgentMessage } from "@/services/agents/types.ts";
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
  handleToolStart: (event: AgentEvent<"tool.start">) => void;
  handleToolComplete: (event: AgentEvent<"tool.complete">) => void;
  handleIdle: (event: AgentEvent<"session.idle">) => void;
  handleError: (event: AgentEvent<"session.error">) => void;
  handleUsage: (event: AgentEvent<"usage">) => void;
} {
  const enqueueDelta = (messageChunk: AgentMessage): void => {
    args.controller.enqueueDelta(messageChunk);
  };

  const buildToolUseId = (toolData: Record<string, unknown>): string =>
    (toolData.toolUseId as string | undefined)
    ?? (toolData.toolUseID as string | undefined)
    ?? (toolData.toolCallId as string | undefined)
    ?? args.controller.buildSyntheticToolUseId();

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
            metadata: {
              provider: "opencode",
              thinkingSourceKey,
              streamingStats: {
                thinkingMs: 0,
                outputTokens: 0,
              },
            },
          }
          : {}),
      });
    },
    handleSubagentStart: (event) => {
      if (!args.isSubagentDispatch) return;
      if (!args.controller.isRelatedSession(event.sessionId)) return;
      args.controller.registerRelatedSession((event.data as Record<string, unknown>)?.subagentSessionId);
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
        metadata: {
          toolName,
          toolId: toolUseId,
        },
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
        metadata: {
          toolName,
          toolId: toolUseId,
          error: !success,
        },
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
