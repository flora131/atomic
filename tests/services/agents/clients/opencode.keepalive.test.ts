import { describe, expect, mock, test } from "bun:test";
import {
  createOpenCodeKeepalive,
  type OpenCodeKeepaliveHandle,
} from "@/services/agents/clients/opencode/keepalive.ts";

/**
 * Helper to build a minimal mock SDK client for OpenCode.
 * Uses client.global.health() (not client.ping).
 */
function buildMockSdkClient(overrides: {
  health?: () => Promise<{ data?: { version: string }; error?: unknown }>;
} = {}) {
  return {
    global: {
      health: overrides.health ?? mock(() =>
        Promise.resolve({ data: { version: "1.0" } }),
      ),
    },
  };
}

/**
 * Helper to build required args with sensible defaults.
 * Tests override only the properties they care about.
 */
function buildKeepaliveArgs(overrides: Record<string, unknown> = {}) {
  return {
    getSdkClient: () => null as never,
    isRunning: () => true,
    intervalMs: 10,
    ...overrides,
  };
}

/**
 * Poll until a mock has been called at least `minCalls` times.
 * Avoids flaky timing-based assertions.
 */
async function waitForCalls(
  mockFn: ReturnType<typeof mock>,
  minCalls: number,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (mockFn.mock.calls.length < minCalls) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for ${minCalls} calls (got ${mockFn.mock.calls.length})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Poll until a predicate is true.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for predicate");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

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

// ---------------------------------------------------------------
// New behaviors: onConnectionLost, consecutive failure tracking,
// connectionLostFired once-guard, and health check timeout.
// ---------------------------------------------------------------

describe("createOpenCodeKeepalive — connection-loss detection", () => {
  test("fires onConnectionLost after maxConsecutiveFailures consecutive failures", async () => {
    const client = buildMockSdkClient({
      health: mock(() => Promise.reject(new Error("server unreachable"))),
    });
    const healthMock = client.global.health as ReturnType<typeof mock>;
    const onConnectionLost = mock(() => {});

    const handle = createOpenCodeKeepalive(
      buildKeepaliveArgs({
        getSdkClient: () => client as never,
        onConnectionLost,
        maxConsecutiveFailures: 3,
      }),
    );

    handle.start();
    await waitFor(() => onConnectionLost.mock.calls.length >= 1);
    handle.stop();

    // Health was called at least maxConsecutiveFailures times
    expect(healthMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onConnectionLost).toHaveBeenCalledTimes(1);
  });

  test("onConnectionLost fires only once per start/stop cycle", async () => {
    const client = buildMockSdkClient({
      health: mock(() => Promise.reject(new Error("dead"))),
    });
    const onConnectionLost = mock(() => {});

    const handle = createOpenCodeKeepalive(
      buildKeepaliveArgs({
        getSdkClient: () => client as never,
        onConnectionLost,
        maxConsecutiveFailures: 3,
      }),
    );

    handle.start();
    await waitFor(() => onConnectionLost.mock.calls.length >= 1);
    // Let several more intervals pass — guard must prevent re-firing
    await new Promise((resolve) => setTimeout(resolve, 60));
    handle.stop();

    expect(onConnectionLost).toHaveBeenCalledTimes(1);
  });

  test("connectionLostFired resets after stop/start cycle — fires again on next threshold", async () => {
    const client = buildMockSdkClient({
      health: mock(() => Promise.reject(new Error("down"))),
    });
    const onConnectionLost = mock(() => {});

    const handle = createOpenCodeKeepalive(
      buildKeepaliveArgs({
        getSdkClient: () => client as never,
        onConnectionLost,
        maxConsecutiveFailures: 3,
      }),
    );

    // First cycle
    handle.start();
    await waitFor(() => onConnectionLost.mock.calls.length >= 1);
    handle.stop();

    // Second cycle — connectionLostFired should have been reset
    handle.start();
    await waitFor(() => onConnectionLost.mock.calls.length >= 2);
    handle.stop();

    expect(onConnectionLost).toHaveBeenCalledTimes(2);
  });

  test("successful health check resets the consecutive failure counter", async () => {
    let callCount = 0;
    // Fail twice, succeed once, fail twice, succeed once — pattern repeats.
    // With maxConsecutiveFailures=3, consecutive count never reaches 3.
    const client = buildMockSdkClient({
      health: mock(() => {
        callCount++;
        if (callCount % 3 === 0) {
          return Promise.resolve({ data: { version: "1.0" } });
        }
        return Promise.reject(new Error("flaky"));
      }),
    });
    const healthMock = client.global.health as ReturnType<typeof mock>;
    const onConnectionLost = mock(() => {});

    const handle = createOpenCodeKeepalive(
      buildKeepaliveArgs({
        getSdkClient: () => client as never,
        onConnectionLost,
        maxConsecutiveFailures: 3,
      }),
    );

    handle.start();
    await waitForCalls(healthMock, 9);
    handle.stop();

    // (fail, fail, pass) pattern resets counter to 0 after each success,
    // so the threshold of 3 is never reached.
    expect(onConnectionLost).not.toHaveBeenCalled();
  });

  test("intermittent failures (success between failures) do not trigger onConnectionLost", async () => {
    let callCount = 0;
    // Alternating fail/success — consecutive failures never exceed 1.
    const client = buildMockSdkClient({
      health: mock(() => {
        callCount++;
        if (callCount % 2 === 0) {
          return Promise.resolve({ data: { version: "1.0" } });
        }
        return Promise.reject(new Error("transient"));
      }),
    });
    const healthMock = client.global.health as ReturnType<typeof mock>;
    const debugLog = mock(() => {});
    const onConnectionLost = mock(() => {});

    const handle = createOpenCodeKeepalive(
      buildKeepaliveArgs({
        getSdkClient: () => client as never,
        debugLog,
        onConnectionLost,
        maxConsecutiveFailures: 3,
      }),
    );

    handle.start();
    await waitForCalls(healthMock, 6);
    handle.stop();

    expect(onConnectionLost).not.toHaveBeenCalled();

    const failCalls = debugLog.mock.calls.filter(
      (c) => (c as string[])[0] === "keepalive.health.failed",
    );
    expect(failCalls.length).toBeGreaterThan(0);
  });

  test("health check timeout counts as a failure and triggers onConnectionLost after threshold", async () => {
    // health() returns a promise that never resolves/rejects (simulates a hang).
    // The 10-second HEALTH_CHECK_TIMEOUT_MS is too long for a test, so we use
    // a very short intervalMs combined with a never-settling promise.
    // We set maxConsecutiveFailures=3 and override intervalMs to 10ms so the
    // keepalive fires quickly.  Because the production timeout is 10 s, the
    // timer won't fire in the test; instead we make health() reject immediately
    // after a short delay to simulate the timeout effect.
    const SIMULATED_TIMEOUT_MS = 20;
    let callCount = 0;
    const client = buildMockSdkClient({
      health: mock(() => {
        callCount++;
        // Simulate a slow health check that takes longer than the keepalive
        // interval, eventually rejecting to mimic a timeout error.
        return new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Health check timed out")),
            SIMULATED_TIMEOUT_MS,
          ),
        );
      }),
    });
    const onConnectionLost = mock(() => {});

    const handle = createOpenCodeKeepalive(
      buildKeepaliveArgs({
        getSdkClient: () => client as never,
        onConnectionLost,
        intervalMs: 30,
        maxConsecutiveFailures: 3,
      }),
    );

    handle.start();
    // Wait long enough for 3 failures to accumulate (each takes ~20 ms, interval 30 ms)
    await waitFor(() => onConnectionLost.mock.calls.length >= 1, 5000);
    handle.stop();

    expect(onConnectionLost).toHaveBeenCalledTimes(1);
  });
});
