/**
 * Unit tests for telemetry CLI module
 *
 * Tests cover:
 * - trackAtomicCommand writes correct event structure to JSONL
 * - trackAtomicCommand respects isTelemetryEnabled() check
 * - JSONL file is created if it doesn't exist
 * - Multiple events append correctly (newline delimited)
 * - Event fields match expected schema
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  trackAtomicCommand,
  trackCliInvocation,
  extractCommandsFromArgs,
  getEventsFilePath,
} from "./telemetry-cli";
import { writeTelemetryState, getTelemetryFilePath } from "./telemetry";
import type {
  TelemetryState,
  AtomicCommandEvent,
  CliCommandEvent,
  TelemetryEvent,
} from "./types";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(tmpdir(), "atomic-telemetry-cli-test-" + Date.now());

// Mock getBinaryDataDir to use test directory
mock.module("../config-path", () => ({
  getBinaryDataDir: () => TEST_DATA_DIR,
}));

// Helper to create enabled telemetry state
function createEnabledState(): TelemetryState {
  return {
    enabled: true,
    consentGiven: true,
    anonymousId: "test-uuid-1234",
    createdAt: "2026-01-01T00:00:00Z",
    rotatedAt: "2026-01-01T00:00:00Z",
  };
}

// Helper to read events from JSONL file
function readEvents(): TelemetryEvent[] {
  const eventsPath = getEventsFilePath();
  if (!existsSync(eventsPath)) {
    return [];
  }
  const content = readFileSync(eventsPath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TelemetryEvent);
}

// Helper to read only AtomicCommandEvents
function readAtomicEvents(): AtomicCommandEvent[] {
  return readEvents().filter(
    (e): e is AtomicCommandEvent => e.eventType === "atomic_command"
  );
}

// Helper to read only CliCommandEvents
function readCliEvents(): CliCommandEvent[] {
  return readEvents().filter(
    (e): e is CliCommandEvent => e.eventType === "cli_command"
  );
}

describe("getEventsFilePath", () => {
  test("returns path to telemetry-events.jsonl in data directory", () => {
    const path = getEventsFilePath();
    expect(path).toContain("telemetry-events.jsonl");
    expect(path).toContain(TEST_DATA_DIR);
  });
});

describe("trackAtomicCommand", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    // Reset env vars
    delete process.env.ATOMIC_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    // Restore env
    process.env = { ...originalEnv };
  });

  test("does not write when telemetry is disabled via ATOMIC_TELEMETRY=0", () => {
    process.env.ATOMIC_TELEMETRY = "0";
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readEvents();
    expect(events).toHaveLength(0);
  });

  test("does not write when telemetry is disabled via DO_NOT_TRACK=1", () => {
    process.env.DO_NOT_TRACK = "1";
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readEvents();
    expect(events).toHaveLength(0);
  });

  test("does not write when telemetry state file is missing", () => {
    // No state file created

    trackAtomicCommand("init", "claude", true);

    const events = readEvents();
    expect(events).toHaveLength(0);
  });

  test("does not write when enabled=false in config", () => {
    const state = createEnabledState();
    state.enabled = false;
    writeTelemetryState(state);

    trackAtomicCommand("init", "claude", true);

    const events = readEvents();
    expect(events).toHaveLength(0);
  });

  test("does not write when consentGiven=false in config", () => {
    const state = createEnabledState();
    state.consentGiven = false;
    writeTelemetryState(state);

    trackAtomicCommand("init", "claude", true);

    const events = readEvents();
    expect(events).toHaveLength(0);
  });

  test("writes event when telemetry is enabled", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readEvents();
    expect(events).toHaveLength(1);
  });

  test("creates events file if it does not exist", () => {
    writeTelemetryState(createEnabledState());

    expect(existsSync(getEventsFilePath())).toBe(false);

    trackAtomicCommand("init", "claude", true);

    expect(existsSync(getEventsFilePath())).toBe(true);
  });

  test("appends multiple events correctly (newline delimited)", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("update", null, true);
    trackAtomicCommand("uninstall", null, false);

    const events = readAtomicEvents();
    expect(events).toHaveLength(3);
    expect(events[0]?.command).toBe("init");
    expect(events[1]?.command).toBe("update");
    expect(events[2]?.command).toBe("uninstall");
  });

  test("event has correct structure matching AtomicCommandEvent schema", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;

    // Check all required fields exist
    expect(event.anonymousId).toBeDefined();
    expect(event.eventId).toBeDefined();
    expect(event.eventType).toBe("atomic_command");
    expect(event.timestamp).toBeDefined();
    expect(event.command).toBe("init");
    expect(event.agentType).toBe("claude");
    expect(event.success).toBe(true);
    expect(event.platform).toBeDefined();
    expect(event.atomicVersion).toBeDefined();
    expect(event.source).toBe("cli");
  });

  test("eventId is a valid UUID v4 format", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents();
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(events[0]?.eventId).toMatch(uuidV4Regex);
  });

  test("timestamp is valid ISO 8601 format", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents();
    const timestamp = events[0]!.timestamp;
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });

  test("anonymousId comes from telemetry state", () => {
    const state = createEnabledState();
    state.anonymousId = "custom-anon-id-123";
    writeTelemetryState(state);

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents();
    expect(events[0]?.anonymousId).toBe("custom-anon-id-123");
  });

  test("each event has unique eventId", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("update", null, true);
    trackAtomicCommand("run", "opencode", true);

    const events = readAtomicEvents();
    const eventIds = events.map((e) => e.eventId);
    const uniqueIds = new Set(eventIds);
    expect(uniqueIds.size).toBe(3);
  });

  test("tracks init command with agent type", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents();
    expect(events[0]?.command).toBe("init");
    expect(events[0]?.agentType).toBe("claude");
    expect(events[0]?.success).toBe(true);
  });

  test("tracks update command without agent type", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("update", null, true);

    const events = readAtomicEvents();
    expect(events[0]?.command).toBe("update");
    expect(events[0]?.agentType).toBeNull();
    expect(events[0]?.success).toBe(true);
  });

  test("tracks uninstall command without agent type", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("uninstall", null, true);

    const events = readAtomicEvents();
    expect(events[0]?.command).toBe("uninstall");
    expect(events[0]?.agentType).toBeNull();
  });

  test("tracks run command with different agent types", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("run", "claude", true);
    trackAtomicCommand("run", "opencode", true);
    trackAtomicCommand("run", "copilot", true);

    const events = readAtomicEvents();
    expect(events[0]?.agentType).toBe("claude");
    expect(events[1]?.agentType).toBe("opencode");
    expect(events[2]?.agentType).toBe("copilot");
  });

  test("tracks failed command with success=false", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", false);

    const events = readAtomicEvents();
    expect(events[0]?.success).toBe(false);
  });

  test("success defaults to true when not specified", () => {
    writeTelemetryState(createEnabledState());

    // Call without success parameter (relying on default)
    trackAtomicCommand("init", "claude");

    const events = readAtomicEvents();
    expect(events[0]?.success).toBe(true);
  });

  test("platform matches process.platform", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents();
    expect(events[0]?.platform).toBe(process.platform);
  });

  test("concurrent writes append correctly", async () => {
    writeTelemetryState(createEnabledState());

    // Simulate concurrent writes
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        Promise.resolve().then(() =>
          trackAtomicCommand("init", "claude", true)
        )
      );
    }
    await Promise.all(promises);

    const events = readAtomicEvents();
    expect(events).toHaveLength(10);

    // All events should be valid
    for (const event of events) {
      expect(event.eventType).toBe("atomic_command");
      expect(event.command).toBe("init");
    }
  });

  test("fails silently on write error (does not throw)", () => {
    writeTelemetryState(createEnabledState());

    // Make the events file a directory to cause a write error
    const eventsPath = getEventsFilePath();
    mkdirSync(eventsPath, { recursive: true });

    // Should not throw
    expect(() => {
      trackAtomicCommand("init", "claude", true);
    }).not.toThrow();
  });
});

describe("extractCommandsFromArgs", () => {
  test("extracts exact command match", () => {
    const result = extractCommandsFromArgs(["/research-codebase"]);
    expect(result).toEqual(["/research-codebase"]);
  });

  test("extracts command with args (prefix match)", () => {
    const result = extractCommandsFromArgs(["/research-codebase src/"]);
    expect(result).toEqual(["/research-codebase"]);
  });

  test("extracts multiple different commands", () => {
    const result = extractCommandsFromArgs(["/research-codebase", "/commit"]);
    expect(result).toEqual(["/research-codebase", "/commit"]);
  });

  test("returns empty array for no commands", () => {
    const result = extractCommandsFromArgs(["src/", "--verbose"]);
    expect(result).toEqual([]);
  });

  test("deduplicates repeated commands", () => {
    const result = extractCommandsFromArgs(["/commit", "/commit"]);
    expect(result).toEqual(["/commit"]);
  });

  test("filters out invalid commands in mixed input", () => {
    const result = extractCommandsFromArgs(["/commit", "--help", "/unknown"]);
    expect(result).toEqual(["/commit"]);
  });

  test("extracts namespaced commands", () => {
    const result = extractCommandsFromArgs(["/ralph:ralph-loop"]);
    expect(result).toEqual(["/ralph:ralph-loop"]);
  });

  test("extracts multiple namespaced commands", () => {
    const result = extractCommandsFromArgs([
      "/ralph:ralph-loop",
      "/ralph:cancel-ralph",
    ]);
    expect(result).toEqual(["/ralph:ralph-loop", "/ralph:cancel-ralph"]);
  });

  test("handles empty args array", () => {
    const result = extractCommandsFromArgs([]);
    expect(result).toEqual([]);
  });

  test("ignores partial command matches", () => {
    // /research-codebase-extra should not match /research-codebase
    const result = extractCommandsFromArgs(["/research-codebase-extra"]);
    expect(result).toEqual([]);
  });

  test("extracts command followed by space and args", () => {
    const result = extractCommandsFromArgs(["/commit -m fix bug"]);
    expect(result).toEqual(["/commit"]);
  });
});

describe("trackCliInvocation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    // Reset env vars
    delete process.env.ATOMIC_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    // Restore env
    process.env = { ...originalEnv };
  });

  test("does not write when telemetry is disabled", () => {
    process.env.ATOMIC_TELEMETRY = "0";
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/research-codebase"]);

    const events = readCliEvents();
    expect(events).toHaveLength(0);
  });

  test("does not write when args contain no commands", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["src/", "--help"]);

    const events = readCliEvents();
    expect(events).toHaveLength(0);
  });

  test("writes CliCommandEvent when args contain commands", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/research-codebase", "src/"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("cli_command");
  });

  test("event contains correct commandCount", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/research-codebase", "/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.commands).toEqual(["/research-codebase", "/commit"]);
    expect(events[0]?.commandCount).toBe(2);
  });

  test("eventType is cli_command not atomic_command", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("cli_command");

    // Should not create atomic_command event
    const atomicEvents = readAtomicEvents();
    expect(atomicEvents).toHaveLength(0);
  });

  test("event contains correct agentType", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("opencode", ["/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.agentType).toBe("opencode");
  });

  test("event contains source as cli", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("cli");
  });

  test("event contains platform", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.platform).toBe(process.platform);
  });

  test("event has unique eventId", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/commit"]);
    trackCliInvocation("claude", ["/research-codebase"]);

    const events = readCliEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.eventId).not.toBe(events[1]?.eventId);
  });

  test("event uses anonymousId from state", () => {
    const state = createEnabledState();
    state.anonymousId = "custom-cli-test-id";
    writeTelemetryState(state);

    trackCliInvocation("claude", ["/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.anonymousId).toBe("custom-cli-test-id");
  });

  test("works with all agent types", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/commit"]);
    trackCliInvocation("opencode", ["/commit"]);
    trackCliInvocation("copilot", ["/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(3);
    expect(events[0]?.agentType).toBe("claude");
    expect(events[1]?.agentType).toBe("opencode");
    expect(events[2]?.agentType).toBe("copilot");
  });

  test("does not throw on write errors (fail-safe)", () => {
    writeTelemetryState(createEnabledState());

    // Make the events file a directory to cause a write error
    const eventsPath = getEventsFilePath();
    mkdirSync(eventsPath, { recursive: true });

    // Should not throw
    expect(() => {
      trackCliInvocation("claude", ["/commit"]);
    }).not.toThrow();
  });
});
