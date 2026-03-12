import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

describe("OpenCodeClient SSE diagnostics markers", () => {
  test("processEventStream emits diagnostics usage marker for filtered SSE events", async () => {
    const client = new OpenCodeClient();
    const usageMarkers: Array<Record<string, unknown>> = [];

    const unsubUsage = client.on("usage", (event) => {
      usageMarkers.push(event.data as Record<string, unknown>);
    });

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "message.part.delta", properties: { sessionID: "ses_filtered_marker", delta: "drop me" } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubUsage();
    expect(usageMarkers).toContainEqual({
      provider: "opencode",
      marker: "opencode.sse.diagnostics",
      counter: "sse.event.filtered.count",
      value: 1,
    });
  });

  test("processEventStream emits diagnostics usage marker when watchdog abort stops stream", async () => {
    const client = new OpenCodeClient();
    const usageMarkers: Array<Record<string, unknown>> = [];

    const unsubUsage = client.on("usage", (event) => {
      usageMarkers.push(event.data as Record<string, unknown>);
    });

    const watchdogAbort = new AbortController();
    watchdogAbort.abort();

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "session.created", properties: { info: { id: "ses_abort_marker" } } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, watchdogAbort);

    unsubUsage();
    expect(usageMarkers).toContainEqual({
      provider: "opencode",
      marker: "opencode.sse.diagnostics",
      counter: "sse.abort.watchdog.count",
      value: 1,
    });
  });

  test("processEventStream emits diagnostics usage marker when global abort stops stream", async () => {
    const client = new OpenCodeClient();
    const usageMarkers: Array<Record<string, unknown>> = [];
    const globalAbort = new AbortController();
    globalAbort.abort();

    const unsubUsage = client.on("usage", (event) => {
      usageMarkers.push(event.data as Record<string, unknown>);
    });

    (client as unknown as { eventSubscriptionController: AbortController | null }).eventSubscriptionController = globalAbort;

    const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {
      yield { type: "session.created", properties: { info: { id: "ses_global_abort_marker" } } };
    })();

    await (client as unknown as {
      processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
    }).processEventStream(stream, new AbortController());

    unsubUsage();
    expect(usageMarkers).toContainEqual({
      provider: "opencode",
      marker: "opencode.sse.diagnostics",
      counter: "sse.abort.global.count",
      value: 1,
    });
  });

  test("processEventStream emits watchdog-timeout diagnostics marker", async () => {
    const client = new OpenCodeClient();
    const usageMarkers: Array<Record<string, unknown>> = [];

    const unsubUsage = client.on("usage", (event) => {
      usageMarkers.push(event.data as Record<string, unknown>);
    });

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalDateNow = Date.now;
    let nowCall = 0;

    (Date as unknown as { now: () => number }).now = () => {
      nowCall += 1;
      return nowCall <= 2 ? 0 : 15_001;
    };
    (globalThis as unknown as { setTimeout: (...args: unknown[]) => unknown }).setTimeout = (callback: unknown) => {
      if (typeof callback === "function") {
        (callback as () => void)();
      }
      return 1;
    };
    (globalThis as unknown as { clearTimeout: (...args: unknown[]) => void }).clearTimeout = () => {};

    try {
      const stream = (async function* (): AsyncGenerator<unknown, void, unknown> {})();
      await (client as unknown as {
        processEventStream: (eventStream: AsyncGenerator<unknown, void, unknown>, watchdogAbort: AbortController) => Promise<void>;
      }).processEventStream(stream, new AbortController());
    } finally {
      (Date as unknown as { now: () => number }).now = originalDateNow;
      (globalThis as unknown as { setTimeout: (...args: unknown[]) => unknown }).setTimeout =
        originalSetTimeout as unknown as (...args: unknown[]) => unknown;
      (globalThis as unknown as { clearTimeout: (...args: unknown[]) => void }).clearTimeout =
        originalClearTimeout as unknown as (...args: unknown[]) => void;
      unsubUsage();
    }

    expect(usageMarkers).toContainEqual({
      provider: "opencode",
      marker: "opencode.sse.diagnostics",
      counter: "sse.watchdog.timeout.count",
      value: 1,
    });
  });
});
