import { expect } from "bun:test";
import { handleTextDelta } from "@/state/parts/handlers.ts";
import { createPartId, _resetPartCounter } from "@/state/parts/id.ts";
import { findLastPartIndex, upsertPart } from "@/state/parts/store.ts";
import type {
  AgentPart,
  Part,
  ReasoningPart,
  TextPart,
  ToolPart,
} from "@/state/parts/types.ts";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import type { ChatMessage } from "@/screens/chat-screen.tsx";

export {
  handleTextDelta,
  upsertPart,
  type AgentPart,
  type ChatMessage,
  type ParallelAgent,
  type ReasoningPart,
  type TextPart,
  type ToolPart,
};

export function resetStreamOrderState(): void {
  _resetPartCounter();
}

export function createMockMessage(): ChatMessage {
  return {
    id: "test-msg",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parts: [],
    streaming: true,
  } as ChatMessage;
}

export function finalizeLastTextPart(msg: ChatMessage): ChatMessage {
  const parts = [...(msg.parts ?? [])];
  const lastTextIdx = findLastPartIndex(
    parts,
    (part) => part.type === "text" && (part as TextPart).isStreaming,
  );

  if (lastTextIdx >= 0) {
    parts[lastTextIdx] = {
      ...parts[lastTextIdx],
      isStreaming: false,
    } as TextPart;
  }

  return { ...msg, parts };
}

export function createTextPart(content: string, isStreaming = false): TextPart {
  return {
    id: createPartId(),
    type: "text",
    content,
    isStreaming,
    createdAt: new Date().toISOString(),
  };
}

export function createReasoningPart(
  content: string,
  isStreaming = false,
): ReasoningPart {
  return {
    id: createPartId(),
    type: "reasoning",
    content,
    durationMs: 100,
    isStreaming,
    createdAt: new Date().toISOString(),
  };
}

export function createToolPart(
  toolCallId: string,
  toolName: string,
  status: "pending" | "running" | "completed" = "running",
): ToolPart {
  return {
    id: createPartId(),
    type: "tool",
    toolCallId,
    toolName,
    input: { command: "test" },
    state:
      status === "completed"
        ? { status: "completed", output: "success", durationMs: 200 }
        : status === "running"
          ? { status: "running", startedAt: new Date().toISOString() }
          : { status: "pending" },
    createdAt: new Date().toISOString(),
  };
}

export function createAgentPart(
  agents: ParallelAgent[],
  parentToolPartId?: string,
): AgentPart {
  return {
    id: createPartId(),
    type: "agent",
    agents,
    parentToolPartId,
    createdAt: new Date().toISOString(),
  };
}

export function createMockAgent(
  id: string,
  name: string,
  background = false,
): ParallelAgent {
  return {
    id,
    name,
    task: "Test task",
    status: "running",
    background,
    startedAt: new Date().toISOString(),
  };
}

export function addHitlQuestion(toolPart: ToolPart, requestId: string): ToolPart {
  return {
    ...toolPart,
    pendingQuestion: {
      requestId,
      header: "Permission needed",
      question: "Allow this operation?",
      options: [
        { label: "Allow", value: "allow" },
        { label: "Deny", value: "deny" },
      ],
      multiSelect: false,
      respond: () => {},
    },
  };
}

export function resolveHitlQuestion(
  toolPart: ToolPart,
  answer: string,
): ToolPart {
  return {
    ...toolPart,
    pendingQuestion: undefined,
    hitlResponse: {
      cancelled: false,
      responseMode: "option",
      answerText: answer,
      displayText: `User answered: "${answer}"`,
    },
  };
}

export function verifyMonotonicIds(parts: Part[]): void {
  for (let index = 1; index < parts.length; index += 1) {
    expect(parts[index]!.id > parts[index - 1]!.id).toBe(true);
  }
}
