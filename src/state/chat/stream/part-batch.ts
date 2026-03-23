import type { SetStateAction } from "react";
import { applyStreamPartEvent } from "@/state/parts/index.ts";
import type { StreamPartEvent } from "@/state/parts/index.ts";
import type { ChatMessage } from "@/state/chat/shared/types/index.ts";
import type { WorkflowStepPart } from "@/state/parts/types.ts";
import type { WorkflowStepCompleteEvent } from "@/state/streaming/pipeline-types.ts";

export interface StreamPartBatch {
  queueMessagePartUpdate: (messageId: string, update: StreamPartEvent) => void;
  updatesByMessageId: Map<string, StreamPartEvent[]>;
}

export function createStreamPartBatch(): StreamPartBatch {
  const updatesByMessageId = new Map<string, StreamPartEvent[]>();

  const queueMessagePartUpdate = (messageId: string, update: StreamPartEvent): void => {
    const queued = updatesByMessageId.get(messageId);
    if (queued) {
      queued.push(update);
      return;
    }
    updatesByMessageId.set(messageId, [update]);
  };

  return { queueMessagePartUpdate, updatesByMessageId };
}

export function applyStreamPartBatchToMessages(
  updatesByMessageId: Map<string, StreamPartEvent[]>,
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void,
): void {
  if (updatesByMessageId.size === 0) {
    return;
  }

  setMessagesWindowed((prev) =>
    prev.map((message) => {
      const updates = updatesByMessageId.get(message.id);
      if (!updates || updates.length === 0) {
        return message;
      }

      let nextMessage = message;
      for (const update of updates) {
        nextMessage = applyStreamPartEvent(nextMessage, update);
      }
      return nextMessage;
    }),
  );
}

/**
 * Apply a workflow-step-complete event by scanning ALL messages for the one
 * that contains a matching WorkflowStepPart (by nodeId + workflowId).
 *
 * This bypasses the normal message-ID-based routing because batched event
 * dispatching can cause `streamingMessageIdRef` to point to the NEXT stage's
 * message by the time the complete event is processed — leaving the previous
 * stage's WorkflowStepPart stuck at "running".
 */
export function applyWorkflowStepCompleteByNodeScan(
  event: WorkflowStepCompleteEvent,
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void,
): void {
  setMessagesWindowed((prev) =>
    prev.map((message) => {
      const hasMatchingPart = (message.parts ?? []).some(
        (p) =>
          p.type === "workflow-step" &&
          (p as WorkflowStepPart).nodeId === event.nodeId &&
          (p as WorkflowStepPart).workflowId === event.workflowId,
      );
      if (!hasMatchingPart) return message;
      return applyStreamPartEvent(message, event);
    }),
  );
}
