import { describe, expect, test } from "bun:test";
import { createOpenCodeClient, emitOpenCodeSdkEvent } from "./opencode.events.mapping.test-support.ts";

describe("OpenCodeClient event mapping", () => {
  test("emits thinking source identity for reasoning deltas", () => {
    const client = createOpenCodeClient();
    const deltas: Array<{ sessionId: string; delta?: string; contentType?: string; thinkingSourceKey?: string }> = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string; contentType?: string; thinkingSourceKey?: string };
      deltas.push({
        sessionId: event.sessionId,
        delta: data.delta,
        contentType: data.contentType,
        thinkingSourceKey: data.thinkingSourceKey,
      });
    });

    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning_part_1",
          sessionID: "ses_reasoning",
          messageID: "msg_reasoning",
          type: "reasoning",
        },
      },
    });
    emitOpenCodeSdkEvent(client, {
      type: "message.part.delta",
      properties: {
        partID: "reasoning_part_1",
        sessionID: "ses_reasoning",
        delta: "inspect constraints",
      },
    });

    unsubscribe();

    expect(deltas).toEqual([
      {
        sessionId: "ses_reasoning",
        delta: "inspect constraints",
        contentType: "thinking",
        thinkingSourceKey: "reasoning_part_1",
      },
    ]);
  });

  test("recognizes reasoning deltas when message.part.delta uses camelCase partId", () => {
    const client = createOpenCodeClient();
    const deltas: Array<{ sessionId: string; delta?: string; contentType?: string; thinkingSourceKey?: string }> = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string; contentType?: string; thinkingSourceKey?: string };
      deltas.push({
        sessionId: event.sessionId,
        delta: data.delta,
        contentType: data.contentType,
        thinkingSourceKey: data.thinkingSourceKey,
      });
    });

    emitOpenCodeSdkEvent(client, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning_part_camel",
          sessionID: "ses_reasoning_camel",
          messageID: "msg_reasoning_camel",
          type: "reasoning",
        },
      },
    });
    emitOpenCodeSdkEvent(client, {
      type: "message.part.delta",
      properties: {
        partId: "reasoning_part_camel",
        field: "text",
        sessionID: "ses_reasoning_camel",
        delta: "camelcase part id reasoning",
      },
    });

    unsubscribe();

    expect(deltas).toEqual([
      {
        sessionId: "ses_reasoning_camel",
        delta: "camelcase part id reasoning",
        contentType: "thinking",
        thinkingSourceKey: "reasoning_part_camel",
      },
    ]);
  });

  test("ignores message.part.delta updates for non-text fields", () => {
    const client = createOpenCodeClient();
    const deltas: string[] = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string };
      if (typeof data.delta === "string") {
        deltas.push(data.delta);
      }
    });

    emitOpenCodeSdkEvent(client, {
      type: "message.part.delta",
      properties: {
        partID: "part_non_text_field",
        field: "status",
        sessionID: "ses_non_text_field",
        delta: "should not emit",
      },
    });

    unsubscribe();

    expect(deltas).toEqual([]);
  });

  test("classifies inline reasoning message.part.delta payloads as thinking", () => {
    const client = createOpenCodeClient();
    const deltas: Array<{ contentType?: string; thinkingSourceKey?: string; delta?: string }> = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as { delta?: string; contentType?: string; thinkingSourceKey?: string };
      deltas.push({
        contentType: data.contentType,
        thinkingSourceKey: data.thinkingSourceKey,
        delta: data.delta,
      });
    });

    emitOpenCodeSdkEvent(client, {
      type: "message.part.delta",
      properties: {
        sessionID: "ses_inline_reasoning",
        delta: "inline reasoning payload",
        part: { id: "reasoning_inline_1", type: "reasoning" },
      },
    });

    unsubscribe();

    expect(deltas).toEqual([
      {
        contentType: "thinking",
        thinkingSourceKey: "reasoning_inline_1",
        delta: "inline reasoning payload",
      },
    ]);
  });

  test("maps structured session.error payloads to readable error strings", () => {
    const client = createOpenCodeClient();
    const errors: Array<{ sessionId: string; error: unknown }> = [];

    const unsubscribe = client.on("session.error", (event) => {
      errors.push({ sessionId: event.sessionId, error: (event.data as { error?: unknown }).error });
    });

    emitOpenCodeSdkEvent(client, {
      type: "session.error",
      properties: {
        sessionID: "ses_structured_error",
        error: { message: "Rate limit exceeded", code: "RATE_LIMIT" },
      },
    });

    unsubscribe();

    expect(errors).toEqual([{ sessionId: "ses_structured_error", error: "Rate limit exceeded" }]);
  });

  test("maps session.error info.id payloads and extracts top-level stderr text", () => {
    const client = createOpenCodeClient();
    const errors: Array<{ sessionId: string; error: unknown }> = [];

    const unsubscribe = client.on("session.error", (event) => {
      errors.push({ sessionId: event.sessionId, error: (event.data as { error?: unknown }).error });
    });

    emitOpenCodeSdkEvent(client, {
      type: "session.error",
      error: { stderr: "OpenCode process exited with code 1" },
      properties: { info: { id: "ses_error_info_id" } },
    });

    unsubscribe();

    expect(errors).toEqual([
      {
        sessionId: "ses_error_info_id",
        error: "OpenCode process exited with code 1",
      },
    ]);
  });
});
