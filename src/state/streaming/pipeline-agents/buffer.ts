import type { ParallelAgent } from "@/types/parallel-agents.ts";
import { createPartId } from "@/state/parts/id.ts";
import type { Part, TextPart } from "@/state/parts/types.ts";
import { upsertThinkingMetaPart } from "@/state/streaming/pipeline-thinking.ts";
import { applyToolPartialResultToParts, upsertToolPartComplete, upsertToolPartStart } from "@/state/streaming/pipeline-tools/tool-parts.ts";
import type { StreamPartEvent } from "@/state/streaming/pipeline-types.ts";
import { routeToAgentInlineParts } from "@/state/streaming/pipeline-agents/inline-parts.ts";

const agentEventBuffer = new Map<string, StreamPartEvent[]>();

/**
 * Clear all buffered agent events. Must be called at stream boundaries
 * (start and end) to prevent cross-stream event leakage.
 */
export function clearAgentEventBuffer(): void {
  agentEventBuffer.clear();
}

function cloneBufferedEventForAgent(
  event: StreamPartEvent,
  agentId: string,
): StreamPartEvent {
  if (!("agentId" in event)) {
    return event;
  }
  return { ...event, agentId };
}

function resolveBufferedAgentKeys(agent: ParallelAgent): string[] {
  const keys = new Set<string>([agent.id]);
  if (agent.taskToolCallId) {
    keys.add(agent.taskToolCallId);
  }
  return [...keys];
}

export function bufferAgentEvent(
  agentId: string,
  event: StreamPartEvent,
): void {
  const existing = agentEventBuffer.get(agentId) ?? [];
  existing.push(event);
  agentEventBuffer.set(agentId, existing);
}

export function drainBufferedEvents(
  parts: Part[],
  agent: ParallelAgent,
): Part[] {
  let currentParts = parts;

  for (const key of resolveBufferedAgentKeys(agent)) {
    const buffered = agentEventBuffer.get(key);
    if (!buffered || buffered.length === 0) {
      continue;
    }

    agentEventBuffer.delete(key);
    for (const bufferedEvent of buffered) {
      const event = cloneBufferedEventForAgent(bufferedEvent, agent.id);
      if (event.type === "text-delta" && event.agentId) {
        const routed = routeToAgentInlineParts(
          currentParts,
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
          currentParts = routed;
        }
      } else if (event.type === "tool-start" && event.agentId) {
        const routed = routeToAgentInlineParts(
          currentParts,
          event.agentId,
          (inlineParts) => upsertToolPartStart(inlineParts, event),
        );
        if (routed) {
          currentParts = routed;
        }
      } else if (event.type === "tool-complete" && event.agentId) {
        const routed = routeToAgentInlineParts(
          currentParts,
          event.agentId,
          (inlineParts) => upsertToolPartComplete(inlineParts, event),
        );
        if (routed) {
          currentParts = routed;
        }
      } else if (event.type === "tool-partial-result" && event.agentId) {
        const routed = routeToAgentInlineParts(
          currentParts,
          event.agentId,
          (inlineParts) => applyToolPartialResultToParts(inlineParts, event),
        );
        if (routed) {
          currentParts = routed;
        }
      } else if (event.type === "thinking-meta" && event.agentId) {
        const routed = routeToAgentInlineParts(
          currentParts,
          event.agentId,
          (inlineParts) => upsertThinkingMetaPart(inlineParts, event),
        );
        if (routed) {
          currentParts = routed;
        }
      }
    }
  }

  return currentParts;
}
