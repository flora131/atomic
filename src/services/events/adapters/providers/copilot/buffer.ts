import type { BusEvent } from "@/services/events/bus-events.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
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
      bus.publish(event);
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
  for (const [toolId, toolName] of state.toolNameById.entries()) {
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
      },
    });
  }

  state.toolNameById.clear();
  state.activeSubagentToolsById.clear();
}
