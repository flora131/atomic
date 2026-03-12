import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

describe("OpenCodeClient event mapping", () => {
  test("maps step-finish part to subagent.complete for known sub-agents", () => {
    const client = new OpenCodeClient();
    const handleSdkEvent = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const completes: Array<{
      sessionId: string;
      subagentId?: string;
      success?: boolean;
      result?: string;
    }> = [];

    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as {
        subagentId?: string;
        success?: boolean;
        result?: string;
      };
      completes.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        success: data.success,
        result: data.result,
      });
    });

    handleSdkEvent({
      type: "message.updated",
      properties: {
        info: { id: "msg_step", sessionID: "ses_step", role: "assistant" },
      },
    });
    handleSdkEvent({
      type: "message.updated",
      properties: {
        info: { id: "msg_step_2", sessionID: "ses_step", role: "assistant" },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-1",
          sessionID: "ses_step",
          messageID: "msg_step",
          type: "agent",
          name: "explorer",
        },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-2",
          sessionID: "ses_step",
          messageID: "msg_step_2",
          type: "agent",
          name: "worker",
        },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-1",
          sessionID: "ses_step",
          messageID: "msg_step",
          type: "step-finish",
          reason: "success",
        },
      },
    });
    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-2",
          sessionID: "ses_step",
          messageID: "msg_step_2",
          type: "step-finish",
          reason: "error",
        },
      },
    });

    unsubComplete();

    expect(completes).toEqual([
      {
        sessionId: "ses_step",
        subagentId: "step-1",
        success: true,
        result: "success",
      },
      {
        sessionId: "ses_step",
        subagentId: "step-2",
        success: false,
        result: "error",
      },
    ]);
  });

  test("ignores step-finish for main-turn completion (no prior sub-agent registration)", () => {
    const client = new OpenCodeClient();
    const handleSdkEvent = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const completes: Array<{ subagentId?: string }> = [];

    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as { subagentId?: string };
      completes.push({ subagentId: data.subagentId });
    });

    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_main_turn_finish",
          sessionID: "ses_main",
          messageID: "msg_1",
          type: "step-finish",
          reason: "stop",
        },
      },
    });

    unsubComplete();

    expect(completes).toEqual([]);
  });

  test("requires a prior subagent.start before mapping step-finish to subagent.complete", () => {
    const client = new OpenCodeClient();
    const handleSdkEvent = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    const completes: Array<{ subagentId?: string }> = [];
    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as { subagentId?: string };
      completes.push({ subagentId: data.subagentId });
    });

    (
      client as unknown as {
        subagentStateByParentSession: Map<
          string,
          {
            pendingAgentParts: Array<{ partId: string; agentName: string }>;
            childSessionToAgentPart: Map<string, string>;
            startedSubagentIds: Set<string>;
            subagentToolCounts: Map<string, number>;
            pendingTaskToolPartIds: string[];
            queuedTaskToolPartIds: Set<string>;
          }
        >;
      }
    ).subagentStateByParentSession.set("ses_main", {
      pendingAgentParts: [{ partId: "prt_ghost_agent", agentName: "worker" }],
      childSessionToAgentPart: new Map([["ses_child", "prt_ghost_agent"]]),
      startedSubagentIds: new Set(),
      subagentToolCounts: new Map([["prt_ghost_agent", 2]]),
      pendingTaskToolPartIds: [],
      queuedTaskToolPartIds: new Set(),
    });

    handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_ghost_agent",
          sessionID: "ses_main",
          messageID: "msg_1",
          type: "step-finish",
          reason: "stop",
        },
      },
    });

    unsubComplete();

    expect(completes).toEqual([]);
  });
});
