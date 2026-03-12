import { describe, expect, test } from "bun:test";
import { ClaudeAgentClient } from "@/services/agents/clients/index.ts";

describe("ClaudeAgentClient observability and parity", () => {
  test("uses hook payload fallback for subagent terminal signals when session_id/toolUseID arg are missing", async () => {
    const client = new ClaudeAgentClient();
    const seenSessionIds: string[] = [];
    const seenSubagentIds: string[] = [];
    const seenToolUseIds: Array<string | undefined> = [];

    const unsubStart = client.on("subagent.start", () => {});
    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as { subagentId?: string; toolUseID?: string };
      seenSessionIds.push(event.sessionId);
      seenSubagentIds.push(data.subagentId ?? "");
      seenToolUseIds.push(data.toolUseID);
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        registeredHooks: Record<
          string,
          Array<
            (
              input: Record<string, unknown>,
              toolUseID: string | undefined,
              options: { signal: AbortSignal },
            ) => Promise<{ continue: boolean }>
          >
        >;
        sessions: Map<string, { query?: { close?: () => void } }>;
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});
      const wrappedState = privateClient.sessions.get("wrapped-session-id");
      if (wrappedState) {
        wrappedState.query = { close: () => {} };
      }

      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      const subagentStopHook = privateClient.registeredHooks.SubagentStop?.[0];
      expect(subagentStartHook).toBeDefined();
      expect(subagentStopHook).toBeDefined();

      await subagentStartHook?.(
        {
          agent_id: "agent-42",
          tool_use_id: "tool-use-42",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      await subagentStopHook?.(
        {
          tool_use_id: "tool-use-42",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      expect(seenSessionIds).toEqual(["wrapped-session-id"]);
      expect(seenSubagentIds).toEqual(["agent-42"]);
      expect(seenToolUseIds).toEqual(["tool-use-42"]);

      await wrappedSession.destroy();
    } finally {
      unsubStart();
      unsubComplete();
    }
  });

  test("routes subagent terminal signals by tool_use_id when session_id is omitted across multiple sessions", async () => {
    const client = new ClaudeAgentClient();
    const seenSessionIds: string[] = [];
    const seenSubagentIds: string[] = [];

    const unsubStart = client.on("subagent.start", () => {});
    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as { subagentId?: string };
      seenSessionIds.push(event.sessionId);
      seenSubagentIds.push(data.subagentId ?? "");
    });

    try {
      const privateClient = client as unknown as {
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
        registeredHooks: Record<
          string,
          Array<
            (
              input: Record<string, unknown>,
              toolUseID: string | undefined,
              options: { signal: AbortSignal },
            ) => Promise<{ continue: boolean }>
          >
        >;
        sessions: Map<
          string,
          {
            query?: { close?: () => void };
            sdkSessionId?: string | null;
          }
        >;
      };

      const wrappedMain = privateClient.wrapQuery(null, "wrapped-main", {});
      const wrappedWorker = privateClient.wrapQuery(null, "wrapped-worker", {});
      const mainState = privateClient.sessions.get("wrapped-main");
      const workerState = privateClient.sessions.get("wrapped-worker");
      if (mainState) {
        mainState.query = { close: () => {} };
        mainState.sdkSessionId = "sdk-main";
      }
      if (workerState) {
        workerState.query = { close: () => {} };
        workerState.sdkSessionId = "sdk-worker";
      }

      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      const subagentStopHook = privateClient.registeredHooks.SubagentStop?.[0];
      expect(subagentStartHook).toBeDefined();
      expect(subagentStopHook).toBeDefined();

      await subagentStartHook?.(
        {
          session_id: "sdk-worker",
          agent_id: "agent-77",
          tool_use_id: "tool-use-77",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      await subagentStopHook?.(
        {
          tool_use_id: "tool-use-77",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      expect(seenSessionIds).toEqual(["wrapped-worker"]);
      expect(seenSubagentIds).toEqual(["agent-77"]);

      await wrappedMain.destroy();
      await wrappedWorker.destroy();
    } finally {
      unsubStart();
      unsubComplete();
    }
  });

  test("maps task_notification terminal statuses to subagent.complete outcomes", () => {
    const client = new ClaudeAgentClient();
    const seenCompletions: Array<{
      sessionId: string;
      subagentId?: string;
      success?: boolean;
      result?: string;
    }> = [];

    const unsubscribe = client.on("subagent.complete", (event) => {
      const data = event.data as {
        subagentId?: string;
        success?: boolean;
        result?: string;
      };
      seenCompletions.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        success: data.success,
        result: data.result,
      });
    });

    try {
      const privateClient = client as unknown as {
        processMessage: (
          sdkMessage: Record<string, unknown>,
          sessionId: string,
          state: {
            sdkSessionId: string | null;
            inputTokens: number;
            outputTokens: number;
            hasEmittedStreamingUsage: boolean;
          },
        ) => void;
        toolUseIdToAgentId: Map<string, string>;
        toolUseIdToSessionId: Map<string, string>;
      };

      const state = {
        sdkSessionId: "sdk-session",
        inputTokens: 0,
        outputTokens: 0,
        hasEmittedStreamingUsage: false,
      };

      privateClient.toolUseIdToAgentId.set("tool-use-success", "agent-success");
      privateClient.toolUseIdToSessionId.set("tool-use-success", "wrapped-session");
      privateClient.processMessage(
        {
          type: "system",
          subtype: "task_notification",
          tool_use_id: "tool-use-success",
          status: "completed",
          summary: "done",
        },
        "wrapped-session",
        state,
      );

      privateClient.toolUseIdToAgentId.set("tool-use-error", "agent-error");
      privateClient.toolUseIdToSessionId.set("tool-use-error", "wrapped-session");
      privateClient.processMessage(
        {
          type: "system",
          subtype: "task_notification",
          tool_use_id: "tool-use-error",
          status: "failed",
          summary: "failed",
        },
        "wrapped-session",
        state,
      );

      expect(seenCompletions).toEqual([
        {
          sessionId: "wrapped-session",
          subagentId: "agent-success",
          success: true,
          result: "done",
        },
        {
          sessionId: "wrapped-session",
          subagentId: "agent-error",
          success: false,
          result: "failed",
        },
      ]);
      expect(privateClient.toolUseIdToAgentId.has("tool-use-success")).toBe(false);
      expect(privateClient.toolUseIdToSessionId.has("tool-use-success")).toBe(false);
      expect(privateClient.toolUseIdToAgentId.has("tool-use-error")).toBe(false);
      expect(privateClient.toolUseIdToSessionId.has("tool-use-error")).toBe(false);
    } finally {
      unsubscribe();
    }
  });
});
