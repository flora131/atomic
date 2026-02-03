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
} from "../../src/utils/telemetry/telemetry-cli";
import { writeTelemetryState, getTelemetryFilePath } from "../../src/utils/telemetry/telemetry";
import type {
  TelemetryState,
  AtomicCommandEvent,
  CliCommandEvent,
  TelemetryEvent,
} from "../../src/utils/telemetry/types";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(tmpdir(), "atomic-telemetry-cli-test-" + Date.now());

// Mock getBinaryDataDir to use test directory
mock.module("../../src/utils/config-path", () => ({
  getBinaryDataDir: () => TEST_DATA_DIR,
}));

// Mock ci-info to prevent CI detection from disabling telemetry in tests
mock.module("ci-info", () => ({
  isCI: false,
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

// Helper to read events from JSONL file (optionally from agent-specific file)
function readEvents(agentType?: string | null): TelemetryEvent[] {
  const eventsPath = getEventsFilePath(agentType as any);
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
function readAtomicEvents(agentType?: string | null): AtomicCommandEvent[] {
  return readEvents(agentType).filter(
    (e): e is AtomicCommandEvent => e.eventType === "atomic_command"
  );
}

// Helper to read only CliCommandEvents
function readCliEvents(agentType?: string | null): CliCommandEvent[] {
  return readEvents(agentType).filter(
    (e): e is CliCommandEvent => e.eventType === "cli_command"
  );
}

// Helper to read events from ALL agent-specific files (for tests with mixed agents)
function readAllEvents(): TelemetryEvent[] {
  const agents = ["claude", "opencode", "copilot", "atomic"];
  const allEvents: TelemetryEvent[] = [];

  for (const agent of agents) {
    const events = readEvents(agent);
    allEvents.push(...events);
  }

  return allEvents;
}

// Helper to read all AtomicCommandEvents from all files
function readAllAtomicEvents(): AtomicCommandEvent[] {
  return readAllEvents().filter(
    (e): e is AtomicCommandEvent => e.eventType === "atomic_command"
  );
}

// Helper to read all CliCommandEvents from all files
function readAllCliEvents(): CliCommandEvent[] {
  return readAllEvents().filter(
    (e): e is CliCommandEvent => e.eventType === "cli_command"
  );
}

describe("getEventsFilePath", () => {
  test("returns path to telemetry-events-atomic.jsonl when no agent specified", () => {
    const path = getEventsFilePath();
    expect(path).toContain("telemetry-events-atomic.jsonl");
    expect(path).toContain(TEST_DATA_DIR);
  });

  test("returns path to telemetry-events-{agent}.jsonl for specific agent", () => {
    const claudePath = getEventsFilePath("claude");
    expect(claudePath).toContain("telemetry-events-claude.jsonl");
    expect(claudePath).toContain(TEST_DATA_DIR);

    const opencodePath = getEventsFilePath("opencode");
    expect(opencodePath).toContain("telemetry-events-opencode.jsonl");
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

  test("does not write when telemetry is disabled via config", () => {
    // Test missing file
    trackAtomicCommand("init", "claude", true);
    expect(readEvents()).toHaveLength(0);

    // Test enabled=false
    const disabledState = createEnabledState();
    disabledState.enabled = false;
    writeTelemetryState(disabledState);
    trackAtomicCommand("init", "claude", true);
    expect(readEvents()).toHaveLength(0);

    // Test consentGiven=false
    const noConsentState = createEnabledState();
    noConsentState.consentGiven = false;
    writeTelemetryState(noConsentState);
    trackAtomicCommand("init", "claude", true);
    expect(readEvents()).toHaveLength(0);
  });

  test("writes event when telemetry is enabled", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readEvents("claude");
    expect(events).toHaveLength(1);
  });

  test("creates events file if it does not exist", () => {
    writeTelemetryState(createEnabledState());

    expect(existsSync(getEventsFilePath("claude"))).toBe(false);

    trackAtomicCommand("init", "claude", true);

    expect(existsSync(getEventsFilePath("claude"))).toBe(true);
  });

  test("appends multiple events correctly (newline delimited)", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("update", null, true);
    trackAtomicCommand("uninstall", null, false);

    const events = readAllAtomicEvents();
    expect(events).toHaveLength(3);
    expect(events[0]?.command).toBe("init");
    expect(events[1]?.command).toBe("update");
    expect(events[2]?.command).toBe("uninstall");
  });

  test("event has correct structure matching AtomicCommandEvent schema", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents("claude");
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


  test("each event has unique eventId", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("update", null, true);
    trackAtomicCommand("run", "opencode", true);

    const events = readAllAtomicEvents();
    const eventIds = events.map((e) => e.eventId);
    const uniqueIds = new Set(eventIds);
    expect(uniqueIds.size).toBe(3);
  });


  test("success defaults to true when not specified", () => {
    writeTelemetryState(createEnabledState());

    // Call without success parameter (relying on default)
    trackAtomicCommand("init", "claude");

    const events = readAtomicEvents("claude");
    expect(events[0]?.success).toBe(true);
  });

  test("platform matches process.platform", () => {
    writeTelemetryState(createEnabledState());

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents("claude");
    expect(events[0]?.platform).toBe(process.platform);
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
    const result = extractCommandsFromArgs(["/ralph:cancel-ralph"]);
    expect(result).toEqual(["/ralph:cancel-ralph"]);
  });

  test("extracts multiple namespaced commands", () => {
    const result = extractCommandsFromArgs([
      "/ralph:cancel-ralph",
      "/ralph:ralph-help",
    ]);
    expect(result).toEqual(["/ralph:cancel-ralph", "/ralph:ralph-help"]);
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

    const events = readCliEvents("claude");
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("cli_command");
  });

  test("event contains correct commandCount", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/research-codebase", "/commit"]);

    const events = readCliEvents("claude");
    expect(events).toHaveLength(1);
    expect(events[0]?.commands).toEqual(["/research-codebase", "/commit"]);
    expect(events[0]?.commandCount).toBe(2);
  });

  test("eventType is cli_command not atomic_command", () => {
    writeTelemetryState(createEnabledState());

    trackCliInvocation("claude", ["/commit"]);

    const events = readCliEvents("claude");
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("cli_command");

    // Should not create atomic_command event
    const atomicEvents = readAllAtomicEvents();
    expect(atomicEvents).toHaveLength(0);
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
