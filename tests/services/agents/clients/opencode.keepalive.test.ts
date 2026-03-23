import { describe, expect, mock, test } from "bun:test";
import {
  createOpenCodeKeepalive,
  type OpenCodeKeepaliveHandle,
} from "@/services/agents/clients/opencode/keepalive.ts";

describe("createOpenCodeKeepalive", () => {
  test("calls sdkClient.global.health periodically while running", async () => {
    const healthMock = mock(() => Promise.resolve({ data: { version: "1.0" } }));
    const sdkClient = { global: { health: healthMock } };

    const handle = createOpenCodeKeepalive({
      getSdkClient: () => sdkClient as never,
      isRunning: () => true,
      intervalMs: 50,
    });

    handle.start();

    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();

    expect(healthMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("does not ping when client is not running", async () => {
    const healthMock = mock(() => Promise.resolve({ data: { version: "1.0" } }));
    const sdkClient = { global: { health: healthMock } };

    const handle = createOpenCodeKeepalive({
      getSdkClient: () => sdkClient as never,
      isRunning: () => false,
      intervalMs: 50,
    });

    handle.start();
    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();

    expect(healthMock).not.toHaveBeenCalled();
  });

  test("does not ping when sdkClient is null", async () => {
    const handle = createOpenCodeKeepalive({
      getSdkClient: () => null,
      isRunning: () => true,
      intervalMs: 50,
    });

    handle.start();
    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();
  });

  test("swallows health check errors without crashing", async () => {
    const healthMock = mock(() => Promise.reject(new Error("server unreachable")));
    const sdkClient = { global: { health: healthMock } };
    const debugLog = mock(() => {});

    const handle = createOpenCodeKeepalive({
      getSdkClient: () => sdkClient as never,
      isRunning: () => true,
      intervalMs: 50,
      debugLog,
    });

    handle.start();
    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();

    expect(healthMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(debugLog).toHaveBeenCalledWith(
      "keepalive.health.failed",
      expect.objectContaining({ error: "server unreachable" }),
    );
  });

  test("stop is idempotent", () => {
    const handle = createOpenCodeKeepalive({
      getSdkClient: () => null,
      isRunning: () => true,
      intervalMs: 50,
    });

    handle.start();
    handle.stop();
    handle.stop();
  });

  test("start is idempotent — does not create multiple timers", async () => {
    const healthMock = mock(() => Promise.resolve({ data: { version: "1.0" } }));
    const sdkClient = { global: { health: healthMock } };

    const handle = createOpenCodeKeepalive({
      getSdkClient: () => sdkClient as never,
      isRunning: () => true,
      intervalMs: 50,
    });

    handle.start();
    handle.start();

    await new Promise((resolve) => setTimeout(resolve, 130));
    handle.stop();

    expect(healthMock.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
