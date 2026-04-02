/**
 * Tests for telemetry-file-io.ts — verifies appendEvent uses file locking
 * via withLock() and writes JSONL events correctly.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { appendEvent, getEventsFilePath } from "@/services/telemetry/telemetry-file-io.ts";
import { getLockPath } from "@/services/system/file-lock.ts";
import type { TelemetryEvent } from "@/services/telemetry/types.ts";

// Steer getBinaryDataDir() via XDG_DATA_HOME instead of mock.module
// (mock.module is process-global and irreversible, poisoning other test files).
// getBinaryDataDir() returns join(XDG_DATA_HOME, "atomic"), so we set the parent.
const TEST_BASE = join(tmpdir(), `telemetry-file-io-test-${process.pid}`);
const TEST_DIR = join(TEST_BASE, "atomic");

function makeEvent(overrides: Record<string, unknown> = {}): TelemetryEvent {
  return {
    eventType: "atomic_command",
    anonymousId: "test-anon-id",
    timestamp: "2026-01-15T12:00:00.000Z",
    ...overrides,
  } as unknown as TelemetryEvent;
}

describe("telemetry-file-io", () => {
  let savedXdgDataHome: string | undefined;

  beforeEach(() => {
    savedXdgDataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = TEST_BASE;
    if (existsSync(TEST_BASE)) {
      rmSync(TEST_BASE, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (savedXdgDataHome !== undefined) {
      process.env.XDG_DATA_HOME = savedXdgDataHome;
    } else {
      delete process.env.XDG_DATA_HOME;
    }
    if (existsSync(TEST_BASE)) {
      rmSync(TEST_BASE, { recursive: true, force: true });
    }
  });

  describe("getEventsFilePath", () => {
    test("returns path with agent type suffix", () => {
      const path = getEventsFilePath("claude");
      expect(path).toBe(join(TEST_DIR, "telemetry-events-claude.jsonl"));
    });

    test("defaults to 'atomic' when no agent type", () => {
      const path = getEventsFilePath();
      expect(path).toBe(join(TEST_DIR, "telemetry-events-atomic.jsonl"));
    });

    test("defaults to 'atomic' when null agent type", () => {
      const path = getEventsFilePath(null);
      expect(path).toBe(join(TEST_DIR, "telemetry-events-atomic.jsonl"));
    });
  });

  describe("appendEvent", () => {
    test("creates data directory if it does not exist", async () => {
      expect(existsSync(TEST_DIR)).toBe(false);
      await appendEvent(makeEvent());
      expect(existsSync(TEST_DIR)).toBe(true);
    });

    test("writes event as a single JSONL line", async () => {
      const event = makeEvent({ event: "command_executed" });
      await appendEvent(event, "claude");

      const filePath = join(TEST_DIR, "telemetry-events-claude.jsonl");
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toEqual(event);
    });

    test("appends multiple events as separate lines", async () => {
      const event1 = makeEvent({ timestamp: "2026-01-15T12:00:00.000Z" });
      const event2 = makeEvent({ timestamp: "2026-01-15T12:01:00.000Z" });

      await appendEvent(event1);
      await appendEvent(event2);

      const filePath = join(TEST_DIR, "telemetry-events-atomic.jsonl");
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual(event1);
      expect(JSON.parse(lines[1]!)).toEqual(event2);
    });

    test("does not leave lock files after write", async () => {
      const event = makeEvent();
      await appendEvent(event, "copilot");

      const eventsPath = join(TEST_DIR, "telemetry-events-copilot.jsonl");
      const lockPath = getLockPath(eventsPath);
      expect(existsSync(lockPath)).toBe(false);
    });

    test("isolates events by agent type", async () => {
      await appendEvent(makeEvent({ event: "command_executed" }), "claude");
      await appendEvent(makeEvent({ event: "session_end" }), "copilot");

      const claudeContent = readFileSync(join(TEST_DIR, "telemetry-events-claude.jsonl"), "utf-8");
      const copilotContent = readFileSync(join(TEST_DIR, "telemetry-events-copilot.jsonl"), "utf-8");

      expect(claudeContent.trim().split("\n")).toHaveLength(1);
      expect(copilotContent.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(claudeContent.trim()).event).toBe("command_executed");
      expect(JSON.parse(copilotContent.trim()).event).toBe("session_end");
    });

    test("fails silently on errors", async () => {
      // Passing an event that would cause issues shouldn't throw
      // Create a read-only scenario by making dataDir a file instead of dir
      mkdirSync(TEST_DIR, { recursive: true });

      // This should not throw even if internals fail
      const circular = {} as Record<string, unknown>;
      circular.self = circular;

      // JSON.stringify with circular reference would throw, but appendEvent catches it
      await expect(
        appendEvent(circular as unknown as TelemetryEvent)
      ).resolves.toBeUndefined();
    });

    test("concurrent writes all succeed with locking", async () => {
      const events = Array.from({ length: 10 }, (_, i) =>
        makeEvent({ timestamp: `2026-01-15T12:0${i}:00.000Z` })
      );

      // Fire all writes concurrently
      await Promise.all(events.map((e) => appendEvent(e)));

      const filePath = join(TEST_DIR, "telemetry-events-atomic.jsonl");
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");

      expect(lines).toHaveLength(10);
      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });
});
