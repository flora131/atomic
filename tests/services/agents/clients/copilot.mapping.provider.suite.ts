import { describe, expect, test } from "bun:test";
import { CopilotClient } from "@/services/agents/clients/copilot.ts";
import type { MessageCompleteEventData } from "@/services/agents/contracts/events.ts";
import type { CopilotProviderEvent } from "@/services/agents/provider-events/native-events.ts";
import { bindCopilotHandleSdkEvent } from "./copilot.mapping.test-support.ts";

describe("CopilotClient provider events", () => {
  test("preserves nativeType and native payload on provider events", () => {
    const client = new CopilotClient({});
    const providerEvents: CopilotProviderEvent[] = [];

    client.onProviderEvent((event) => {
      providerEvents.push(event);
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      id: "evt-1",
      timestamp: new Date(0).toISOString(),
      parentId: null,
      type: "assistant.message_delta",
      data: {
        deltaContent: "Hello world",
        messageId: "msg-123",
      },
    });

    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]!.type).toBe("message.delta");
    expect(providerEvents[0]!.nativeType).toBe("assistant.message_delta");
    expect((providerEvents[0]!.native as { type: string }).type).toBe("assistant.message_delta");
    expect(providerEvents[0]!.nativeMeta).toEqual({
      nativeEventId: "evt-1",
      nativeParentEventId: null,
      nativeMessageId: "msg-123",
    });
  });
});

describe("CopilotClient assistant.message preserves toolRequests", () => {
  test("handleSdkEvent passes toolRequests to message.complete event", () => {
    const client = new CopilotClient({});
    const events: Array<{ data: MessageCompleteEventData }> = [];

    client.on("message.complete", (event) => {
      events.push({ data: event.data });
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "assistant.message",
      data: {
        content: "Let me check that file.",
        messageId: "msg-001",
        interactionId: "int-001",
        phase: "final",
        reasoningText: "checked file state",
        reasoningOpaque: "opaque-reasoning",
        toolRequests: [
          { toolCallId: "tc-1", name: "view", arguments: { path: "/tmp/file.txt" } },
        ],
      },
    });

    expect(events).toHaveLength(1);
    const data = events[0]!.data;
    expect(data.message.content).toBe("Let me check that file.");
    expect(data.interactionId).toBe("int-001");
    expect(data.phase).toBe("final");
    expect(data.reasoningText).toBe("checked file state");
    expect(data.reasoningOpaque).toBe("opaque-reasoning");
    expect(data.toolRequests).toEqual([
      { toolCallId: "tc-1", name: "view", arguments: { path: "/tmp/file.txt" } },
    ]);
  });

  test("handleSdkEvent omits toolRequests when not present", () => {
    const client = new CopilotClient({});
    const events: Array<{ data: MessageCompleteEventData }> = [];

    client.on("message.complete", (event) => {
      events.push({ data: event.data });
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "assistant.message",
      data: {
        content: "Done!",
        messageId: "msg-002",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.data.toolRequests).toBeUndefined();
  });
});
