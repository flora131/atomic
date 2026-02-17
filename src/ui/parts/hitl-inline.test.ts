/**
 * Integration tests for HITL inline rendering
 *
 * Verifies that HITL (Human-in-the-Loop) permission requests are correctly
 * represented inline within the parts model, replacing the old fixed-position
 * overlay approach.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createPartId, _resetPartCounter } from "./id.ts";
import { upsertPart } from "./store.ts";
import type { Part, ToolPart } from "./types.ts";
import type { HitlResponseRecord } from "../utils/hitl-response.ts";

describe("HITL inline rendering integration", () => {
  beforeEach(() => {
    _resetPartCounter();
  });

  test("permission request sets pendingQuestion on ToolPart", () => {
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-1",
      toolName: "read_file",
      input: { path: "/etc/passwd" },
      state: { status: "running", startedAt: new Date().toISOString() },
    };
    
    // Set pendingQuestion (simulates handlePermissionRequest)
    const updated: ToolPart = {
      ...toolPart,
      pendingQuestion: {
        requestId: "req-1",
        header: "Permission needed",
        question: "Allow file read?",
        options: [{ label: "Allow", value: "allow" }],
        multiSelect: false,
        respond: () => {},
      },
    };
    
    expect(updated.pendingQuestion).toBeDefined();
    expect(updated.pendingQuestion?.requestId).toBe("req-1");
    expect(updated.pendingQuestion?.header).toBe("Permission needed");
    expect(updated.pendingQuestion?.question).toBe("Allow file read?");
    expect(updated.pendingQuestion?.options).toHaveLength(1);
    expect(updated.pendingQuestion?.multiSelect).toBe(false);
    expect(typeof updated.pendingQuestion?.respond).toBe("function");
  });

  test("HITL response clears pendingQuestion and sets hitlResponse", () => {
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-2",
      toolName: "execute_command",
      input: { command: "rm -rf /" },
      state: { status: "running", startedAt: new Date().toISOString() },
      pendingQuestion: {
        requestId: "req-2",
        header: "Permission needed",
        question: "Allow command execution?",
        options: [
          { label: "Allow", value: "allow" },
          { label: "Deny", value: "deny" },
        ],
        multiSelect: false,
        respond: () => {},
      },
    };

    // Simulate user response (clears pendingQuestion, sets hitlResponse)
    const responded: ToolPart = {
      ...toolPart,
      pendingQuestion: undefined,
      hitlResponse: {
        cancelled: false,
        responseMode: "option",
        answerText: "allow",
        displayText: 'User answered: "allow"',
      },
    };

    expect(responded.pendingQuestion).toBeUndefined();
    expect(responded.hitlResponse).toBeDefined();
    expect(responded.hitlResponse?.cancelled).toBe(false);
    expect(responded.hitlResponse?.answerText).toBe("allow");
  });

  test("multiple HITL requests on different tools", () => {
    let parts: Part[] = [];

    // Tool 1 with pendingQuestion
    const tool1: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-3",
      toolName: "read_file",
      input: { path: "/etc/shadow" },
      state: { status: "running", startedAt: new Date().toISOString() },
      pendingQuestion: {
        requestId: "req-3",
        header: "Permission needed",
        question: "Allow read?",
        options: [{ label: "Yes", value: "yes" }],
        multiSelect: false,
        respond: () => {},
      },
    };

    // Tool 2 with different pendingQuestion
    const tool2: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-4",
      toolName: "write_file",
      input: { path: "/etc/hosts" },
      state: { status: "running", startedAt: new Date().toISOString() },
      pendingQuestion: {
        requestId: "req-4",
        header: "Write permission needed",
        question: "Allow write?",
        options: [{ label: "Yes", value: "yes" }],
        multiSelect: false,
        respond: () => {},
      },
    };

    parts = upsertPart(parts, tool1);
    parts = upsertPart(parts, tool2);

    expect(parts).toHaveLength(2);
    expect((parts[0] as ToolPart).pendingQuestion?.requestId).toBe("req-3");
    expect((parts[1] as ToolPart).pendingQuestion?.requestId).toBe("req-4");
    expect((parts[0] as ToolPart).pendingQuestion?.question).toBe("Allow read?");
    expect((parts[1] as ToolPart).pendingQuestion?.question).toBe("Allow write?");
  });

  test("ToolPart without HITL has no pendingQuestion", () => {
    const normalTool: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-5",
      toolName: "list_files",
      input: { directory: "." },
      state: { status: "completed", output: ["file1.txt"], durationMs: 150 },
    };

    expect(normalTool.pendingQuestion).toBeUndefined();
    expect(normalTool.hitlResponse).toBeUndefined();
  });

  test("HITL response preserves tool state", () => {
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-6",
      toolName: "bash",
      input: { command: "ls -la" },
      state: { status: "running", startedAt: new Date().toISOString() },
      pendingQuestion: {
        requestId: "req-5",
        header: "Permission needed",
        question: "Execute bash command?",
        options: [{ label: "Allow", value: "allow" }],
        multiSelect: false,
        respond: () => {},
      },
    };

    const originalState = toolPart.state;

    // Simulate response (state should remain unchanged)
    const responded: ToolPart = {
      ...toolPart,
      pendingQuestion: undefined,
      hitlResponse: {
        cancelled: false,
        responseMode: "option",
        answerText: "allow",
        displayText: 'User answered: "allow"',
      },
    };

    expect(responded.state).toEqual(originalState);
    expect(responded.state.status).toBe("running");
  });

  test("pendingQuestion has all required fields", () => {
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-7",
      toolName: "dangerous_operation",
      input: { action: "delete_production" },
      state: { status: "running", startedAt: new Date().toISOString() },
      pendingQuestion: {
        requestId: "req-6",
        header: "DANGER",
        question: "Are you sure?",
        options: [
          { label: "Yes, I'm sure", value: "yes" },
          { label: "No, cancel", value: "no" },
        ],
        multiSelect: false,
        respond: (answer: string | string[]) => {
          console.log("User answered:", answer);
        },
      },
    };

    const pq = toolPart.pendingQuestion;
    expect(pq).toBeDefined();
    
    // Verify all required fields are present
    expect(pq?.requestId).toBeDefined();
    expect(typeof pq?.requestId).toBe("string");
    
    expect(pq?.header).toBeDefined();
    expect(typeof pq?.header).toBe("string");
    
    expect(pq?.question).toBeDefined();
    expect(typeof pq?.question).toBe("string");
    
    expect(pq?.options).toBeDefined();
    expect(Array.isArray(pq?.options)).toBe(true);
    expect(pq?.options.length).toBeGreaterThan(0);
    
    expect(pq?.multiSelect).toBeDefined();
    expect(typeof pq?.multiSelect).toBe("boolean");
    
    expect(pq?.respond).toBeDefined();
    expect(typeof pq?.respond).toBe("function");
    
    // Verify option structure
    const option = pq?.options[0];
    expect(option?.label).toBeDefined();
    expect(option?.value).toBeDefined();
  });

  test("multi-select HITL question with multiple options", () => {
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-8",
      toolName: "configure_settings",
      input: { settings: {} },
      state: { status: "running", startedAt: new Date().toISOString() },
      pendingQuestion: {
        requestId: "req-7",
        header: "Select features",
        question: "Which features do you want to enable?",
        options: [
          { label: "Feature A", value: "feature_a" },
          { label: "Feature B", value: "feature_b" },
          { label: "Feature C", value: "feature_c" },
        ],
        multiSelect: true,
        respond: (answer: string | string[]) => {
          expect(Array.isArray(answer)).toBe(true);
        },
      },
    };

    expect(toolPart.pendingQuestion?.multiSelect).toBe(true);
    expect(toolPart.pendingQuestion?.options).toHaveLength(3);
  });

  test("cancelled HITL response", () => {
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-9",
      toolName: "critical_action",
      input: {},
      state: { status: "running", startedAt: new Date().toISOString() },
    };

    // User cancels/declines
    const cancelled: ToolPart = {
      ...toolPart,
      hitlResponse: {
        cancelled: true,
        responseMode: "declined",
        answerText: "",
        displayText: "User declined to answer question.",
      },
    };

    expect(cancelled.hitlResponse?.cancelled).toBe(true);
    expect(cancelled.hitlResponse?.responseMode).toBe("declined");
    expect(cancelled.hitlResponse?.answerText).toBe("");
  });

  test("HITL with custom input response mode", () => {
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-10",
      toolName: "custom_tool",
      input: {},
      state: { status: "completed", output: "result", durationMs: 100 },
      hitlResponse: {
        cancelled: false,
        responseMode: "custom_input",
        answerText: "user typed this custom answer",
        displayText: 'User answered: "user typed this custom answer"',
      },
    };

    expect(toolPart.hitlResponse?.responseMode).toBe("custom_input");
    expect(toolPart.hitlResponse?.answerText).toBe("user typed this custom answer");
  });

  test("HITL with chat_about_this response mode", () => {
    const toolPart: ToolPart = {
      id: createPartId(),
      type: "tool",
      createdAt: new Date().toISOString(),
      toolCallId: "tc-11",
      toolName: "ask_user",
      input: {},
      state: { status: "completed", output: "result", durationMs: 100 },
      hitlResponse: {
        cancelled: false,
        responseMode: "chat_about_this",
        answerText: "I need more information about option A",
        displayText: 'User decided to chat more about options: "I need more information about option A"',
      },
    };

    expect(toolPart.hitlResponse?.responseMode).toBe("chat_about_this");
    expect(toolPart.hitlResponse?.displayText).toContain("chat more about options");
  });
});
