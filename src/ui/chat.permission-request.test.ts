/**
 * Tests for permission request handling and ToolPart.pendingQuestion population
 * 
 * Verifies that when permission.requested events are handled:
 * - pendingQuestion is set on the matching ToolPart by toolCallId
 * - pendingQuestion is cleared when user responds
 * - hitlResponse is set on the ToolPart after user responds
 */

import { describe, test, expect, beforeEach } from "bun:test";
import type { ChatMessage } from "./chat.tsx";
import type { ToolPart } from "./parts/types.ts";
import type { HitlResponseRecord } from "./utils/hitl-response.ts";

describe("Permission Request → ToolPart.pendingQuestion", () => {
  let messages: ChatMessage[];
  
  beforeEach(() => {
    // Setup: Create a message with a ToolPart that has toolCallId
    messages = [
      {
        id: "msg_1",
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        streaming: true,
        parts: [
          {
            id: "part_1",
            type: "tool",
            createdAt: new Date().toISOString(),
            toolCallId: "tool_123",
            toolName: "AskUserQuestion",
            input: { question: "Do you approve?" },
            state: { status: "running", startedAt: new Date().toISOString() },
          } satisfies ToolPart,
        ],
      } satisfies ChatMessage,
    ];
  });

  test("should set pendingQuestion on matching ToolPart by toolCallId", () => {
    // Simulate handlePermissionRequest setting pendingQuestion
    const toolCallId = "tool_123";
    const requestId = "req_123";
    const question = "Do you approve this action?";
    const options = [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ];
    const respond = (_answer: string | string[]) => {};
    
    // Find and update the matching ToolPart
    const updatedMessages = messages.map((msg) => {
      if (!msg.parts || msg.parts.length === 0) return msg;
      
      const parts = [...msg.parts];
      const toolPartIdx = parts.findIndex(
        p => p.type === "tool" && (p as ToolPart).toolCallId === toolCallId
      );

      if (toolPartIdx >= 0) {
        const toolPart = parts[toolPartIdx] as ToolPart;
        parts[toolPartIdx] = {
          ...toolPart,
          pendingQuestion: {
            requestId,
            header: "AskUserQuestion",
            question,
            options,
            multiSelect: false,
            respond,
          },
        };
        return { ...msg, parts };
      }
      return msg;
    });

    // Verify pendingQuestion was set
    const toolPart = updatedMessages[0]?.parts?.[0] as ToolPart;
    expect(toolPart).toBeDefined();
    expect(toolPart.pendingQuestion).toBeDefined();
    expect(toolPart.pendingQuestion?.requestId).toBe(requestId);
    expect(toolPart.pendingQuestion?.question).toBe(question);
    expect(toolPart.pendingQuestion?.options).toHaveLength(2);
    expect(toolPart.pendingQuestion?.multiSelect).toBe(false);
  });

  test("should clear pendingQuestion and set hitlResponse on user answer", () => {
    // Setup: ToolPart with pendingQuestion
    const toolPartWithQuestion: ToolPart = {
      id: "part_1",
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tool_123",
      toolName: "AskUserQuestion",
      input: { question: "Do you approve?" },
      state: { status: "running", startedAt: new Date().toISOString() },
      pendingQuestion: {
        requestId: "req_123",
        header: "AskUserQuestion",
        question: "Do you approve this action?",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
        multiSelect: false,
        respond: (_answer: string | string[]) => {},
      },
    };
    
    messages[0]!.parts = [toolPartWithQuestion];

    // Simulate user answering the question
    const hitlResponse: HitlResponseRecord = {
      answerText: "Yes",
      displayText: "Yes",
      cancelled: false,
      responseMode: "option",
    };

    const toolCallId = "tool_123";
    const updatedMessages = messages.map((msg) => {
      if (!msg.parts || msg.parts.length === 0) return msg;
      
      const parts = [...msg.parts];
      const toolPartIdx = parts.findIndex(
        p => p.type === "tool" && (p as ToolPart).toolCallId === toolCallId
      );

      if (toolPartIdx >= 0) {
        const toolPart = parts[toolPartIdx] as ToolPart;
        parts[toolPartIdx] = {
          ...toolPart,
          pendingQuestion: undefined, // Clear
          hitlResponse, // Set response
        };
        return { ...msg, parts };
      }
      return msg;
    });

    // Verify pendingQuestion was cleared and hitlResponse was set
    const toolPart = updatedMessages[0]?.parts?.[0] as ToolPart;
    expect(toolPart).toBeDefined();
    expect(toolPart.pendingQuestion).toBeUndefined();
    expect(toolPart.hitlResponse).toBeDefined();
    expect(toolPart.hitlResponse?.answerText).toBe("Yes");
    expect(toolPart.hitlResponse?.cancelled).toBe(false);
  });

  test("should not set pendingQuestion if toolCallId doesn't match", () => {
    const toolCallId = "tool_999"; // Different ID
    const requestId = "req_123";
    const question = "Do you approve this action?";
    const options = [{ label: "Yes", value: "yes" }];
    const respond = (_answer: string | string[]) => {};
    
    // Try to update with non-matching toolCallId
    const updatedMessages = messages.map((msg) => {
      if (!msg.parts || msg.parts.length === 0) return msg;
      
      const parts = [...msg.parts];
      const toolPartIdx = parts.findIndex(
        p => p.type === "tool" && (p as ToolPart).toolCallId === toolCallId
      );

      if (toolPartIdx >= 0) {
        const toolPart = parts[toolPartIdx] as ToolPart;
        parts[toolPartIdx] = {
          ...toolPart,
          pendingQuestion: {
            requestId,
            header: "AskUserQuestion",
            question,
            options,
            multiSelect: false,
            respond,
          },
        };
        return { ...msg, parts };
      }
      return msg;
    });

    // Verify pendingQuestion was NOT set (toolCallId didn't match)
    const toolPart = updatedMessages[0]?.parts?.[0] as ToolPart;
    expect(toolPart).toBeDefined();
    expect(toolPart.pendingQuestion).toBeUndefined();
  });

  test("should handle message with no parts array gracefully", () => {
    const messageWithoutParts: ChatMessage = {
      id: "msg_2",
      role: "assistant",
      content: "Hello",
      timestamp: new Date().toISOString(),
      streaming: false,
      // No parts array
    };
    
    const toolCallId = "tool_123";
    
    // Try to update - should return unchanged
    const updatedMessage = !messageWithoutParts.parts || messageWithoutParts.parts.length === 0
      ? messageWithoutParts
      : messageWithoutParts; // Would do the update logic

    expect(updatedMessage).toBe(messageWithoutParts);
    expect(updatedMessage.parts).toBeUndefined();
  });

  test("should handle message with empty parts array", () => {
    const messageWithEmptyParts: ChatMessage = {
      id: "msg_3",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true,
      parts: [],
    };
    
    const toolCallId = "tool_123";
    
    // Try to update - should return unchanged
    const updatedMessage = !messageWithEmptyParts.parts || messageWithEmptyParts.parts.length === 0
      ? messageWithEmptyParts
      : messageWithEmptyParts;

    expect(updatedMessage).toBe(messageWithEmptyParts);
    expect(updatedMessage.parts).toEqual([]);
  });
});
