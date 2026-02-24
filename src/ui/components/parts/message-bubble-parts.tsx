/**
 * MessageBubbleParts Component
 *
 * Renders a ChatMessage using the parts-based rendering system.
 * Each part is dispatched to its corresponding renderer via PART_REGISTRY.
 */

import React from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { ChatMessage } from "../../chat.tsx";
import type { Part, ToolPart, AgentPart } from "../../parts/types.ts";
import { PART_REGISTRY } from "./registry.tsx";
import { SPACING } from "../../constants/spacing.ts";

function isTaskToolName(name: string): boolean {
  return name === "Task" || name === "task";
}

/**
 * Build a set of Task-tool toolCallIds that are represented by an AgentPart.
 * These ToolParts should be hidden because the agent tree already displays
 * the same information (task description, status, tool uses, result).
 */
export function getConsumedTaskToolCallIds(parts: ReadonlyArray<Part>): Set<string> {
  const hasAgentPart = parts.some((p) => p.type === "agent");
  if (!hasAgentPart) return new Set();

  const agentTaskToolCallIds = new Set<string>();
  for (const part of parts) {
    if (part.type !== "agent") continue;
    for (const agent of (part as AgentPart).agents) {
      if (agent.taskToolCallId) {
        agentTaskToolCallIds.add(agent.taskToolCallId);
      }
    }
  }

  const consumed = new Set<string>();
  for (const part of parts) {
    if (part.type !== "tool") continue;
    const toolPart = part as ToolPart;
    if (isTaskToolName(toolPart.toolName) && agentTaskToolCallIds.has(toolPart.toolCallId)) {
      consumed.add(toolPart.toolCallId);
    }
  }
  return consumed;
}

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

  // Task tool ToolParts that are represented by an AgentPart tree should be
  // hidden to avoid redundant display (the tree already shows task
  // description, status, tool uses, and result).
  const consumedTaskIds = getConsumedTaskToolCallIds(parts);

  return (
    <box flexDirection="column" gap={SPACING.ELEMENT}>
      {parts.map((part, index) => {
        // Skip Task ToolParts consumed by the agent tree
        if (
          part.type === "tool" &&
          isTaskToolName((part as ToolPart).toolName) &&
          consumedTaskIds.has((part as ToolPart).toolCallId)
        ) {
          return null;
        }
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
