import { beforeEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "../chat.tsx";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import { _resetPartCounter, createPartId } from "./id.ts";
import {
  applyStreamPartEvent,
  finalizeStreamingReasoningInMessage,
  finalizeStreamingReasoningParts,
} from "./stream-pipeline.ts";

function createAssistantMessage(): ChatMessage {
  return {
    id: "msg-test",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    streaming: true,
    parts: [],
    toolCalls: [],
  };
}

function findReasoningPartBySource(message: ChatMessage, sourceKey: string) {
  return (message.parts ?? []).find(
    (part) => part.type === "reasoning" && part.thinkingSourceKey === sourceKey,
  );
}

beforeEach(() => {
  _resetPartCounter();
});

describe("applyStreamPartEvent", () => {
  test("applies text delta to legacy content and parts", () => {
    const msg = createAssistantMessage();
    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: "Hello" });

    expect(next.content).toBe("Hello");
    expect(next.parts).toHaveLength(1);
    expect(next.parts?.[0]?.type).toBe("text");
  });

  test("updates thinking metadata without creating reasoning parts by default", () => {
    const msg = createAssistantMessage();
    const next = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 1200,
      thinkingText: "analyzing",
    });

    expect(next.thinkingMs).toBe(1200);
    expect(next.thinkingText).toBe("analyzing");
    expect(next.parts).toHaveLength(0);
  });

  test("streams thinking as a dedicated reasoning part when enabled", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 1200,
      thinkingText: "analyzing options",
      includeReasoningPart: true,
    });

    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: "Final answer" });

    expect(next.content).toBe("Final answer");
    expect(next.parts?.map((part) => part.type)).toEqual(["reasoning", "text"]);

    const reasoningPart = next.parts?.[0];
    expect(reasoningPart?.type).toBe("reasoning");
    if (reasoningPart?.type === "reasoning") {
      expect(reasoningPart.content).toBe("analyzing options");
      expect(reasoningPart.durationMs).toBe(1200);
      expect(reasoningPart.isStreaming).toBe(true);
    }

    const textPart = next.parts?.[1];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Final answer");
    }
  });

  test("inserts late thinking metadata before text and updates same reasoning block", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Answer " });

    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 800,
      thinkingText: "initial thought",
      includeReasoningPart: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 1250,
      thinkingText: "initial thought with refinement",
      includeReasoningPart: true,
    });

    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: "continues" });

    expect(next.parts?.map((part) => part.type)).toEqual(["reasoning", "text"]);
    expect(next.content).toBe("Answer continues");

    const reasoningPart = next.parts?.[0];
    expect(reasoningPart?.type).toBe("reasoning");
    if (reasoningPart?.type === "reasoning") {
      expect(reasoningPart.content).toBe("initial thought with refinement");
      expect(reasoningPart.durationMs).toBe(1250);
    }

    const textPart = next.parts?.[1];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Answer continues");
    }
  });

  test("upserts reasoning parts by thinking source key without cross-source overwrite", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 200,
      thinkingText: "alpha draft",
      includeReasoningPart: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:b",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 300,
      thinkingText: "beta draft",
      includeReasoningPart: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 420,
      thinkingText: "alpha refined",
      includeReasoningPart: true,
    });

    const next = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:b",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 560,
      thinkingText: "beta refined",
      includeReasoningPart: true,
    });

    const reasoningParts = (next.parts ?? []).filter((part) => part.type === "reasoning");
    expect(reasoningParts).toHaveLength(2);

    const sourceA = reasoningParts.find(
      (part) => part.type === "reasoning" && part.thinkingSourceKey === "source:a",
    );
    expect(sourceA?.type).toBe("reasoning");
    if (sourceA?.type === "reasoning") {
      expect(sourceA.content).toBe("alpha refined");
      expect(sourceA.durationMs).toBe(420);
      expect(sourceA.isStreaming).toBe(true);
    }

    const sourceB = reasoningParts.find(
      (part) => part.type === "reasoning" && part.thinkingSourceKey === "source:b",
    );
    expect(sourceB?.type).toBe("reasoning");
    if (sourceB?.type === "reasoning") {
      expect(sourceB.content).toBe("beta refined");
      expect(sourceB.durationMs).toBe(560);
      expect(sourceB.isStreaming).toBe(true);
    }
  });

  test("re-syncs per-source registry from reasoning parts when mapping is missing", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 200,
      thinkingText: "alpha draft",
      includeReasoningPart: true,
    });
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:b",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 300,
      thinkingText: "beta draft",
      includeReasoningPart: true,
    });

    const sourceABefore = findReasoningPartBySource(msg, "source:a");
    const sourceBBefore = findReasoningPartBySource(msg, "source:b");
    expect(sourceABefore?.type).toBe("reasoning");
    expect(sourceBBefore?.type).toBe("reasoning");

    const messageWithoutRegistry: ChatMessage = {
      ...msg,
      parts: [...(msg.parts ?? [])],
    };

    const next = applyStreamPartEvent(messageWithoutRegistry, {
      type: "thinking-meta",
      thinkingSourceKey: "source:b",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 560,
      thinkingText: "beta refined after clone",
      includeReasoningPart: true,
    });

    const sourceAAfter = findReasoningPartBySource(next, "source:a");
    expect(sourceAAfter?.type).toBe("reasoning");
    if (sourceAAfter?.type === "reasoning" && sourceABefore?.type === "reasoning") {
      expect(sourceAAfter.id).toBe(sourceABefore.id);
      expect(sourceAAfter.content).toBe("alpha draft");
      expect(sourceAAfter.durationMs).toBe(200);
    }

    const sourceBAfter = findReasoningPartBySource(next, "source:b");
    expect(sourceBAfter?.type).toBe("reasoning");
    if (sourceBAfter?.type === "reasoning" && sourceBBefore?.type === "reasoning") {
      expect(sourceBAfter.id).toBe(sourceBBefore.id);
      expect(sourceBAfter.content).toBe("beta refined after clone");
      expect(sourceBAfter.durationMs).toBe(560);
    }

    expect((next.parts ?? []).filter((part) => part.type === "reasoning")).toHaveLength(2);
  });

  test("re-syncs per-source registry when mapping points to a stale part id", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 200,
      thinkingText: "alpha draft",
      includeReasoningPart: true,
    });

    const sourceAInitial = findReasoningPartBySource(msg, "source:a");
    expect(sourceAInitial?.type).toBe("reasoning");
    if (sourceAInitial?.type === "reasoning") {
      sourceAInitial.id = createPartId();
    }

    const next = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:a",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 420,
      thinkingText: "alpha refined after stale mapping",
      includeReasoningPart: true,
    });

    const sourceAAfter = findReasoningPartBySource(next, "source:a");
    expect(sourceAAfter?.type).toBe("reasoning");
    if (sourceAAfter?.type === "reasoning" && sourceAInitial?.type === "reasoning") {
      expect(sourceAAfter.id).toBe(sourceAInitial.id);
      expect(sourceAAfter.content).toBe("alpha refined after stale mapping");
      expect(sourceAAfter.durationMs).toBe(420);
      expect(sourceAAfter.isStreaming).toBe(true);
    }

    expect((next.parts ?? []).filter((part) => part.type === "reasoning")).toHaveLength(1);
  });

  test("text-complete is a no-op in the reducer (reconciliation handled upstream)", () => {
    const msg = createAssistantMessage();
    const withDelta = applyStreamPartEvent(msg, { type: "text-delta", delta: "Hello" });
    const next = applyStreamPartEvent(withDelta, {
      type: "text-complete",
      fullText: "Hello World",
      messageId: "msg-test",
    });

    // The reducer returns the message unchanged — reconciliation happens in useStreamConsumer
    expect(next).toBe(withDelta);
    expect(next.content).toBe("Hello");
  });

  test("handles tool start by finalizing text and inserting a tool part", () => {
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

  test("keeps thinking, pre-tool text, and post-tool text segmented", () => {
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

  test("merges parallel agents into agent part for subagent/background updates", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });

    const agents: ParallelAgent[] = [
      {
        id: "agent_1",
        taskToolCallId: "task_1",
        name: "researcher",
        task: "Investigate",
        status: "background",
        background: true,
        startedAt: new Date().toISOString(),
      },
    ];

    const next = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents,
      isLastMessage: true,
    });

    expect(next.parallelAgents).toHaveLength(1);
    const agentPart = next.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.background).toBe(true);
      expect(agentPart.agents[0]?.status).toBe("background");
    }
  });

  test("returns to main text stream after subagent completion", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });

    const runningAgents: ParallelAgent[] = [
      {
        id: "agent_1",
        taskToolCallId: "task_1",
        name: "researcher",
        task: "Investigate",
        status: "running",
        startedAt: new Date().toISOString(),
      },
    ];

    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: runningAgents,
      isLastMessage: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "tool-complete",
      toolId: "task_1",
      output: "subagent output",
      success: true,
    });

    const completedAgents: ParallelAgent[] = [
      {
        ...runningAgents[0]!,
        status: "completed",
        result: "subagent output",
        durationMs: 1200,
      },
    ];

    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: completedAgents,
      isLastMessage: true,
    });

    const next = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "Main assistant continues.",
    });

    expect(next.content).toBe("Main assistant continues.");
    expect(next.parts?.map((part) => part.type)).toEqual(["tool", "agent", "text"]);

    const trailingText = next.parts?.[2];
    expect(trailingText?.type).toBe("text");
    if (trailingText?.type === "text") {
      expect(trailingText.content).toBe("Main assistant continues.");
      expect(trailingText.isStreaming).toBe(true);
    }
  });

  test("keeps main continuation text separate from completed subagent result", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });
    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "researcher",
          task: "Investigate",
          status: "completed",
          result: "subagent output",
          startedAt: new Date().toISOString(),
          durationMs: 900,
        },
      ],
      isLastMessage: true,
    });

    msg = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "Main ",
    });
    const next = applyStreamPartEvent(msg, {
      type: "text-delta",
      delta: "assistant reply",
    });

    const textParts = next.parts?.filter((part) => part.type === "text") ?? [];
    expect(textParts).toHaveLength(1);
    const textPart = textParts[0];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Main assistant reply");
    }

    const agentPart = next.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.result).toBe("subagent output");
      expect(agentPart.agents[0]?.status).toBe("completed");
    }
  });

  test("keeps control on main stream after subagent completion updates", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Investigate" },
    });

    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "researcher",
          task: "Investigate",
          status: "completed",
          result: "subagent output",
          startedAt: new Date().toISOString(),
          durationMs: 900,
        },
      ],
      isLastMessage: true,
    });

    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "Main starts" });

    msg = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "researcher",
          task: "Investigate",
          status: "completed",
          result: "subagent output\n\nwith details",
          startedAt: new Date().toISOString(),
          durationMs: 920,
        },
      ],
      isLastMessage: true,
    });

    const next = applyStreamPartEvent(msg, { type: "text-delta", delta: " and continues" });

    expect(next.parts?.map((part) => part.type)).toEqual(["tool", "agent", "text"]);
    expect(next.content).toBe("Main starts and continues");

    const textPart = next.parts?.[2];
    expect(textPart?.type).toBe("text");
    if (textPart?.type === "text") {
      expect(textPart.content).toBe("Main starts and continues");
      expect(textPart.isStreaming).toBe(true);
    }

    const agentPart = next.parts?.[1];
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.result).toBe("subagent output\n\nwith details");
      expect(agentPart.agents[0]?.status).toBe("completed");
    }
  });

  test("normalizes subagent result formatting during streaming agent updates", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "task_1",
      toolName: "Task",
      input: { description: "Review implementation" },
    });

    const next = applyStreamPartEvent(msg, {
      type: "parallel-agents",
      agents: [
        {
          id: "agent_1",
          taskToolCallId: "task_1",
          name: "reviewer",
          task: "Review implementation",
          status: "completed",
          result: "\r\n\r\n```json\r\n{\"ok\": true}\r\n```\r\n",
          startedAt: new Date().toISOString(),
          durationMs: 900,
        },
      ],
      isLastMessage: true,
    });

    expect(next.parallelAgents?.[0]?.result).toBe("```json\n{\"ok\": true}\n```");

    const agentPart = next.parts?.find((part) => part.type === "agent");
    expect(agentPart?.type).toBe("agent");
    if (agentPart?.type === "agent") {
      expect(agentPart.agents[0]?.result).toBe("```json\n{\"ok\": true}\n```");
    }
  });
});

describe("reasoning streaming finalizers", () => {
  test("finalizeStreamingReasoningParts marks only streaming reasoning parts complete", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 300,
      thinkingText: "inspect",
      includeReasoningPart: true,
    });
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "answer" });

    const finalized = finalizeStreamingReasoningParts(msg.parts ?? []);

    expect(finalized[0]?.type).toBe("reasoning");
    if (finalized[0]?.type === "reasoning") {
      expect(finalized[0].isStreaming).toBe(false);
    }

    expect(finalized[1]?.type).toBe("text");
    if (finalized[1]?.type === "text") {
      expect(finalized[1].isStreaming).toBe(true);
    }
  });

  test("finalizeStreamingReasoningInMessage returns updated message parts", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 450,
      thinkingText: "plan",
      includeReasoningPart: true,
    });

    const finalized = finalizeStreamingReasoningInMessage(msg);

    expect(finalized).not.toBe(msg);
    expect(finalized.parts?.[0]?.type).toBe("reasoning");
    if (finalized.parts?.[0]?.type === "reasoning") {
      expect(finalized.parts[0].isStreaming).toBe(false);
    }
  });

  test("normal completion path finalizes reasoning part streaming state", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 600,
      thinkingText: "analyzing",
      includeReasoningPart: true,
    });
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "final answer" });

    const completed = {
      ...finalizeStreamingReasoningInMessage(msg),
      streaming: false,
    };

    expect(completed.streaming).toBe(false);
    const reasoning = completed.parts?.find((part) => part.type === "reasoning");
    expect(reasoning?.type).toBe("reasoning");
    if (reasoning?.type === "reasoning") {
      expect(reasoning.isStreaming).toBe(false);
    }
  });

  test("interrupted completion path finalizes reasoning part streaming state", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 700,
      thinkingText: "checking constraints",
      includeReasoningPart: true,
    });
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "working..." });
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_1",
      toolName: "Read",
      input: { filePath: "README.md" },
    });

    const interrupted = {
      ...finalizeStreamingReasoningInMessage(msg),
      streaming: false,
      toolCalls: (msg.toolCalls ?? []).map((toolCall) =>
        toolCall.status === "running" ? { ...toolCall, status: "interrupted" as const } : toolCall
      ),
    };

    expect(interrupted.streaming).toBe(false);
    const reasoning = interrupted.parts?.find((part) => part.type === "reasoning");
    expect(reasoning?.type).toBe("reasoning");
    if (reasoning?.type === "reasoning") {
      expect(reasoning.isStreaming).toBe(false);
    }
    expect(interrupted.toolCalls?.[0]?.status).toBe("interrupted");
  });
});
