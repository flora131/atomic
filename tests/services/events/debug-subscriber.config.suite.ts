import { describe, expect, test } from "bun:test";
import { resolveStreamDebugLogConfig } from "@/services/events/debug-subscriber.ts";

describe("Debug Subscriber JSONL Logging", () => {
  test("resolveStreamDebugLogConfig() enables via DEBUG", () => {
    const config = resolveStreamDebugLogConfig({
      DEBUG: "1",
    });
    expect(config.enabled).toBe(true);
    expect(config.logDir).toBeUndefined();
    expect(config.consolePreviewEnabled).toBe(true);
  });

  test("resolveStreamDebugLogConfig() supports custom log directory", () => {
    const config = resolveStreamDebugLogConfig({
      DEBUG: "1",
      LOG_DIR: "/tmp/AtomicDebugLogs",
    });
    expect(config.enabled).toBe(true);
    expect(config.logDir).toBe("/tmp/AtomicDebugLogs");
  });

  test("resolveStreamDebugLogConfig() remains disabled when DEBUG is not set", () => {
    const config = resolveStreamDebugLogConfig({
      LOG_DIR: "/tmp/AtomicDebugLogs",
    });
    expect(config.enabled).toBe(false);
    expect(config.logDir).toBe("/tmp/AtomicDebugLogs");
    expect(config.consolePreviewEnabled).toBe(false);
  });
});
