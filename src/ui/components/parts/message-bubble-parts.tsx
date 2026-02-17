/**
 * MessageBubbleParts Component
 *
 * Renders a ChatMessage using the parts-based rendering system.
 * Each part is dispatched to its corresponding renderer via PART_REGISTRY.
 */

import React from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { ChatMessage } from "../../chat.tsx";
import { PART_REGISTRY } from "./registry.tsx";
import { SPACING } from "../../constants/spacing.ts";

export interface MessageBubblePartsProps {
  message: ChatMessage;
  syntaxStyle?: SyntaxStyle;
}

/**
 * Renders a message from its parts array using the PART_REGISTRY.
 * Returns null if the message has no parts.
 *
 * Spacing principle: the parent container owns all inter-part spacing
 * via `gap`. Child part components must NOT add their own marginBottom
 * to avoid double-spacing. Parts that need extra section-level
 * separation can add marginTop internally.
 */
export function MessageBubbleParts({ message, syntaxStyle }: MessageBubblePartsProps): React.ReactNode {
  const parts = message.parts ?? [];

  if (parts.length === 0) {
    return null;
  }

  return (
    <box flexDirection="column" gap={SPACING.ELEMENT}>
      {parts.map((part, index) => {
        const Renderer = PART_REGISTRY[part.type];
        if (!Renderer) return null;
        return (
          <Renderer
            key={part.id}
            part={part}
            isLast={index === parts.length - 1}
            syntaxStyle={syntaxStyle}
          />
        );
      })}
    </box>
  );
}
