import type { SetStateAction } from "react";
import { applyStreamPartEvent } from "@/state/parts/index.ts";
import type { StreamPartEvent } from "@/state/parts/index.ts";
import type { ChatMessage } from "@/state/chat/shared/types/index.ts";

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
