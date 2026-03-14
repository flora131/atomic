import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import { correlate } from "@/services/events/adapters/shared/adapter-correlation.ts";
import { buildCopilotCorrelationContext } from "@/services/events/adapters/providers/copilot/support.ts";
import type { CopilotStreamAdapterState } from "@/services/events/adapters/providers/copilot/types.ts";

const MAX_BUFFER_SIZE = 1000;

export function publishCopilotBufferedEvent(
  state: CopilotStreamAdapterState,
  bus: EventBus,
  event: BusEvent,
): void {
  state.eventBuffer.push(event);

  if (state.eventBuffer.length - state.eventBufferHead > MAX_BUFFER_SIZE) {
    const dropped = state.eventBuffer[state.eventBufferHead];
    state.eventBufferHead += 1;
    compactCopilotEventBuffer(state);
    console.warn(
      `[CopilotStreamAdapter] Buffer overflow: dropped event type=${dropped?.type}`,
    );
  }

  if (!state.isProcessing) {
    processCopilotEventBuffer(state, bus);
  }
}

function processCopilotEventBuffer(
  state: CopilotStreamAdapterState,
  bus: EventBus,
): void {
  state.isProcessing = true;

  while (state.eventBufferHead < state.eventBuffer.length) {
    const event = state.eventBuffer[state.eventBufferHead];
    state.eventBufferHead += 1;
    if (!event) {
      continue;
    }

    try {
      const enriched = correlate(
        event,
        buildCopilotCorrelationContext({
          activeSubagentToolsById: state.activeSubagentToolsById,
          toolCallIdToSubagentId: state.toolCallIdToSubagentId,
          syntheticForegroundAgent: state.syntheticForegroundAgent,
        }),
      );
      bus.publish(enriched);
    } catch (error) {
      console.error(
        `[CopilotStreamAdapter] Error publishing event type=${event.type}:`,
        error,
      );
    }
  }

  compactCopilotEventBuffer(state, true);
  state.isProcessing = false;
}

function compactCopilotEventBuffer(
  state: CopilotStreamAdapterState,
  force = false,
): void {
  if (state.eventBufferHead === 0) {
    return;
  }

  if (force || state.eventBufferHead >= state.eventBuffer.length) {
    state.eventBuffer.length = 0;
    state.eventBufferHead = 0;
    return;
  }

  if (
    state.eventBufferHead >= 128 &&
    state.eventBufferHead * 2 >= state.eventBuffer.length
  ) {
    state.eventBuffer = state.eventBuffer.slice(state.eventBufferHead);
    state.eventBufferHead = 0;
  }
}

export function cleanupCopilotOrphanedTools(
  state: CopilotStreamAdapterState,
  bus: EventBus,
): void {
  // Sub-agent task tools are managed by flushCopilotOrphanedAgentCompletions.
  // Aborting them here would produce null toolResult values in the UI.
  const subagentToolCallIds = new Set(state.toolCallIdToSubagentId.keys());

  for (const [toolId, toolName] of state.toolNameById.entries()) {
    if (subagentToolCallIds.has(toolId)) {
      continue;
    }
    const activeToolContext = state.activeSubagentToolsById.get(toolId);
    publishCopilotBufferedEvent(state, bus, {
      type: "stream.tool.complete",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        toolId,
        toolName,
        toolResult: null,
        success: false,
        error: "Tool execution aborted",
        ...(activeToolContext?.parentAgentId
          ? { parentAgentId: activeToolContext.parentAgentId }
          : {}),
      },
    });
  }

  // Preserve toolNameById entries for sub-agent task tools so
  // flushCopilotOrphanedAgentCompletions can emit proper tool completions.
  for (const toolId of state.toolNameById.keys()) {
    if (!subagentToolCallIds.has(toolId)) {
      state.toolNameById.delete(toolId);
      state.activeSubagentToolsById.delete(toolId);
    }
  }
}

/**
 * Synthesize `stream.agent.complete` events for background agents whose
 * `subagent.complete` event was never received from the Copilot SDK.
 *
 * The SDK does not reliably emit `subagent.complete` after the main stream
 * iterator is exhausted. Without this flush, tracked background agents remain
 * permanently "running" in the UI — the footer count never decrements and the
 * spinner never stops.
 *
 * Call this in the `finally` block of `startCopilotStreaming`, after
 * `cleanupCopilotOrphanedTools`.
 */
export function flushCopilotOrphanedAgentCompletions(
  state: CopilotStreamAdapterState,
  bus: EventBus,
): void {
  if (!state.subagentTracker) {
    // No tracker — clean up any remaining tool entries that
    // cleanupCopilotOrphanedTools preserved for us.
    for (const toolCallId of state.toolCallIdToSubagentId.keys()) {
      state.toolNameById.delete(toolCallId);
    }
    state.toolCallIdToSubagentId.clear();
    return;
  }

  for (const [toolCallId, agentId] of state.toolCallIdToSubagentId) {
    if (!state.subagentTracker.hasAgent(agentId)) {
      state.toolNameById.delete(toolCallId);
      continue;
    }

    // Emit the tool completion that cleanupCopilotOrphanedTools skipped.
    const toolName = state.toolNameById.get(toolCallId);
    if (toolName) {
      const activeToolContext = state.activeSubagentToolsById.get(toolCallId);
      publishCopilotBufferedEvent(state, bus, {
        type: "stream.tool.complete",
        sessionId: state.sessionId,
        runId: state.runId,
        timestamp: Date.now(),
        data: {
          toolId: toolCallId,
          toolName,
          toolResult: null,
          success: true,
          sdkCorrelationId: toolCallId,
          ...(activeToolContext?.parentAgentId
            ? { parentAgentId: activeToolContext.parentAgentId }
            : {}),
        },
      });
      state.toolNameById.delete(toolCallId);
    }

    state.activeSubagentToolsById.delete(toolCallId);
    state.subagentTracker.removeAgent(agentId);
    publishCopilotBufferedEvent(state, bus, {
      type: "stream.agent.complete",
      sessionId: state.sessionId,
      runId: state.runId,
      timestamp: Date.now(),
      data: {
        agentId,
        success: true,
      },
    });
  }

  state.toolCallIdToSubagentId.clear();
}
