import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

describe("OpenCodeClient SSE session filtering", () => {
  test("processEventStream filters non-lifecycle events for inactive sessions", async () => {
    const client = new OpenCodeClient();
    const deltas: string[] = [];
    const starts: string[] = [];

    const unsubDelta = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string };
      if (typeof data.delta === "string") {
        deltas.push(data.delta);
      }
    });
    const unsubStart = client.on("session.start", (event) => {
      starts.push(event.sessionId);
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void }).registerActiveSession("ses_active");

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "message.part.delta", properties: { sessionID: "ses_inactive", delta: "inactive output" } };
      yield { type: "message.part.delta", properties: { sessionID: "ses_active", delta: "active output" } };
      yield { type: "session.created", properties: { info: { id: "ses_created" } } };
      yield { type: "message.part.delta", properties: { sessionID: "ses_created", delta: "created output" } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubDelta();
    unsubStart();
    expect(deltas).toEqual(["active output", "created output"]);
    expect(starts).toContain("ses_created");
  });

  test("processEventStream allows lifecycle events for inactive sessions", async () => {
    const client = new OpenCodeClient();
    const idles: string[] = [];
    const deltas: string[] = [];

    const unsubIdle = client.on("session.idle", (event) => {
      idles.push(event.sessionId);
    });
    const unsubDelta = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string };
      if (typeof data.delta === "string") {
        deltas.push(data.delta);
      }
    });

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "session.status", properties: { sessionID: "ses_lifecycle_only", status: "idle" } };
      yield { type: "message.part.delta", properties: { sessionID: "ses_filtered_only", delta: "should be filtered" } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubIdle();
    unsubDelta();
    expect(idles).toEqual(["ses_lifecycle_only"]);
    expect(deltas).toEqual([]);
  });

  test("processEventStream allows unknown child message.part.updated events in single-session mode", async () => {
    const client = new OpenCodeClient();
    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const toolStarts: Array<{ sessionId: string; toolName?: string }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });
    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string };
      toolStarts.push({ sessionId: event.sessionId, toolName: data.toolName });
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void }).registerActiveSession("ses_parent");
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "message.updated", properties: { info: { id: "msg_parent", sessionID: "ses_parent", role: "assistant" } } };
      yield { type: "message.part.updated", properties: { sessionID: "ses_parent", part: { id: "agent_1", sessionID: "ses_parent", messageID: "msg_parent", type: "agent", name: "worker" } } };
      yield { type: "message.part.updated", properties: { part: { id: "tool_child_1", sessionID: "ses_child", messageID: "msg_child_1", type: "tool", tool: "Read", state: { status: "pending", input: { filePath: "src/screens/chat-screen.tsx" } } } } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubStart();
    unsubTool();
    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual({ subagentId: "agent_1", subagentSessionId: undefined });
    expect(starts[1]).toEqual({ subagentId: "agent_1", subagentSessionId: "ses_child" });
    expect(toolStarts).toContainEqual({ sessionId: "ses_child", toolName: "Read" });
  });

  test("processEventStream allows unknown child message.part.updated events in parallel-session mode", async () => {
    const client = new OpenCodeClient();
    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const toolStarts: Array<{ sessionId: string; toolName?: string }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });
    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string };
      toolStarts.push({ sessionId: event.sessionId, toolName: data.toolName });
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void }).registerActiveSession("ses_parent");
    (client as unknown as { registerActiveSession: (sessionId: string) => void }).registerActiveSession("ses_other_active");
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "message.updated", properties: { info: { id: "msg_parent_parallel", sessionID: "ses_parent", role: "assistant" } } };
      yield { type: "message.part.updated", properties: { sessionID: "ses_parent", part: { id: "agent_parallel_1", sessionID: "ses_parent", messageID: "msg_parent_parallel", type: "agent", name: "worker" } } };
      yield { type: "message.part.updated", properties: { part: { id: "tool_parallel_child_1", sessionID: "ses_parallel_child", messageID: "msg_parallel_child_1", type: "tool", tool: "Glob", state: { status: "pending", input: { path: "src/**/*.tsx" } } } } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubStart();
    unsubTool();
    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual({ subagentId: "agent_parallel_1", subagentSessionId: undefined });
    expect(starts[1]).toEqual({ subagentId: "agent_parallel_1", subagentSessionId: "ses_parallel_child" });
    expect(toolStarts).toContainEqual({ sessionId: "ses_parallel_child", toolName: "Glob" });
  });

  test("processEventStream allows unknown child message.part.delta events while the parent session is active", async () => {
    const client = new OpenCodeClient();
    const deltas: Array<{ sessionId: string; delta?: string }> = [];

    const unsubDelta = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string };
      deltas.push({ sessionId: event.sessionId, delta: data.delta });
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void }).registerActiveSession("ses_parent_delta");
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent_delta";

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "message.part.delta", properties: { sessionID: "ses_child_delta", messageID: "msg_child_delta", partID: "part_child_delta", field: "text", delta: "child session response" } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubDelta();
    expect(deltas).toEqual([{ sessionId: "ses_child_delta", delta: "child session response" }]);
  });

  test("processEventStream allows unknown child message.updated events while the parent session is active", async () => {
    const client = new OpenCodeClient();
    const completes: Array<{ role?: string; sessionId: string }> = [];

    const unsubComplete = client.on("message.complete", (event) => {
      const data = event.data as { message?: { role?: string } };
      completes.push({ sessionId: event.sessionId, role: data.message?.role });
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void }).registerActiveSession("ses_parent_updated");
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent_updated";

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "message.updated", properties: { info: { id: "msg_child_updated", sessionID: "ses_child_updated", role: "assistant" } } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubComplete();
    expect(completes).toEqual([{ sessionId: "ses_child_updated", role: "assistant" }]);
  });

  test("session.deleted unregisters active sessions for subsequent SSE filtering", async () => {
    const client = new OpenCodeClient();
    const deltas: string[] = [];

    const unsubDelta = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string };
      if (typeof data.delta === "string") {
        deltas.push(data.delta);
      }
    });

    (client as unknown as { registerActiveSession: (sessionId: string) => void }).registerActiveSession("ses_deleted");

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "session.deleted", properties: { sessionID: "ses_deleted" } };
      yield { type: "message.part.delta", properties: { sessionID: "ses_deleted", delta: "should be dropped" } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubDelta();
    expect(deltas).toEqual([]);
  });
});
