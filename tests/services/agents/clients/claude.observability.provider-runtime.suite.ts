import { describe, expect, test } from "bun:test";
import { ClaudeAgentClient } from "@/services/agents/clients/index.ts";

describe("ClaudeAgentClient observability and parity", () => {
  test("preserves nativeType and native payload on bridged provider events", () => {
    const client = new ClaudeAgentClient();
    const providerEvents: Array<Record<string, unknown>> = [];

    client.onProviderEvent((event) => {
      providerEvents.push(event as unknown as Record<string, unknown>);
    });

    (
      client as unknown as {
        emitEvent: (
          eventType: "session.error",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      }
    ).emitEvent("session.error", "session-provider", {
      error: "boom",
      code: "TEST",
    });

    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]!.type).toBe("session.error");
    expect(providerEvents[0]!.nativeType).toBe("session.error");
    expect((providerEvents[0]!.native as { type: string }).type).toBe("session.error");
  });

  test("captures Claude native subtype and metadata on provider events", () => {
    const client = new ClaudeAgentClient();
    const providerEvents: Array<Record<string, unknown>> = [];

    client.onProviderEvent((event) => {
      providerEvents.push(event as unknown as Record<string, unknown>);
    });

    (
      client as unknown as {
        emitProviderEvent: (
          eventType: "session.compaction",
          sessionId: string,
          data: Record<string, unknown>,
          options: {
            native: Record<string, unknown>;
            nativeSessionId: string;
            nativeEventId: string;
          },
        ) => void;
      }
    ).emitProviderEvent(
      "session.compaction",
      "session-native",
      {
        phase: "start",
      },
      {
        native: {
          type: "system",
          subtype: "status",
          session_id: "sdk-session",
          uuid: "uuid-123",
          status: "compacting",
        },
        nativeSessionId: "sdk-session",
        nativeEventId: "uuid-123",
      },
    );

    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]!.nativeSubtype).toBe("status");
    expect(providerEvents[0]!.nativeMeta).toEqual({
      nativeSessionId: "sdk-session",
      nativeMessageId: "uuid-123",
    });
  });

  test("emits v1 runtime selection marker through unified usage events", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      (
        client as unknown as {
          emitRuntimeSelection: (
            sessionId: string,
            operation: "create" | "resume" | "send" | "stream" | "summarize",
          ) => void;
        }
      ).emitRuntimeSelection("session-runtime", "send");

      expect(usageEvents).toEqual([
        {
          provider: "claude",
          marker: "claude.runtime.selected",
          runtimeMode: "v1",
          operation: "send",
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("emits create runtime marker through unified usage event pipeline", () => {
    const client = new ClaudeAgentClient();
    const usageEvents: Array<Record<string, unknown>> = [];

    const unsubscribe = client.on("usage", (event) => {
      usageEvents.push(event.data as Record<string, unknown>);
    });

    try {
      (
        client as unknown as {
          emitRuntimeSelection: (
            sessionId: string,
            operation: "create" | "resume" | "send" | "stream" | "summarize",
          ) => void;
        }
      ).emitRuntimeSelection("session-create", "create");

      expect(usageEvents).toEqual([
        {
          provider: "claude",
          marker: "claude.runtime.selected",
          runtimeMode: "v1",
          operation: "create",
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("does not bind session.error handlers to Stop hooks", () => {
    const client = new ClaudeAgentClient();
    const seenErrors: string[] = [];

    const unsubscribe = client.on("session.error", (event) => {
      const data = event.data as { error?: Error | string };
      const errorValue = data.error;
      seenErrors.push(
        errorValue instanceof Error ? errorValue.message : String(errorValue),
      );
    });

    try {
      const privateClient = client as unknown as {
        registeredHooks: Record<string, Array<unknown> | undefined>;
        emitEvent: (
          eventType: "session.error",
          sessionId: string,
          data: Record<string, unknown>,
        ) => void;
      };

      expect(privateClient.registeredHooks.Stop).toBeUndefined();

      privateClient.emitEvent("session.error", "session-1", {
        error: "Maximum turns exceeded",
        code: "MAX_TURNS",
      });

      expect(seenErrors).toEqual(["Maximum turns exceeded"]);
    } finally {
      unsubscribe();
    }
  });
});
