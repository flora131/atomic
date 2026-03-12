import { beforeEach, describe, expect, test } from "bun:test";
import {
  AGENT_ID,
  RUN_ID,
  SESSION_ID,
  createHarness,
  filterByType,
  mockStream,
} from "./subagent-adapter.test-support.ts";

describe("SubagentStreamAdapter", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("agent registration before tool events (Fix 1A)", () => {
    test("publishes stream.agent.start synchronously in constructor when agentType is provided", () => {
      harness.createAdapterWithAgentType({
        agentType: "explore",
        task: "Search the codebase",
      });

      const agentStarts = filterByType(harness.events, "stream.agent.start");
      expect(agentStarts).toHaveLength(1);
      expect(agentStarts[0]!.data.agentId).toBe(AGENT_ID);
      expect(agentStarts[0]!.data.agentType).toBe("explore");
      expect(agentStarts[0]!.data.task).toBe("Search the codebase");
    });

    test("publishes stream.agent.start before any tool events", async () => {
      const adapter = harness.createAdapterWithAgentType({
        agentType: "explore",
        task: "Search the codebase",
      });
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "grep", toolUseId: "t1", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const agentStarts = filterByType(harness.events, "stream.agent.start");
      const toolStarts = filterByType(harness.events, "stream.tool.start");
      expect(agentStarts).toHaveLength(1);
      expect(toolStarts).toHaveLength(1);

      const agentStartIdx = harness.events.indexOf(agentStarts[0]!);
      const toolStartIdx = harness.events.indexOf(toolStarts[0]!);
      expect(agentStartIdx).toBeLessThan(toolStartIdx);
    });

    test("stream.agent.start has correct event envelope", async () => {
      const adapter = harness.createAdapterWithAgentType({
        agentType: "task",
        task: "Run tests",
        isBackground: true,
      });
      const stream = mockStream([{ type: "text", content: "hi" }]);

      await adapter.consumeStream(stream);

      const agentStarts = filterByType(harness.events, "stream.agent.start");
      expect(agentStarts).toHaveLength(1);
      expect(agentStarts[0]!.data.agentId).toBe(AGENT_ID);
      expect(agentStarts[0]!.data.agentType).toBe("task");
      expect(agentStarts[0]!.data.task).toBe("Run tests");
      expect(agentStarts[0]!.data.isBackground).toBe(true);
      expect(agentStarts[0]!.sessionId).toBe(SESSION_ID);
      expect(agentStarts[0]!.runId).toBe(RUN_ID);
    });

    test("does not publish stream.agent.start when agentType is not provided", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      await adapter.consumeStream(stream);

      const agentStarts = filterByType(harness.events, "stream.agent.start");
      expect(agentStarts).toHaveLength(0);
    });

    test("uses agentType as fallback task when task is not provided", () => {
      harness.createAdapterWithAgentType({
        agentType: "explore",
      });

      const agentStarts = filterByType(harness.events, "stream.agent.start");
      expect(agentStarts).toHaveLength(1);
      expect(agentStarts[0]!.data.task).toBe("explore");
    });

    test("defaults isBackground to false", () => {
      harness.createAdapterWithAgentType({
        agentType: "explore",
      });

      const agentStarts = filterByType(harness.events, "stream.agent.start");
      expect(agentStarts[0]!.data.isBackground).toBe(false);
    });

    test("idempotent guard prevents duplicate on first consumeStream call", async () => {
      const adapter = harness.createAdapterWithAgentType({
        agentType: "task",
        task: "Build project",
      });

      expect(filterByType(harness.events, "stream.agent.start")).toHaveLength(1);

      await adapter.consumeStream(mockStream([{ type: "text", content: "done" }]));

      expect(filterByType(harness.events, "stream.agent.start")).toHaveLength(1);
    });

    test("re-publishes stream.agent.start on adapter reuse (multiple consumeStream calls)", async () => {
      const adapter = harness.createAdapterWithAgentType({
        agentType: "task",
        task: "Build project",
      });

      await adapter.consumeStream(mockStream([{ type: "text", content: "first" }]));
      await adapter.consumeStream(mockStream([{ type: "text", content: "second" }]));

      const agentStarts = filterByType(harness.events, "stream.agent.start");
      expect(agentStarts).toHaveLength(2);
    });
  });
});
