import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "@/services/agents/clients/opencode.ts";

describe("OpenCodeClient SSE abort propagation", () => {
  test("composed abort signal aborts when watchdog aborts", async () => {
    const client = new OpenCodeClient();
    const globalAbort = new AbortController();
    let subscribeSignal: AbortSignal | undefined;
    let usedWatchdog: AbortController | undefined;

    const internal = client as unknown as {
      isRunning: boolean;
      eventSubscriptionController: AbortController | null;
      sdkClient: {
        event: {
          subscribe: (
            parameters?: { directory?: string },
            options?: { signal?: AbortSignal },
          ) => Promise<{ stream: AsyncGenerator<unknown, unknown, unknown> }>;
        };
      } | null;
      processEventStream: (
        stream: AsyncGenerator<unknown, unknown, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
      runEventLoop: () => Promise<void>;
    };

    internal.isRunning = true;
    internal.eventSubscriptionController = globalAbort;
    internal.sdkClient = {
      event: {
        subscribe: async (_parameters, options) => {
          subscribeSignal = options?.signal;
          return {
            stream: (async function* () {})(),
          };
        },
      },
    };

    internal.processEventStream = async (_stream, watchdogAbort) => {
      usedWatchdog = watchdogAbort;
      watchdogAbort.abort();
      expect(globalAbort.signal.aborted).toBe(false);
      globalAbort.abort();
    };

    await internal.runEventLoop();

    expect(subscribeSignal).toBeDefined();
    expect(subscribeSignal).not.toBe(globalAbort.signal);
    expect(usedWatchdog?.signal.aborted).toBe(true);
    expect(subscribeSignal?.aborted).toBe(true);
  });

  test("composed abort signal aborts when global controller aborts", async () => {
    const client = new OpenCodeClient();
    const globalAbort = new AbortController();
    let subscribeSignal: AbortSignal | undefined;
    let usedWatchdog: AbortController | undefined;

    const internal = client as unknown as {
      isRunning: boolean;
      eventSubscriptionController: AbortController | null;
      sdkClient: {
        event: {
          subscribe: (
            parameters?: { directory?: string },
            options?: { signal?: AbortSignal },
          ) => Promise<{ stream: AsyncGenerator<unknown, unknown, unknown> }>;
        };
      } | null;
      processEventStream: (
        stream: AsyncGenerator<unknown, unknown, unknown>,
        watchdogAbort: AbortController,
      ) => Promise<void>;
      runEventLoop: () => Promise<void>;
    };

    internal.isRunning = true;
    internal.eventSubscriptionController = globalAbort;
    internal.sdkClient = {
      event: {
        subscribe: async (_parameters, options) => {
          subscribeSignal = options?.signal;
          return {
            stream: (async function* () {})(),
          };
        },
      },
    };

    internal.processEventStream = async (_stream, watchdogAbort) => {
      usedWatchdog = watchdogAbort;
      globalAbort.abort();
    };

    await internal.runEventLoop();

    expect(subscribeSignal).toBeDefined();
    expect(subscribeSignal).not.toBe(globalAbort.signal);
    expect(usedWatchdog?.signal.aborted).toBe(false);
    expect(subscribeSignal?.aborted).toBe(true);
  });
});
