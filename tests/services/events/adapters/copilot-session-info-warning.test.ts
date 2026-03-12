import { describe, expect, test } from "bun:test";
import {
  handleCopilotSessionInfo,
  handleCopilotSessionWarning,
} from "@/services/events/adapters/providers/copilot/session-handlers.ts";
import type { CopilotSessionHandlerContext } from "@/services/events/adapters/providers/copilot/types.ts";
import type { AgentEvent } from "@/services/agents/types.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

function createStubContext(
  overrides?: Partial<CopilotSessionHandlerContext>,
): CopilotSessionHandlerContext & { published: BusEvent[] } {
  const published: BusEvent[] = [];
  return {
    sessionId: "sess-1",
    runId: 1,
    messageId: "msg-1",
    accumulatedText: "",
    accumulatedOutputTokens: 0,
    thinkingStreams: new Map(),
    activeSubagentToolsById: new Map(),
    subagentTracker: null,
    syntheticForegroundAgent: null,
    turnMetadataState: {
      activeTurnId: null,
      syntheticCounter: 0,
    },
    publishEvent: (event: BusEvent) => published.push(event),
    resolveParentAgentId: () => undefined,
    updateAccumulatedOutputTokens: () => {},
    updatePendingIdleReason: () => {},
    published,
    ...overrides,
  };
}

function infoEvent(
  message: string,
  infoType?: string,
): AgentEvent<"session.info"> {
  return {
    type: "session.info",
    sessionId: "sess-1",
    timestamp: new Date().toISOString(),
    data: { message, infoType: infoType ?? "general" },
  } as AgentEvent<"session.info">;
}

function warningEvent(message: string): AgentEvent<"session.warning"> {
  return {
    type: "session.warning",
    sessionId: "sess-1",
    timestamp: new Date().toISOString(),
    data: { message, warningType: "general" },
  } as AgentEvent<"session.warning">;
}

describe("handleCopilotSessionInfo", () => {
  describe("suppresses file-path messages", () => {
    test("suppresses Windows absolute path", () => {
      const ctx = createStubContext();
      handleCopilotSessionInfo(
        ctx,
        infoEvent("C:\\dev\\streaming-reliability\\src\\index.ts"),
      );
      expect(ctx.published).toHaveLength(0);
    });

    test("suppresses POSIX absolute path", () => {
      const ctx = createStubContext();
      handleCopilotSessionInfo(
        ctx,
        infoEvent("/home/user/project/file.ts"),
      );
      expect(ctx.published).toHaveLength(0);
    });

    test("suppresses home-relative path", () => {
      const ctx = createStubContext();
      handleCopilotSessionInfo(ctx, infoEvent("~/project/file.ts"));
      expect(ctx.published).toHaveLength(0);
    });

    test("suppresses dot-relative path", () => {
      const ctx = createStubContext();
      handleCopilotSessionInfo(ctx, infoEvent("./src/index.ts"));
      expect(ctx.published).toHaveLength(0);
    });

    test("suppresses path with surrounding whitespace", () => {
      const ctx = createStubContext();
      handleCopilotSessionInfo(ctx, infoEvent("  /usr/local/bin/node  "));
      expect(ctx.published).toHaveLength(0);
    });
  });

  describe("forwards non-path messages", () => {
    test("forwards plain text message", () => {
      const ctx = createStubContext();
      handleCopilotSessionInfo(
        ctx,
        infoEvent("Created 2 files successfully"),
      );
      expect(ctx.published).toHaveLength(1);
      expect(ctx.published[0]!.type).toBe("stream.session.info");
      expect((ctx.published[0]! as BusEvent & { data: { message: string } }).data.message).toBe(
        "Created 2 files successfully",
      );
    });

    test("forwards message containing a path embedded in a sentence", () => {
      const ctx = createStubContext();
      handleCopilotSessionInfo(
        ctx,
        infoEvent("Modified /home/user/file.ts and 3 others"),
      );
      expect(ctx.published).toHaveLength(1);
    });

    test("preserves infoType from event data", () => {
      const ctx = createStubContext();
      handleCopilotSessionInfo(
        ctx,
        infoEvent("some status update", "progress"),
      );
      expect(ctx.published).toHaveLength(1);
      expect((ctx.published[0] as BusEvent & { data: { infoType: string } }).data.infoType).toBe(
        "progress",
      );
    });

    test("defaults infoType to 'general' when absent", () => {
      const ctx = createStubContext();
      const event = {
        type: "session.info",
        sessionId: "sess-1",
        timestamp: new Date().toISOString(),
        data: { message: "hello" },
      } as unknown as AgentEvent<"session.info">;
      handleCopilotSessionInfo(ctx, event);
      expect(ctx.published).toHaveLength(1);
      expect((ctx.published[0] as BusEvent & { data: { infoType: string } }).data.infoType).toBe(
        "general",
      );
    });

    test("defaults message to empty string when absent", () => {
      const ctx = createStubContext();
      const event = {
        type: "session.info",
        sessionId: "sess-1",
        timestamp: new Date().toISOString(),
        data: {},
      } as unknown as AgentEvent<"session.info">;
      handleCopilotSessionInfo(ctx, event);
      expect(ctx.published).toHaveLength(1);
      expect((ctx.published[0] as BusEvent & { data: { message: string } }).data.message).toBe("");
    });
  });

  describe("published event structure", () => {
    test("includes sessionId and runId from context", () => {
      const ctx = createStubContext({ sessionId: "s-42", runId: 99 });
      handleCopilotSessionInfo(ctx, infoEvent("status ok"));
      expect(ctx.published).toHaveLength(1);
      const pub = ctx.published[0] as BusEvent & {
        sessionId: string;
        runId: number;
      };
      expect(pub.sessionId).toBe("s-42");
      expect(pub.runId).toBe(99);
    });

    test("sets timestamp on published event", () => {
      const ctx = createStubContext();
      const before = Date.now();
      handleCopilotSessionInfo(ctx, infoEvent("status ok"));
      const after = Date.now();
      const pub = ctx.published[0] as BusEvent & { timestamp: number };
      expect(pub.timestamp).toBeGreaterThanOrEqual(before);
      expect(pub.timestamp).toBeLessThanOrEqual(after);
    });
  });
});

describe("handleCopilotSessionWarning", () => {
  test("never publishes events regardless of warning content", () => {
    const ctx = createStubContext();
    handleCopilotSessionWarning(ctx, warningEvent("Something went wrong"));
    expect(ctx.published).toHaveLength(0);
  });

  test("suppresses warnings with detailed messages", () => {
    const ctx = createStubContext();
    handleCopilotSessionWarning(
      ctx,
      warningEvent("Rate limit exceeded. Retrying in 5 seconds."),
    );
    expect(ctx.published).toHaveLength(0);
  });

  test("suppresses warnings with empty message", () => {
    const ctx = createStubContext();
    handleCopilotSessionWarning(ctx, warningEvent(""));
    expect(ctx.published).toHaveLength(0);
  });

  test("suppresses multiple sequential warnings", () => {
    const ctx = createStubContext();
    handleCopilotSessionWarning(ctx, warningEvent("warn 1"));
    handleCopilotSessionWarning(ctx, warningEvent("warn 2"));
    handleCopilotSessionWarning(ctx, warningEvent("warn 3"));
    expect(ctx.published).toHaveLength(0);
  });
});
