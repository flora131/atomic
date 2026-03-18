/**
 * Unified stream-part pipeline utilities.
 *
 * Provides a single event reducer for updating assistant messages from
 * streaming events (text, thinking metadata, tools, HITL, and agents).
 */

import type { ChatMessage } from "@/types/chat.ts";
import { handleTextDelta } from "@/state/parts/handlers.ts";
import type { AgentPart, TaskListPart, TextPart } from "@/state/parts/types.ts";
import {
  applyHitlResponse,
  applyToolPartialResultToParts,
  isSubagentToolName,
  toToolState,
  upsertHitlRequest,
  upsertToolPartComplete,
  upsertToolPartStart,
} from "@/state/streaming/pipeline-tools.ts";
import {
  carryReasoningPartRegistry,
  finalizeStreamingReasoningInMessage,
  finalizeStreamingReasoningParts,
  finalizeThinkingSource,
  upsertThinkingMeta,
  upsertThinkingMetaPart,
} from "@/state/streaming/pipeline-thinking.ts";
import {
  bufferAgentEvent,
  drainBufferedEvents,
  hasCompletedAgentInParts,
  mergeParallelAgentsIntoParts,
  normalizeParallelAgents,
  normalizeParallelAgentResult,
  routeToAgentInlineParts,
} from "@/state/streaming/pipeline-agents.ts";
import {
  normalizeTaskItemStatus,
  upsertTaskResultPart,
} from "@/state/streaming/pipeline-workflow.ts";
import type {
  StreamPartEvent,
  ThinkingCompleteEvent,
  ThinkingMetaEvent,
  ThinkingProvider,
} from "@/state/streaming/pipeline-types.ts";
import { createPartId } from "@/state/parts/id.ts";
import { upsertPart } from "@/state/parts/store.ts";

export type {
  StreamPartEvent,
  ThinkingCompleteEvent,
  ThinkingMetaEvent,
  ThinkingProvider,
} from "@/state/streaming/pipeline-types.ts";
export {
  finalizeStreamingReasoningInMessage,
  finalizeStreamingReasoningParts,
  finalizeStreamingTextParts,
} from "@/state/streaming/pipeline-thinking.ts";
export {
  isSubagentToolName,
  toToolState,
} from "@/state/streaming/pipeline-tools.ts";
export { mergeParallelAgentsIntoParts } from "@/state/streaming/pipeline-agents.ts";

export function applyStreamPartEvent(
  message: ChatMessage,
  event: StreamPartEvent,
): ChatMessage {
  switch (event.type) {
    case "text-delta": {
      if (event.agentId && message.parts) {
        const routed = routeToAgentInlineParts(
          message.parts,
          event.agentId,
          (inlineParts) => {
            const lastText =
              inlineParts.length > 0
                ? inlineParts[inlineParts.length - 1]
                : undefined;
            if (
              lastText &&
              lastText.type === "text" &&
              (lastText as TextPart).isStreaming
            ) {
              const updated = [...inlineParts];
              updated[updated.length - 1] = {
                ...(lastText as TextPart),
                content: (lastText as TextPart).content + event.delta,
              };
              return updated;
            }
            return [
              ...inlineParts,
              {
                id: createPartId(),
                type: "text",
                content: event.delta,
                isStreaming: true,
                createdAt: new Date().toISOString(),
              } as TextPart,
            ];
          },
        );
        if (routed) {
          return carryReasoningPartRegistry(message, {
            ...message,
            parts: routed,
          });
        }
        bufferAgentEvent(event.agentId, event);
        return message;
      }

      const withParts = handleTextDelta(message, event.delta);
      return carryReasoningPartRegistry(message, {
        ...withParts,
        content: message.content + event.delta,
      });
    }

    case "thinking-meta": {
      if (event.agentId) {
        const routed = message.parts
          ? routeToAgentInlineParts(
              message.parts,
              event.agentId,
              (inlineParts) => upsertThinkingMetaPart(inlineParts, event),
            )
          : null;
        if (routed) {
          return carryReasoningPartRegistry(message, {
            ...message,
            parts: routed,
          });
        }
        bufferAgentEvent(event.agentId, event);
        return message;
      }
      return upsertThinkingMeta(message, event);
    }

    case "thinking-complete":
      return finalizeThinkingSource(message, event.sourceKey, event.durationMs);

    case "tool-start": {
      if (event.agentId && message.parts) {
        const routed = routeToAgentInlineParts(
          message.parts,
          event.agentId,
          (inlineParts) => upsertToolPartStart(inlineParts, event),
        );
        if (routed) {
          return carryReasoningPartRegistry(message, {
            ...message,
            parts: routed,
          });
        }
        bufferAgentEvent(event.agentId, event);
        return message;
      }

      return carryReasoningPartRegistry(message, {
        ...message,
        parts: upsertToolPartStart(message.parts ?? [], event),
      });
    }

    case "tool-complete": {
      if (event.agentId && message.parts) {
        const routed = routeToAgentInlineParts(
          message.parts,
          event.agentId,
          (inlineParts) => upsertToolPartComplete(inlineParts, event),
        );
        if (routed) {
          return carryReasoningPartRegistry(message, {
            ...message,
            parts: routed,
          });
        }
        bufferAgentEvent(event.agentId, event);
        return message;
      }

      return carryReasoningPartRegistry(message, {
        ...message,
        parts: upsertToolPartComplete(message.parts ?? [], event),
      });
    }

    case "tool-partial-result": {
      if (event.agentId && message.parts) {
        const routed = routeToAgentInlineParts(
          message.parts,
          event.agentId,
          (inlineParts) => applyToolPartialResultToParts(inlineParts, event),
        );
        if (routed) {
          return carryReasoningPartRegistry(message, {
            ...message,
            parts: routed,
          });
        }
        bufferAgentEvent(event.agentId, event);
        return message;
      }

      return carryReasoningPartRegistry(message, {
        ...message,
        parts: applyToolPartialResultToParts(message.parts ?? [], event),
      });
    }

    case "tool-hitl-request":
      return carryReasoningPartRegistry(message, {
        ...message,
        parts: upsertHitlRequest(message.parts ?? [], event),
      });

    case "tool-hitl-response":
      return carryReasoningPartRegistry(message, applyHitlResponse(message, event));

    case "text-complete":
      return message;

    case "parallel-agents": {
      const normalizedAgents = normalizeParallelAgents(event.agents);
      let nextParts = mergeParallelAgentsIntoParts(
        message.parts ?? [],
        normalizedAgents,
        message.timestamp,
      );
      for (const agent of normalizedAgents) {
        nextParts = drainBufferedEvents(nextParts, agent);
      }
      return carryReasoningPartRegistry(message, {
        ...message,
        parallelAgents: normalizedAgents,
        parts: nextParts,
      });
    }

    case "agent-terminal": {
      if (
        event.status === "completed" &&
        hasCompletedAgentInParts(message.parts, event.agentId)
      ) {
        return message;
      }

      const existingAgents = message.parallelAgents ?? [];
      if (existingAgents.length === 0) {
        return message;
      }

      const completedAtMs = event.completedAt
        ? new Date(event.completedAt).getTime()
        : Date.now();
      const normalizedResult =
        typeof event.result === "string"
          ? normalizeParallelAgentResult(event.result)
          : undefined;

      let changed = false;
      const nextAgents = existingAgents.map((agent) => {
        if (agent.id !== event.agentId) {
          return agent;
        }
        if (
          agent.status === event.status &&
          (agent.status === "completed" || agent.status === "error")
        ) {
          return agent;
        }

        const startedAtMs = new Date(agent.startedAt).getTime();
        const nextDurationMs =
          Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
            ? Math.max(0, completedAtMs - startedAtMs)
            : agent.durationMs;
        const nextResult = normalizedResult ?? agent.result;
        const nextError =
          event.status === "completed"
            ? undefined
            : (event.error ?? agent.error);
        const hasChange =
          agent.status !== event.status ||
          agent.currentTool !== undefined ||
          nextResult !== agent.result ||
          nextError !== agent.error ||
          nextDurationMs !== agent.durationMs;

        if (!hasChange) {
          return agent;
        }

        changed = true;
        return {
          ...agent,
          status: event.status,
          currentTool: undefined,
          ...(nextResult !== undefined ? { result: nextResult } : {}),
          ...(event.status === "completed"
            ? { error: undefined }
            : { error: nextError }),
          durationMs: nextDurationMs,
        };
      });

      if (!changed) {
        return message;
      }

      const normalizedAgents = normalizeParallelAgents(nextAgents);
      return carryReasoningPartRegistry(message, {
        ...message,
        parallelAgents: normalizedAgents,
        parts: mergeParallelAgentsIntoParts(
          message.parts ?? [],
          normalizedAgents,
          message.timestamp,
        ),
      });
    }

    case "task-list-update": {
      const parts = message.parts ?? [];
      const taskItems = event.tasks.map((task) => ({
        id: task.id,
        description: task.title,
        status: normalizeTaskItemStatus(task.status),
        blockedBy: task.blockedBy,
      }));
      const existing = parts.find(
        (part): part is TaskListPart => part.type === "task-list",
      );
      const updatedPart: TaskListPart = existing
        ? { ...existing, items: taskItems }
        : {
            id: createPartId(),
            type: "task-list",
            items: taskItems,
            expanded: false,
            createdAt: new Date().toISOString(),
          };
      return carryReasoningPartRegistry(message, {
        ...message,
        parts: upsertPart(parts, updatedPart),
      });
    }

    case "task-result-upsert":
      return carryReasoningPartRegistry(message, {
        ...message,
        parts: upsertTaskResultPart(message.parts ?? [], event),
      });
  }
}
