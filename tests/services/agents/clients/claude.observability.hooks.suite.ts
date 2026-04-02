import { describe, expect, test } from "bun:test";
import { ClaudeAgentClient } from "@/services/agents/clients/index.ts";

describe("ClaudeAgentClient observability and parity", () => {
  test("maps hook sdk session IDs to wrapped session IDs for tool and subagent events", async () => {
    const client = new ClaudeAgentClient();
    const seenToolSessionIds: string[] = [];
    const seenSubagentSessionIds: string[] = [];

    const unsubTool = client.on("tool.start", (event) => {
      seenToolSessionIds.push(event.sessionId);
    });
    const unsubSubagent = client.on("subagent.start", (event) => {
      seenSubagentSessionIds.push(event.sessionId);
    });

    try {
      const privateClient = client as unknown as {
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
        sessions: Map<string, { sdkSessionId: string | null; isClosed: boolean }>;
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});
      const preToolUseHook = privateClient.registeredHooks.PreToolUse?.[0];
      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      expect(preToolUseHook).toBeDefined();
      expect(subagentStartHook).toBeDefined();

      const hookSessionId = "sdk-hook-session-id";

      await preToolUseHook?.(
        {
          session_id: hookSessionId,
          tool_name: "Read",
          tool_input: { file: "src/main.rs" },
        },
        "tool_use_1",
        { signal: new AbortController().signal },
      );

      await subagentStartHook?.(
        {
          session_id: hookSessionId,
          agent_id: "agent-1",
          agent_type: "debugger",
        },
        "tool_use_2",
        { signal: new AbortController().signal },
      );

      expect(seenToolSessionIds).toEqual(["wrapped-session-id"]);
      expect(seenSubagentSessionIds).toEqual(["wrapped-session-id"]);
      expect(privateClient.sessions.get("wrapped-session-id")?.sdkSessionId).toBe(
        hookSessionId,
      );

      await wrappedSession.destroy();
    } finally {
      unsubTool();
      unsubSubagent();
    }
  });

  test("maps parent_tool_call_id to parentAgentId for tool hooks", async () => {
    const client = new ClaudeAgentClient();
    const seenParentAgentIds: Array<string | undefined> = [];
    const seenParentToolIds: Array<string | undefined> = [];

    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as {
        parentAgentId?: string;
        parentToolCallId?: string;
      };
      seenParentAgentIds.push(data.parentAgentId);
      seenParentToolIds.push(data.parentToolCallId);
    });
    const unsubSubagent = client.on("subagent.start", () => {});

    try {
      const privateClient = client as unknown as {
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
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});
      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      const preToolUseHook = privateClient.registeredHooks.PreToolUse?.[0];
      expect(subagentStartHook).toBeDefined();
      expect(preToolUseHook).toBeDefined();

      await subagentStartHook?.(
        {
          session_id: "sdk-main-session",
          agent_id: "agent-hook-1",
          tool_use_id: "subagent-hook-correlation-1",
          parent_tool_call_id: "parent-dispatch-call-1",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      await preToolUseHook?.(
        {
          session_id: "sdk-main-session",
          tool_name: "WebSearch",
          tool_input: { query: "parallel tool routing" },
          parent_tool_call_id: "parent-dispatch-call-1",
        },
        "inner-tool-call-1",
        { signal: new AbortController().signal },
      );

      expect(seenParentToolIds).toContain("parent-dispatch-call-1");
      expect(seenParentAgentIds).toContain("agent-hook-1");

      await wrappedSession.destroy();
    } finally {
      unsubTool();
      unsubSubagent();
    }
  });

  test("prefers recorded task_started description over agent-type SubagentStart labels", async () => {
    const client = new ClaudeAgentClient();
    const seenTasks: string[] = [];

    const unsubscribe = client.on("subagent.start", (event) => {
      const data = event.data as { task?: string };
      if (typeof data.task === "string") {
        seenTasks.push(data.task);
      }
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
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});
      const state = {
        sdkSessionId: null,
        inputTokens: 0,
        outputTokens: 0,
        hasEmittedStreamingUsage: false,
      };

      privateClient.processMessage(
        {
          type: "system",
          subtype: "task_started",
          tool_use_id: "parent-task-use-id",
          description: "Investigate why sub-agent root labels regress",
        },
        "wrapped-session-id",
        state,
      );

      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      expect(subagentStartHook).toBeDefined();

      await subagentStartHook?.(
        {
          session_id: "sdk-main-session",
          agent_id: "agent-1",
          agent_type: "debugger",
          description: "debugger",
          tool_use_id: "subagent-start-use-id",
          parent_tool_use_id: "parent-task-use-id",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      expect(seenTasks).toEqual(["Investigate why sub-agent root labels regress"]);

      await wrappedSession.destroy();
    } finally {
      unsubscribe();
    }
  });

  test("emits skill.invoked from PreToolUse when Claude Skill tool runs", async () => {
    const client = new ClaudeAgentClient();
    const invocations: Array<{
      sessionId: string;
      skillName?: string;
      skillPath?: string;
    }> = [];

    const unsubscribe = client.on("skill.invoked", (event) => {
      const data = event.data as { skillName?: string; skillPath?: string };
      invocations.push({
        sessionId: event.sessionId,
        skillName: data.skillName,
        skillPath: data.skillPath,
      });
    });

    try {
      const privateClient = client as unknown as {
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
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});
      const preToolUseHook = privateClient.registeredHooks.PreToolUse?.[0];
      expect(preToolUseHook).toBeDefined();

      await preToolUseHook?.(
        {
          session_id: "sdk-skill-session",
          tool_name: "Skill",
          tool_input: {
            name: "explain-code",
            path: "/tmp/skills/explain-code/SKILL.md",
          },
        },
        "skill_tool_use_1",
        { signal: new AbortController().signal },
      );

      await preToolUseHook?.(
        {
          session_id: "sdk-skill-session",
          tool_name: "Read",
          tool_input: { file_path: "README.md" },
        },
        "read_tool_use_1",
        { signal: new AbortController().signal },
      );

      expect(invocations).toEqual([
        {
          sessionId: "wrapped-session-id",
          skillName: "explain-code",
          skillPath: "/tmp/skills/explain-code/SKILL.md",
        },
      ]);

      await wrappedSession.destroy();
    } finally {
      unsubscribe();
    }
  });

  test("maps child-session tool hooks to subagents when SubagentStart omits tool use IDs", async () => {
    const client = new ClaudeAgentClient();
    const seenParentAgentIds: Array<string | undefined> = [];

    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { parentAgentId?: string };
      seenParentAgentIds.push(data.parentAgentId);
    });
    const unsubSubagent = client.on("subagent.start", () => {});

    try {
      const privateClient = client as unknown as {
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
        wrapQuery: (
          queryInstance: null,
          sessionId: string,
          config: Record<string, unknown>,
        ) => { destroy: () => Promise<void> };
      };

      const wrappedSession = privateClient.wrapQuery(null, "wrapped-session-id", {});
      const subagentStartHook = privateClient.registeredHooks.SubagentStart?.[0];
      const preToolUseHook = privateClient.registeredHooks.PreToolUse?.[0];
      expect(subagentStartHook).toBeDefined();
      expect(preToolUseHook).toBeDefined();

      await subagentStartHook?.(
        {
          session_id: "sdk-main-session",
          agent_id: "agent-child-1",
          agent_type: "researcher",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      await preToolUseHook?.(
        {
          session_id: "sdk-child-session-1",
          tool_name: "WebSearch",
          tool_input: { query: "bm25 fundamentals" },
          tool_use_id: "child-tool-1",
        },
        undefined,
        { signal: new AbortController().signal },
      );

      expect(seenParentAgentIds).toContain("agent-child-1");

      await wrappedSession.destroy();
    } finally {
      unsubTool();
      unsubSubagent();
    }
  });

  test("binds concurrent hook session IDs deterministically via pending queue", async () => {
    const client = new ClaudeAgentClient();

    const privateClient = client as unknown as {
      wrapQuery: (
        queryInstance: null,
        sessionId: string,
        config: Record<string, unknown>,
      ) => { destroy: () => Promise<void> };
      pendingHookSessionBindings: string[];
      resolveHookSessionId: (sdkSessionId: string) => string;
      sessions: Map<string, { sdkSessionId: string | null }>;
    };

    const sessionA = privateClient.wrapQuery(null, "wrapped-a", {});
    const sessionB = privateClient.wrapQuery(null, "wrapped-b", {});
    const stateA = privateClient.sessions.get("wrapped-a") as
      | { query?: { close?: () => void } }
      | undefined;
    const stateB = privateClient.sessions.get("wrapped-b") as
      | { query?: { close?: () => void } }
      | undefined;
    if (stateA) stateA.query = { close: () => {} };
    if (stateB) stateB.query = { close: () => {} };
    privateClient.pendingHookSessionBindings.push("wrapped-a", "wrapped-b");

    try {
      const mappedA = privateClient.resolveHookSessionId("sdk-a");
      const mappedB = privateClient.resolveHookSessionId("sdk-b");

      expect(mappedA).toBe("wrapped-a");
      expect(mappedB).toBe("wrapped-b");
      expect(privateClient.sessions.get("wrapped-a")?.sdkSessionId).toBe("sdk-a");
      expect(privateClient.sessions.get("wrapped-b")?.sdkSessionId).toBe("sdk-b");
    } finally {
      await sessionA.destroy();
      await sessionB.destroy();
    }
  });
});
