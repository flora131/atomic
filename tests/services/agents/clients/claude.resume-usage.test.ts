import { describe, expect, test } from "bun:test";

import { ClaudeAgentClient } from "@/services/agents/clients/index.ts";

describe("ClaudeAgentClient resume continuity semantics", () => {
  test("re-wraps active sessions without losing usage state and preserves hasEmittedStreamingUsage default", async () => {
    const client = new ClaudeAgentClient();
    (client as unknown as { isRunning: boolean }).isRunning = true;

    (
      client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
          persisted?: {
            sdkSessionId?: string | null;
            inputTokens?: number;
            outputTokens?: number;
            contextWindow?: number | null;
            systemToolsBaseline?: number | null;
          },
        ) => { destroy: () => Promise<void> };
      }
    ).wrapQuery(null, "resume-open", {}, {
      sdkSessionId: "sdk-resume-open",
      inputTokens: 123,
      outputTokens: 456,
      contextWindow: 200_000,
      systemToolsBaseline: 42,
    });

    const resumed = await client.resumeSession("resume-open");
    const resumedState = (
      client as unknown as {
        sessions: Map<
          string,
          {
            sdkSessionId: string | null;
            inputTokens: number;
            outputTokens: number;
            contextWindow: number | null;
            systemToolsBaseline: number | null;
          }
        >;
      }
    ).sessions.get("resume-open");

    expect(resumed).not.toBeNull();
    expect(resumedState).toMatchObject({
      sdkSessionId: "sdk-resume-open",
      inputTokens: 123,
      outputTokens: 456,
      contextWindow: 200_000,
      systemToolsBaseline: 42,
    });

    await resumed?.destroy();
  });
});

describe("ClaudeAgentClient streaming usage events", () => {
  test("message_delta with usage data triggers a usage client event during streaming", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        sessions: Map<string, { hasEmittedStreamingUsage: boolean }>;
        emitEvent: (
          eventType: string,
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
        detectedModel: string | null;
      };

      const session = privateClient.wrapQuery(null, "stream-usage-test", {});
      const state = privateClient.sessions.get("stream-usage-test");

      expect(state?.hasEmittedStreamingUsage).toBe(false);

      state!.hasEmittedStreamingUsage = true;
      privateClient.emitEvent("usage", "stream-usage-test", {
        inputTokens: 0,
        outputTokens: 150,
        model: privateClient.detectedModel,
      });

      const streamingUsage = usageEvents.filter(
        (event) => typeof event.outputTokens === "number" && event.outputTokens > 0,
      );
      expect(streamingUsage).toHaveLength(1);
      expect(streamingUsage[0]).toMatchObject({
        inputTokens: 0,
        outputTokens: 150,
      });
      expect(state?.hasEmittedStreamingUsage).toBe(true);

      session.destroy();
    } finally {
      unsubscribe();
    }
  });

  test("result handler emits inputTokens-only correction when hasEmittedStreamingUsage is true", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        sessions: Map<string, { hasEmittedStreamingUsage: boolean }>;
        processMessage: (
          msg: Record<string, unknown>,
          sessionId: string,
          state: Record<string, unknown>,
        ) => Record<string, unknown> | null;
      };

      const session = privateClient.wrapQuery(null, "result-guard-test", {});
      const state = privateClient.sessions.get("result-guard-test")!;

      state.hasEmittedStreamingUsage = true;

      const resultMsg = {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 500, output_tokens: 200 },
      };
      privateClient.processMessage(
        resultMsg,
        "result-guard-test",
        state as unknown as Record<string, unknown>,
      );

      const tokenUsage = usageEvents.filter(
        (event) => typeof event.inputTokens === "number",
      );
      expect(tokenUsage).toHaveLength(1);
      expect(tokenUsage[0]).toMatchObject({
        inputTokens: 500,
        outputTokens: 0,
      });
      expect(state.hasEmittedStreamingUsage).toBe(false);

      session.destroy();
    } finally {
      unsubscribe();
    }
  });

  test("send path (no message_delta) still emits full usage from result", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        sessions: Map<string, { hasEmittedStreamingUsage: boolean }>;
        processMessage: (
          msg: Record<string, unknown>,
          sessionId: string,
          state: Record<string, unknown>,
        ) => Record<string, unknown> | null;
      };

      const session = privateClient.wrapQuery(null, "send-usage-test", {});
      const state = privateClient.sessions.get("send-usage-test")!;

      expect(state.hasEmittedStreamingUsage).toBe(false);

      const resultMsg = {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 1000, output_tokens: 300 },
      };
      privateClient.processMessage(
        resultMsg,
        "send-usage-test",
        state as unknown as Record<string, unknown>,
      );

      const tokenUsage = usageEvents.filter(
        (event) => typeof event.inputTokens === "number",
      );
      expect(tokenUsage).toHaveLength(1);
      expect(tokenUsage[0]).toMatchObject({
        inputTokens: 1000,
        outputTokens: 300,
      });

      session.destroy();
    } finally {
      unsubscribe();
    }
  });
});
