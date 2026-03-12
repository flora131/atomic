import { describe, expect, mock, test } from "bun:test";
import type { EventPermissionAsked, EventQuestionAsked } from "@opencode-ai/sdk/v2/client";
import {
  handleOpenCodePermissionAsked,
  handleOpenCodeQuestionAsked,
} from "@/services/agents/clients/opencode/event-interaction-handlers.ts";

function createPermissionEvent(permission: string, sessionID = "child-session"): EventPermissionAsked {
  return {
    type: "permission.asked",
    properties: {
      id: "permission-request-1",
      sessionID,
      permission,
      always: false,
      patterns: [permission],
      metadata: { target: permission },
      tool: { callID: "tool-call-1" },
    },
  } as unknown as EventPermissionAsked;
}

function createQuestionEvent(sessionID = "child-session"): EventQuestionAsked {
  return {
    type: "question.asked",
    properties: {
      id: "question-request-1",
      sessionID,
      tool: { callID: "tool-call-2" },
      questions: [{
        header: "Favorite color",
        question: "What is your favorite color?",
        options: [
          { label: "Blue", description: "A classic cool color" },
          { label: "Green", description: "A natural balanced color" },
        ],
        multiple: false,
      }],
    },
  } as unknown as EventQuestionAsked;
}

describe("handleOpenCodePermissionAsked", () => {
  test("auto-rejects permissions disabled by sub-agent frontmatter", async () => {
    const reply = mock(() => Promise.resolve());
    const emitEvent = mock(() => {});
    const emitProviderEvent = mock(() => {});

    handleOpenCodePermissionAsked(createPermissionEvent("docs_lookup"), {
      sdkClient: {
        permission: { reply },
      } as never,
      directory: "/tmp/project",
      sessionStateSupport: {} as never,
      resolveAutoDenyForPermission: () => ({
        parentSessionId: "parent-session",
        subagentName: "debugger",
      }),
      emitEvent,
      emitProviderEvent,
    });

    await Promise.resolve();

    expect(reply).toHaveBeenCalledWith({
      requestID: "permission-request-1",
      directory: "/tmp/project",
      reply: "reject",
    });
    expect(emitEvent).toHaveBeenCalledWith("session.warning", "parent-session", {
      warningType: "permission_denied",
      message: "Auto-denied docs_lookup because it is disabled in the debugger sub-agent frontmatter.",
    });
  });

  test("emits an interactive permission request when the tool is not auto-denied", () => {
    const reply = mock(() => Promise.resolve());
    const emitEvent = mock(() => {});
    const emitProviderEvent = mock(() => {});

    handleOpenCodePermissionAsked(createPermissionEvent("read"), {
      sdkClient: {
        permission: { reply },
      } as never,
      directory: "/tmp/project",
      sessionStateSupport: {
        mapOpenCodePermissionReply: () => "once",
      } as never,
      resolveAutoDenyForPermission: () => null,
      emitEvent,
      emitProviderEvent,
    });

    expect(emitEvent).toHaveBeenCalledWith(
      "permission.requested",
      "child-session",
      expect.objectContaining({
        toolName: "read",
        toolCallId: "tool-call-1",
      }),
    );
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("handleOpenCodeQuestionAsked", () => {
  test("emits a provider-backed human input request with tool correlation", async () => {
    const reply = mock(() => Promise.resolve());
    const emitEvent = mock(() => {});
    const emitProviderEvent = mock(() => {});

    handleOpenCodeQuestionAsked(createQuestionEvent(), {
      sdkClient: {
        question: { reply },
      } as never,
      directory: "/tmp/project",
      emitEvent,
      emitProviderEvent,
    });

    expect(emitEvent).toHaveBeenCalledWith(
      "human_input_required",
      "child-session",
      expect.objectContaining({
        requestId: "question-request-1",
        question: "What is your favorite color?",
        toolCallId: "tool-call-2",
        respond: expect.any(Function),
      }),
    );

    const emitEventCalls = emitEvent.mock.calls as unknown as Array<
      [string, string, { respond?: (answer: string | string[]) => void }]
    >;
    const providerData = emitEventCalls[0]?.[2];
    providerData?.respond?.("Blue");
    await Promise.resolve();

    expect(reply).toHaveBeenCalledWith({
      requestID: "question-request-1",
      directory: "/tmp/project",
      answers: [["Blue"]],
    });
  });
});
