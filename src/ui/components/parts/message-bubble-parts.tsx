/**
 * MessageBubbleParts Component
 *
 * Renders a ChatMessage using the parts-based rendering system.
 * Each part is dispatched to its corresponding renderer via PART_REGISTRY.
 */

import React from "react";
import type { ChatMessage } from "../../chat.tsx";
import { PART_REGISTRY } from "./registry.tsx";
import { SPACING } from "../../constants/spacing.ts";

export interface MessageBubblePartsProps {
  message: ChatMessage;
}

/**
 * Renders a message from its parts array using the PART_REGISTRY.
 * Returns null if the message has no parts.
 */
export function MessageBubbleParts({ message }: MessageBubblePartsProps): React.ReactNode {
  const parts = message.parts ?? [];

  if (parts.length === 0) {
    return null;
  }

  return (
    <box flexDirection="column">
      {parts.map((part, index) => {
        const Renderer = PART_REGISTRY[part.type];
        if (!Renderer) return null;
        // Add spacing between consecutive parts of different types
        const prevPart = index > 0 ? parts[index - 1] : undefined;
        const needsSpacing = prevPart != null && prevPart.type !== part.type;
        return (
          <box key={part.id} marginTop={needsSpacing ? SPACING.ELEMENT : SPACING.NONE}>
            <Renderer
              part={part}
              isLast={index === parts.length - 1}
            />
          </box>
        );
      })}
    </box>
  );
}
