import { beforeEach, describe, expect, test } from "bun:test";
import {
  addHitlQuestion,
  createMockMessage,
  createToolPart,
  finalizeLastTextPart,
  handleTextDelta,
  resetStreamOrderState,
  type TextPart,
  type ToolPart,
  upsertPart,
  verifyMonotonicIds,
} from "./stream-order.test-support.ts";

describe("Stream render order basic flows", () => {
  beforeEach(() => {
    resetStreamOrderState();
  });

  test("simple text-only stream", () => {
    let msg = createMockMessage();

    msg = handleTextDelta(msg, "Hello ");
    msg = handleTextDelta(msg, "world");
    msg = handleTextDelta(msg, "!");

    expect(msg.parts).toHaveLength(1);
    expect(msg.parts![0]!.type).toBe("text");
    const textPart = msg.parts![0] as TextPart;
    expect(textPart.content).toBe("Hello world!");
    expect(textPart.isStreaming).toBe(true);
  });

  test("text to tool to text sequence", () => {
    let msg = createMockMessage();

    msg = handleTextDelta(msg, "Running command...");
    expect(msg.parts).toHaveLength(1);

    msg = finalizeLastTextPart(msg);
    const toolPart = createToolPart("tool_1", "bash");
    msg.parts = upsertPart(msg.parts!, toolPart);
    expect(msg.parts).toHaveLength(2);

    msg = handleTextDelta(msg, " Done!");
    expect(msg.parts).toHaveLength(3);

    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("text");
    expect((msg.parts![0] as TextPart).content).toBe("Running command...");
    expect((msg.parts![0] as TextPart).isStreaming).toBe(false);
    expect((msg.parts![1] as ToolPart).toolName).toBe("bash");
    expect((msg.parts![2] as TextPart).content).toBe(" Done!");
    expect((msg.parts![2] as TextPart).isStreaming).toBe(true);
    verifyMonotonicIds(msg.parts!);
  });

  test("text to tool to HITL to response to text", () => {
    let msg = createMockMessage();

    msg = handleTextDelta(msg, "Need permission for:");
    msg = finalizeLastTextPart(msg);

    let toolPart = createToolPart("tool_1", "read_file");
    msg.parts = upsertPart(msg.parts!, toolPart);

    const toolIdx = msg.parts!.findIndex(
      (part) => part.type === "tool" && (part as ToolPart).toolCallId === "tool_1",
    );
    toolPart = addHitlQuestion(msg.parts![toolIdx] as ToolPart, "req_1");
    msg.parts = upsertPart(msg.parts!, toolPart);

    toolPart = {
      ...toolPart,
      pendingQuestion: undefined,
      hitlResponse: {
        cancelled: false,
        responseMode: "option",
        answerText: "allow",
        displayText: 'User answered: "allow"',
      },
    };
    msg.parts = upsertPart(msg.parts!, toolPart);

    toolPart = {
      ...toolPart,
      state: { status: "completed", output: "file content", durationMs: 150 },
    };
    msg.parts = upsertPart(msg.parts!, toolPart);

    msg = handleTextDelta(msg, " Permission granted and file read.");

    expect(msg.parts).toHaveLength(3);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("text");

    const tool = msg.parts![1] as ToolPart;
    expect(tool.pendingQuestion).toBeUndefined();
    expect(tool.hitlResponse?.answerText).toBe("allow");
    expect(tool.state.status).toBe("completed");
    verifyMonotonicIds(msg.parts!);
  });

  test("text to multiple tools to text", () => {
    let msg = createMockMessage();

    msg = handleTextDelta(msg, "Starting sequence:");
    msg = finalizeLastTextPart(msg);

    msg.parts = upsertPart(msg.parts!, createToolPart("tool_1", "bash"));
    msg.parts = upsertPart(msg.parts!, createToolPart("tool_2", "view"));
    msg = handleTextDelta(msg, " All done!");

    expect(msg.parts).toHaveLength(4);
    expect(msg.parts![0]!.type).toBe("text");
    expect(msg.parts![1]!.type).toBe("tool");
    expect(msg.parts![2]!.type).toBe("tool");
    expect(msg.parts![3]!.type).toBe("text");
    expect((msg.parts![1] as ToolPart).toolName).toBe("bash");
    expect((msg.parts![2] as ToolPart).toolName).toBe("view");
    expect((msg.parts![0] as TextPart).content).toBe("Starting sequence:");
    expect((msg.parts![3] as TextPart).content).toBe(" All done!");
    verifyMonotonicIds(msg.parts!);
  });
});
