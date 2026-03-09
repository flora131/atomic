import { describe, expect, test } from "bun:test";
import { applyStreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import { createAssistantMessage, registerStreamPipelineHooks } from "./stream-pipeline.fixtures.ts";

registerStreamPipelineHooks();

describe("applyStreamPartEvent - tools and HITL", () => {
  test("handles tool start by finalizing active text", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Before tool" });

    const next = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_1",
      toolName: "Read",
      input: { filePath: "README.md" },
    });

    expect(next.toolCalls).toHaveLength(1);
    expect(next.toolCalls?.[0]?.status).toBe("running");
    expect(next.parts?.map((part) => part.type)).toEqual(["text", "tool"]);
    expect(next.parts?.[0] && "isStreaming" in next.parts[0] ? next.parts[0].isStreaming : false).toBe(false);
  });

  test("handles tool completion and updates both representations", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_1",
      toolName: "Read",
      input: { filePath: "README.md" },
    });

    const next = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "tool_1",
      output: "ok",
      success: true,
    });

    expect(next.toolCalls?.[0]?.status).toBe("completed");
    const toolPart = next.parts?.find((part) => part.type === "tool");
    expect(toolPart?.type).toBe("tool");
    if (toolPart?.type === "tool") {
      expect(toolPart.state.status).toBe("completed");
    }
  });

  test("handles invalid running startedAt when completing a tool", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_1",
      toolName: "Read",
      input: { filePath: "README.md" },
    });

    msg = {
      ...msg,
      parts: (msg.parts ?? []).map((part) => {
        if (part.type !== "tool" || part.toolCallId !== "tool_1" || part.state.status !== "running") {
          return part;
        }
        return {
          ...part,
          state: {
            ...part.state,
            startedAt: "invalid-date",
          },
        };
      }),
    };

    const next = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "tool_1",
      output: "ok",
      success: true,
    });

    const toolPart = next.parts?.find((part) => part.type === "tool");
    expect(toolPart?.type).toBe("tool");
    if (toolPart?.type === "tool" && toolPart.state.status === "completed") {
      expect(toolPart.state.durationMs).toBe(0);
    }
  });

  test("accumulates partial output on running tool part", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_1",
      toolName: "bash",
      input: { command: "ls -la" },
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-partial-result",
      toolId: "tool_1",
      partialOutput: "file1.txt\n",
    });

    const toolPart1 = msg.parts?.find((part) => part.type === "tool" && part.toolCallId === "tool_1");
    expect(toolPart1?.type).toBe("tool");
    if (toolPart1?.type === "tool") {
      expect(toolPart1.partialOutput).toBe("file1.txt\n");
      expect(toolPart1.state.status).toBe("running");
    }

    msg = applyStreamPartEvent(msg, {
      type: "tool-partial-result",
      toolId: "tool_1",
      partialOutput: "file2.txt\n",
    });

    const toolPart2 = msg.parts?.find((part) => part.type === "tool" && part.toolCallId === "tool_1");
    if (toolPart2?.type === "tool") {
      expect(toolPart2.partialOutput).toBe("file1.txt\nfile2.txt\n");
    }
  });

  test("ignores partial result for unknown tool id", () => {
    const msg = createAssistantMessage();
    const next = applyStreamPartEvent(msg, {
      type: "tool-partial-result",
      toolId: "nonexistent",
      partialOutput: "output",
    });
    expect(next.parts).toHaveLength(0);
  });

  test("keeps thinking, pre-tool text, and post-tool text segmented for visible tools", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 640,
      thinkingText: "break problem into steps",
      includeReasoningPart: true,
    });
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Draft answer" });

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_1",
      toolName: "Read",
      input: { filePath: "README.md" },
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "tool_1",
      output: "ok",
      success: true,
    });

    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: " after tool" });

    expect(next.content).toBe("Draft answer after tool");
    expect(next.parts?.map((part) => part.type)).toEqual(["reasoning", "text", "tool", "text"]);

    const firstText = next.parts?.[1];
    expect(firstText?.type).toBe("text");
    if (firstText?.type === "text") {
      expect(firstText.content).toBe("Draft answer");
      expect(firstText.isStreaming).toBe(false);
    }

    const secondText = next.parts?.[3];
    expect(secondText?.type).toBe("text");
    if (secondText?.type === "text") {
      expect(secondText.content).toBe(" after tool");
      expect(secondText.isStreaming).toBe(true);
    }
  });

  test("splits text blocks when TodoWrite interleaves mid-stream", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Draft answer" });

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_todo_1",
      toolName: "TodoWrite",
      input: { todos: [] },
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "tool_todo_1",
      toolName: "TodoWrite",
      output: { ok: true },
      success: true,
    });

    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: " after todo" });

    expect(next.content).toBe("Draft answer after todo");
    expect(next.parts?.map((part) => part.type)).toEqual(["text", "tool", "text"]);

    const firstText = next.parts?.[0];
    expect(firstText?.type).toBe("text");
    if (firstText?.type === "text") {
      expect(firstText.content).toBe("Draft answer");
      expect(firstText.isStreaming).toBe(false);
    }

    const secondText = next.parts?.[2];
    expect(secondText?.type).toBe("text");
    if (secondText?.type === "text") {
      expect(secondText.content).toBe(" after todo");
      expect(secondText.isStreaming).toBe(true);
    }
  });

  test("keeps sentence punctuation separated across TodoWrite boundaries", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "Now I have full context of the codebase. Let me set up the research plan and spawn parallel agents.",
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_todo_2",
      toolName: "TodoWrite",
      input: { todos: [{ content: "Spawn research agents", status: "in_progress" }] },
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "tool_todo_2",
      toolName: "TodoWrite",
      output: { ok: true },
      success: true,
    });

    const next = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "Now let me spawn parallel research agents.",
    });

    expect(next.content).toBe(
      "Now I have full context of the codebase. Let me set up the research plan and spawn parallel agents.Now let me spawn parallel research agents.",
    );
    expect(next.parts?.map((part) => part.type)).toEqual(["text", "tool", "text"]);

    const preToolText = next.parts?.[0];
    expect(preToolText?.type).toBe("text");
    if (preToolText?.type === "text") {
      expect(preToolText.content).toBe(
        "Now I have full context of the codebase. Let me set up the research plan and spawn parallel agents.",
      );
      expect(preToolText.isStreaming).toBe(false);
    }

    const postToolText = next.parts?.[2];
    expect(postToolText?.type).toBe("text");
    if (postToolText?.type === "text") {
      expect(postToolText.content).toBe("Now let me spawn parallel research agents.");
      expect(postToolText.isStreaming).toBe(true);
    }
  });

  test("starts a separate block for TaskOutput tools", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Waiting..." });

    const next = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_output_1",
      toolName: "TaskOutput",
      input: { task_id: "agent-1", block: true },
    });

    expect(next.parts?.map((part) => part.type)).toEqual(["text", "tool"]);
    const textPart = next.parts?.[0];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Waiting...");
      expect(textPart.isStreaming).toBe(false);
    }
    const toolPart = next.parts?.[1];
    expect(toolPart?.type).toBe("tool");
    if (toolPart?.type === "tool") {
      expect(toolPart.toolName).toBe("TaskOutput");
    }
  });

  test("stores HITL request and response on matching tool part", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_hitl",
      toolName: "AskUserQuestion",
      input: { question: "Continue?" },
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-hitl-request",
      toolId: "tool_hitl",
      request: {
        requestId: "req_1",
        header: "Question",
        question: "Continue?",
        options: [{ label: "Yes", value: "yes" }],
        multiSelect: false,
        respond: () => {},
      },
    });

    const afterResponse = applyStreamPartEvent(msg, {
      type: "tool-hitl-response",
      toolId: "tool_hitl",
      response: {
        cancelled: false,
        responseMode: "option",
        answerText: "yes",
        displayText: "Yes",
      },
    });

    const toolPart = afterResponse.parts?.find((part) => part.type === "tool");
    expect(toolPart?.type).toBe("tool");
    if (toolPart?.type === "tool") {
      expect(toolPart.pendingQuestion).toBeUndefined();
      expect(toolPart.hitlResponse?.answerText).toBe("yes");
    }
  });
});
