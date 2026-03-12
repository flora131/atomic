import type {
  SDKAssistantMessage,
  McpServerStatus,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  McpAuthStatus,
  MessageCompleteEventData,
  MessageContentType,
} from "@/services/agents/types.ts";
import { stripProviderPrefix } from "@/services/agents/types.ts";

export function extractMessageContent(message: SDKAssistantMessage): {
  type: MessageContentType;
  content: string | unknown;
  thinkingSourceKey?: string;
} {
  const betaMessage = message.message;
  if (betaMessage.content.length === 0) {
    return { type: "text", content: "" };
  }

  let textContent: string | null = null;
  let thinkingContent: string | null = null;
  let thinkingSourceKey: string | undefined;

  for (let blockIndex = 0; blockIndex < betaMessage.content.length; blockIndex++) {
    const block = betaMessage.content[blockIndex]!;
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        content: {
          name: block.name,
          input: block.input,
          toolUseId: block.id,
        },
      };
    }
    if (block.type === "text" && textContent === null) {
      textContent = block.text;
    }
    if (block.type === "thinking" && thinkingContent === null) {
      thinkingContent = (block as { thinking: string }).thinking;
      thinkingSourceKey = String(blockIndex);
    }
  }

  if (textContent !== null) {
    return { type: "text", content: textContent };
  }

  if (thinkingContent !== null) {
    return {
      type: "thinking",
      content: thinkingContent,
      thinkingSourceKey,
    };
  }

  return { type: "text", content: "" };
}

function extractToolRequestsFromAssistantMessage(
  message: SDKAssistantMessage,
): MessageCompleteEventData["toolRequests"] {
  const toolRequests = message.message.content.flatMap(
    (block: SDKAssistantMessage["message"]["content"][number]) => {
      if (block.type !== "tool_use") {
        return [];
      }

      return [{
        toolCallId: block.id,
        name: block.name,
        arguments: block.input,
      }];
    },
  );

  return toolRequests.length > 0 ? toolRequests : undefined;
}

export function createMessageCompleteEventData(
  message: SDKAssistantMessage,
): MessageCompleteEventData {
  const { type, content } = extractMessageContent(message);
  const toolRequests = extractToolRequestsFromAssistantMessage(message);

  return {
    message: {
      type,
      content,
      role: "assistant",
    },
    ...(toolRequests ? { toolRequests } : {}),
    ...(typeof message.parent_tool_use_id === "string"
      ? { parentToolCallId: message.parent_tool_use_id }
      : {}),
  };
}

export function getClaudeContentBlockIndex(
  event: Record<string, unknown>,
): number | null {
  const directIndex = event.index;
  if (typeof directIndex === "number") {
    return directIndex;
  }

  const contentBlock = event.content_block;
  if (contentBlock && typeof contentBlock === "object") {
    const blockIndex = (contentBlock as Record<string, unknown>).index;
    if (typeof blockIndex === "number") {
      return blockIndex;
    }
  }

  return null;
}

export function mapAuthStatusFromMcpServerStatus(
  status: McpServerStatus["status"],
): McpAuthStatus | undefined {
  return status === "needs-auth" ? "Not logged in" : undefined;
}

export function normalizeClaudeModelLabel(model: string): string {
  const stripped = stripProviderPrefix(model);
  const lower = stripped.toLowerCase();

  if (
    lower === "default" ||
    lower === "opus" ||
    /(^|[-_])opus([-_]|$)/.test(lower)
  ) {
    return "opus";
  }

  if (lower === "sonnet" || /(^|[-_])sonnet([-_]|$)/.test(lower)) {
    return "sonnet";
  }

  if (lower === "haiku" || /(^|[-_])haiku([-_]|$)/.test(lower)) {
    return "haiku";
  }

  return stripped;
}
