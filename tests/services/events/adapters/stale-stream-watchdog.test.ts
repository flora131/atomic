import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  createStaleStreamWatchdog,
  StaleStreamError,
  DEFAULT_FOREGROUND_STALE_TIMEOUT_MS,
} from "@/services/events/adapters/stale-stream-watchdog.ts";

// Use short timeouts for test speed
const SHORT_TIMEOUT_MS = 50;

let watchdog: ReturnType<typeof createStaleStreamWatchdog>;
let onStaleCalls: number;

beforeEach(() => {
  onStaleCalls = 0;
});

afterEach(() => {
  watchdog?.dispose();
});

test("fires onStale after timeout elapses with no activity", async () => {
  watchdog = createStaleStreamWatchdog({
    timeoutMs: SHORT_TIMEOUT_MS,
    onStale: () => { onStaleCalls++; },
  });

  watchdog.start();

  // Should not fire yet
  expect(watchdog.hasFired).toBe(false);
  expect(onStaleCalls).toBe(0);

  await Bun.sleep(SHORT_TIMEOUT_MS + 20);

  expect(watchdog.hasFired).toBe(true);
  expect(onStaleCalls).toBe(1);
});

test("kick() resets the countdown and prevents premature firing", async () => {
  watchdog = createStaleStreamWatchdog({
    timeoutMs: SHORT_TIMEOUT_MS,
    onStale: () => { onStaleCalls++; },
  });

  watchdog.start();

  // Kick before timeout to reset the countdown
  await Bun.sleep(SHORT_TIMEOUT_MS - 20);
  watchdog.kick();

  // Original timeout window would have passed, but kick() reset it
  await Bun.sleep(30);
  expect(watchdog.hasFired).toBe(false);
  expect(onStaleCalls).toBe(0);

  // Now let the reset timer elapse
  await Bun.sleep(SHORT_TIMEOUT_MS);
  expect(watchdog.hasFired).toBe(true);
  expect(onStaleCalls).toBe(1);
});

test("dispose() prevents firing and is safe to call multiple times", async () => {
  watchdog = createStaleStreamWatchdog({
    timeoutMs: SHORT_TIMEOUT_MS,
    onStale: () => { onStaleCalls++; },
  });

  watchdog.start();
  watchdog.dispose();
  watchdog.dispose(); // idempotent

  await Bun.sleep(SHORT_TIMEOUT_MS + 20);

  expect(watchdog.hasFired).toBe(false);
  expect(onStaleCalls).toBe(0);
});

test("does not fire twice after timeout", async () => {
  watchdog = createStaleStreamWatchdog({
    timeoutMs: SHORT_TIMEOUT_MS,
    onStale: () => { onStaleCalls++; },
  });

  watchdog.start();
  await Bun.sleep(SHORT_TIMEOUT_MS + 20);

  expect(onStaleCalls).toBe(1);

  // kick() after firing is a no-op (fired flag blocks rescheduling)
  watchdog.kick();
  await Bun.sleep(SHORT_TIMEOUT_MS + 20);

  expect(onStaleCalls).toBe(1);
});

test("reset() clears fired state and allows re-firing", async () => {
  watchdog = createStaleStreamWatchdog({
    timeoutMs: SHORT_TIMEOUT_MS,
    onStale: () => { onStaleCalls++; },
  });

  watchdog.start();
  await Bun.sleep(SHORT_TIMEOUT_MS + 20);
  expect(onStaleCalls).toBe(1);
  expect(watchdog.hasFired).toBe(true);

  // Reset allows the watchdog to fire again (used between retries)
  watchdog.reset();
  expect(watchdog.hasFired).toBe(false);

  watchdog.start();
  await Bun.sleep(SHORT_TIMEOUT_MS + 20);
  expect(onStaleCalls).toBe(2);
  expect(watchdog.hasFired).toBe(true);
});

test("disabled when timeoutMs is 0", async () => {
  watchdog = createStaleStreamWatchdog({
    timeoutMs: 0,
    onStale: () => { onStaleCalls++; },
  });

  watchdog.start();
  await Bun.sleep(SHORT_TIMEOUT_MS);

  expect(watchdog.hasFired).toBe(false);
  expect(onStaleCalls).toBe(0);
});

test("disabled when timeoutMs is negative", async () => {
  watchdog = createStaleStreamWatchdog({
    timeoutMs: -1,
    onStale: () => { onStaleCalls++; },
  });

  watchdog.start();
  await Bun.sleep(SHORT_TIMEOUT_MS);

  expect(watchdog.hasFired).toBe(false);
  expect(onStaleCalls).toBe(0);
});

test("StaleStreamError is retryable and has descriptive message", () => {
  const error = new StaleStreamError(300_000);

  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("StaleStreamError");
  expect(error.isRetryable).toBe(true);
  expect(error.message).toContain("300");
  expect(error.message).toContain("stalled");
});

test("StaleStreamError is classified as retryable by classifyError convention", () => {
  const error = new StaleStreamError(DEFAULT_FOREGROUND_STALE_TIMEOUT_MS);

  // The retry module checks `error.isRetryable` as a boolean property
  const errorRecord = error as unknown as Record<string, unknown>;
  expect(typeof errorRecord.isRetryable).toBe("boolean");
  expect(errorRecord.isRetryable).toBe(true);
});

test("DEFAULT_FOREGROUND_STALE_TIMEOUT_MS is 5 minutes", () => {
  expect(DEFAULT_FOREGROUND_STALE_TIMEOUT_MS).toBe(5 * 60 * 1000);
});

test("start() is idempotent — calling it twice does not create duplicate timers", async () => {
  watchdog = createStaleStreamWatchdog({
    timeoutMs: SHORT_TIMEOUT_MS,
    onStale: () => { onStaleCalls++; },
  });

  watchdog.start();
  watchdog.start();

  await Bun.sleep(SHORT_TIMEOUT_MS + 20);

  // Should only fire once even though start() was called twice
  expect(onStaleCalls).toBe(1);
});
