import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@/services/agents/types.ts";
import {
  AGENT_ID,
  createHarness,
  filterByType,
  mockStream,
} from "./subagent-adapter.test-support.ts";

describe("SubagentStreamAdapter", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("tool events", () => {
    test("publishes stream.tool.start for tool_use chunks", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "tool-abc",
            input: { command: "ls" },
          } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const starts = filterByType(harness.events, "stream.tool.start");
      expect(starts).toHaveLength(1);
      expect(starts[0]!.data.toolName).toBe("bash");
      expect(starts[0]!.data.toolId).toBe("tool-abc");
      expect(starts[0]!.data.toolInput).toEqual({ command: "ls" });
    });

    test("publishes stream.tool.complete for tool_result chunks", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "tool-abc",
            input: {},
          } as unknown as string,
        },
        {
          type: "tool_result",
          content: "file.txt" as string,
          tool_use_id: "tool-abc",
          toolName: "bash",
        } as unknown as AgentMessage,
      ]);

      await adapter.consumeStream(stream);

      const completes = filterByType(harness.events, "stream.tool.complete");
      expect(completes).toHaveLength(1);
      expect(completes[0]!.data.toolId).toBe("tool-abc");
      expect(completes[0]!.data.toolName).toBe("bash");
      expect(completes[0]!.data.success).toBe(true);
    });

    test("increments toolUses count", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "t1",
            input: {},
          } as unknown as string,
        },
        {
          type: "tool_use",
          content: {
            name: "edit",
            toolUseId: "t2",
            input: {},
          } as unknown as string,
        },
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.toolUses).toBe(2);
    });

    test("records tool details with duration", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "t1",
            input: {},
          } as unknown as string,
        },
        {
          type: "tool_result",
          content: "ok",
          tool_use_id: "t1",
          toolName: "bash",
        } as unknown as AgentMessage,
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.toolDetails).toBeDefined();
      expect(result.toolDetails).toHaveLength(1);
      expect(result.toolDetails![0]!.toolId).toBe("t1");
      expect(result.toolDetails![0]!.toolName).toBe("bash");
      expect(result.toolDetails![0]!.success).toBe(true);
      expect(result.toolDetails![0]!.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("tracks tool errors in details", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "t1",
            input: {},
          } as unknown as string,
        },
        {
          type: "tool_result",
          content: { error: "command not found" },
          tool_use_id: "t1",
          toolName: "bash",
          is_error: true,
        } as unknown as AgentMessage,
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.toolDetails![0]!.success).toBe(false);

      const completes = filterByType(harness.events, "stream.tool.complete");
      expect(completes[0]!.data.success).toBe(false);
      expect(completes[0]!.data.error).toBe("command not found");
    });

    test("generates synthetic tool IDs when not provided", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "bash", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const starts = filterByType(harness.events, "stream.tool.start");
      expect(starts[0]!.data.toolId).toContain(`tool_${AGENT_ID}_bash_`);
    });

    test("sets parentAgentId on tool start events", async () => {
      const adapter = harness.createAdapter({ parentAgentId: "parent-agent-1" });
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "t1",
            input: {},
          } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const starts = filterByType(harness.events, "stream.tool.start");
      expect(starts[0]!.data.parentAgentId).toBe("worker-1");
    });
  });

  describe("token usage", () => {
    test("publishes stream.usage from chunk metadata", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "text",
          content: "hello",
          metadata: {
            tokenUsage: { inputTokens: 100, outputTokens: 50 },
            model: "claude-sonnet-4-5-20250514",
          },
        },
      ]);

      await adapter.consumeStream(stream);

      const usages = filterByType(harness.events, "stream.usage");
      expect(usages).toHaveLength(1);
      expect(usages[0]!.data.inputTokens).toBe(100);
      expect(usages[0]!.data.outputTokens).toBe(50);
      expect(usages[0]!.data.model).toBe("claude-sonnet-4-5-20250514");
    });

    test("accumulates token usage across chunks", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "text",
          content: "a",
          metadata: {
            tokenUsage: { inputTokens: 100, outputTokens: 50 },
          },
        },
        {
          type: "text",
          content: "b",
          metadata: {
            tokenUsage: { inputTokens: 200, outputTokens: 75 },
          },
        },
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.tokenUsage).toEqual({
        inputTokens: 300,
        outputTokens: 125,
      });

      const usages = filterByType(harness.events, "stream.usage");
      expect(usages).toHaveLength(2);
      expect(usages[1]!.data.inputTokens).toBe(300);
      expect(usages[1]!.data.outputTokens).toBe(125);
    });

    test("ignores zero token usage", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "text",
          content: "hello",
          metadata: {
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
          },
        },
      ]);

      await adapter.consumeStream(stream);

      const usages = filterByType(harness.events, "stream.usage");
      expect(usages).toHaveLength(0);
    });

    test("includes tokenUsage in result when present", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "text",
          content: "hi",
          metadata: {
            tokenUsage: { inputTokens: 50, outputTokens: 25 },
          },
        },
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.tokenUsage).toBeDefined();
      expect(result.tokenUsage!.inputTokens).toBe(50);
    });

    test("omits tokenUsage from result when no tokens used", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      const result = await adapter.consumeStream(stream);

      expect(result.tokenUsage).toBeUndefined();
    });
  });

  describe("tool tracker integration (stream.agent.update)", () => {
    test("publishes stream.agent.update on tool_use with tool name and count", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "grep", toolUseId: "t1", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const updates = filterByType(harness.events, "stream.agent.update");
      expect(updates.length).toBeGreaterThanOrEqual(1);
      const startUpdate = updates[0]!;
      expect(startUpdate.data.agentId).toBe(AGENT_ID);
      expect(startUpdate.data.currentTool).toBe("grep");
      expect(startUpdate.data.toolUses).toBe(1);
    });

    test("publishes stream.agent.update on tool_result clearing current tool", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "grep", toolUseId: "t1", input: {} } as unknown as string,
        },
        {
          type: "tool_result",
          content: "found it",
          metadata: { toolId: "t1" },
        } as unknown as AgentMessage,
      ]);

      await adapter.consumeStream(stream);

      const updates = filterByType(harness.events, "stream.agent.update");
      expect(updates.length).toBeGreaterThanOrEqual(2);
      const completeUpdate = updates[updates.length - 1]!;
      expect(completeUpdate.data.agentId).toBe(AGENT_ID);
      expect(completeUpdate.data.currentTool).toBeUndefined();
      expect(completeUpdate.data.toolUses).toBe(1);
    });

    test("increments tool count across multiple tool invocations", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "grep", toolUseId: "t1", input: {} } as unknown as string,
        },
        {
          type: "tool_result",
          content: "result1",
          metadata: { toolId: "t1" },
        } as unknown as AgentMessage,
        {
          type: "tool_use",
          content: { name: "view", toolUseId: "t2", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const updates = filterByType(harness.events, "stream.agent.update");
      const lastStartUpdate = updates.filter((u) => u.data.currentTool !== undefined).pop()!;
      expect(lastStartUpdate.data.toolUses).toBe(2);
      expect(lastStartUpdate.data.currentTool).toBe("view");
    });
  });

  describe("tool event agent attribution", () => {
    test("tool start parentAgentId is the sub-agent agentId, not the parent session", async () => {
      const adapter = harness.createAdapter({ parentAgentId: "parent-session-456" });
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "bash", toolUseId: "t1", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const starts = filterByType(harness.events, "stream.tool.start");
      expect(starts[0]!.data.parentAgentId).toBe(AGENT_ID);
    });
  });

  describe("text-complete sub-agent detection", () => {
    test("stream.text.complete has messageId prefixed with 'subagent-'", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "hello" }]);

      await adapter.consumeStream(stream);

      const completes = filterByType(harness.events, "stream.text.complete");
      expect(completes.length).toBe(1);
      expect(completes[0]!.data.messageId).toBe(`subagent-${AGENT_ID}`);
      expect(completes[0]!.data.messageId.startsWith("subagent-")).toBe(true);
    });
  });
});
