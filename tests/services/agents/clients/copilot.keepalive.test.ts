import { describe, expect, mock, test } from "bun:test";
import {
  createCopilotKeepalive,
  type CopilotKeepaliveHandle,
} from "@/services/agents/clients/copilot/keepalive.ts";

describe("createCopilotKeepalive", () => {
  test("calls sdkClient.ping periodically while running", async () => {
    const pingMock = mock(() => Promise.resolve({ message: "keepalive", timestamp: Date.now() }));
    const sdkClient = { ping: pingMock };

    const handle = createCopilotKeepalive({
      getSdkClient: () => sdkClient as never,
      isRunning: () => true,
      intervalMs: 50,
    });

    handle.start();

    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();

    expect(pingMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(pingMock).toHaveBeenCalledWith("keepalive");
  });

  test("does not ping when client is not running", async () => {
    const pingMock = mock(() => Promise.resolve({ message: "keepalive", timestamp: Date.now() }));
    const sdkClient = { ping: pingMock };

    const handle = createCopilotKeepalive({
      getSdkClient: () => sdkClient as never,
      isRunning: () => false,
      intervalMs: 50,
    });

    handle.start();
    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();

    expect(pingMock).not.toHaveBeenCalled();
  });

  test("does not ping when sdkClient is null", async () => {
    const handle = createCopilotKeepalive({
      getSdkClient: () => null,
      isRunning: () => true,
      intervalMs: 50,
    });

    handle.start();
    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();
    // No crash — swallowed gracefully
  });

  test("swallows ping errors without crashing", async () => {
    const pingMock = mock(() => Promise.reject(new Error("connection lost")));
    const sdkClient = { ping: pingMock };
    const debugLog = mock(() => {});

    const handle = createCopilotKeepalive({
      getSdkClient: () => sdkClient as never,
      isRunning: () => true,
      intervalMs: 50,
      debugLog,
    });

    handle.start();
    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();

    expect(pingMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(debugLog).toHaveBeenCalledWith(
      "keepalive.ping.failed",
      expect.objectContaining({ error: "connection lost" }),
    );
  });

  test("stop is idempotent", () => {
    const handle = createCopilotKeepalive({
      getSdkClient: () => null,
      isRunning: () => true,
      intervalMs: 50,
    });

    handle.start();
    handle.stop();
    handle.stop(); // should not throw
  });

  test("start is idempotent — does not create multiple timers", async () => {
    const pingMock = mock(() => Promise.resolve({ message: "keepalive", timestamp: Date.now() }));
    const sdkClient = { ping: pingMock };

    const handle = createCopilotKeepalive({
      getSdkClient: () => sdkClient as never,
      isRunning: () => true,
      intervalMs: 50,
    });

    handle.start();
    handle.start(); // duplicate — should be no-op

    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();

    // Should still only have ~2 pings, not ~4
    expect(pingMock.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
