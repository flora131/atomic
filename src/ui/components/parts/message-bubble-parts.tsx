/**
 * MessageBubbleParts Component
 *
 * Renders a ChatMessage using the parts-based rendering system.
 * Each part is dispatched to its corresponding renderer via PART_REGISTRY.
 */

import React from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { ChatMessage } from "../../chat.tsx";
import type { Part } from "../../parts/types.ts";
import { PART_REGISTRY } from "./registry.tsx";
import { SPACING } from "../../constants/spacing.ts";

export interface MessageBubblePartsProps {
  message: ChatMessage;
  syntaxStyle?: SyntaxStyle;
}

function getReasoningSourceKey(part: Part): string {
  if (part.type !== "reasoning") {
    return "";
  }

  const sourceKey = part.thinkingSourceKey;
  if (typeof sourceKey !== "string") {
    return "";
  }

  return sourceKey.trim();
}

function getPartRenderKeyBase(part: Part): string {
  const sourceKey = getReasoningSourceKey(part);
  if (sourceKey.length > 0) {
    return `reasoning-source:${sourceKey}`;
  }

  return part.id;
}

export function buildPartRenderKeys(parts: ReadonlyArray<Part>): string[] {
  const seen = new Map<string, number>();

  return parts.map((part) => {
    const baseKey = getPartRenderKeyBase(part);
    const existingCount = seen.get(baseKey) ?? 0;
    seen.set(baseKey, existingCount + 1);

    if (existingCount === 0) {
      return baseKey;
    }

    return `${baseKey}#${existingCount}`;
  });
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
  const renderKeys = buildPartRenderKeys(parts);

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
            key={renderKeys[index] ?? part.id}
            part={part}
            isLast={index === parts.length - 1}
            syntaxStyle={syntaxStyle}
          />
        );
      })}
    </box>
  );
}
