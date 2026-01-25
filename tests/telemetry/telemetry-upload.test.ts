/**
 * Unit tests for telemetry upload module
 *
 * Tests cover:
 * - JSONL file parsing (valid, invalid, missing)
 * - Stale event filtering (30-day retention)
 * - Upload flow (disabled check, event processing)
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  readEventsFromJSONL,
  filterStaleEvents,
  splitIntoBatches,
  handleTelemetryUpload,
  TELEMETRY_UPLOAD_CONFIG,
} from "../../src/utils/telemetry/telemetry-upload";
import { writeTelemetryState } from "../../src/utils/telemetry/telemetry";
import { createEnabledState, createDisabledState } from "./test-utils";
import type { TelemetryEvent, AtomicCommandEvent, CliCommandEvent, AgentSessionEvent } from "../../src/utils/telemetry/types";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(tmpdir(), "atomic-telemetry-upload-test-" + Date.now());

// Mock getBinaryDataDir to use test directory
mock.module("../../src/utils/config-path", () => ({
  getBinaryDataDir: () => TEST_DATA_DIR,
}));

// Mock ci-info to prevent CI detection from disabling telemetry in tests
mock.module("ci-info", () => ({
  isCI: false,
}));

// Mock Azure SDK to avoid actual network calls
mock.module("@azure/monitor-opentelemetry", () => ({
  useAzureMonitor: () => {},
  shutdownAzureMonitor: () => Promise.resolve(),
}));

// Mock OpenTelemetry logs API
mock.module("@opentelemetry/api-logs", () => ({
  logs: {
    getLogger: () => ({
      emit: () => {},
    }),
  },
  SeverityNumber: {
    INFO: 9,
  },
}));

// Helper to create a valid AtomicCommandEvent
function createAtomicEvent(timestamp: string): AtomicCommandEvent {
  return {
    anonymousId: "test-uuid-1234",
    eventId: crypto.randomUUID(),
    eventType: "atomic_command",
    timestamp,
    command: "init",
    agentType: "claude",
    success: true,
    platform: "darwin",
    atomicVersion: "0.1.0",
    source: "cli",
  };
}

// Helper to create a valid CliCommandEvent
function createCliEvent(
  timestamp: string,
  commands: string[] = ["/commit"]
): CliCommandEvent {
  return {
    anonymousId: "test-uuid-1234",
    eventId: crypto.randomUUID(),
    eventType: "cli_command",
    timestamp,
    agentType: "claude",
    commands,
    commandCount: commands.length,
    platform: "darwin",
    atomicVersion: "0.1.0",
    source: "cli",
  };
}

// Helper to create a valid AgentSessionEvent
function createAgentSessionEvent(
  timestamp: string,
  commands: string[] = ["/commit"]
): AgentSessionEvent {
  const sessionId = crypto.randomUUID();
  return {
    anonymousId: "test-uuid-1234",
    eventId: sessionId,
    sessionId,
    eventType: "agent_session",
    timestamp,
    agentType: "claude",
    commands,
    commandCount: commands.length,
    platform: "darwin",
    atomicVersion: "0.1.0",
    source: "session_hook",
  };
}

// Helper to get events file path (uses agent-specific pattern)
function getTestEventsPath(agentType: string = "claude"): string {
  return join(TEST_DATA_DIR, `telemetry-events-${agentType}.jsonl`);
}

// Helper to write events to JSONL
function writeEventsToJSONL(events: TelemetryEvent[]): void {
  const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(getTestEventsPath(), content, "utf-8");
}

describe("readEventsFromJSONL", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    delete process.env.ATOMIC_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    process.env = { ...originalEnv };
  });

  test("returns empty array for missing file", () => {
    const events = readEventsFromJSONL(getTestEventsPath());
    expect(events).toEqual([]);
  });

  test("parses valid JSONL and skips invalid lines", () => {
    const validEvent = createAtomicEvent(new Date().toISOString());
    const content =
      JSON.stringify(validEvent) + "\n" + "invalid json line\n" + '{"incomplete": true}\n';
    writeFileSync(getTestEventsPath(), content, "utf-8");

    const events = readEventsFromJSONL(getTestEventsPath());
    // Only the valid event should be returned (incomplete object lacks required fields)
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("atomic_command");
  });
});

describe("filterStaleEvents", () => {
  test("filters events by 30-day retention policy", () => {
    const now = new Date();
    const thirtyOneDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

    const staleEvent = createAtomicEvent(thirtyOneDaysAgo.toISOString());
    const freshEvent1 = createAtomicEvent(now.toISOString());
    const freshEvent2 = createAtomicEvent(twentyDaysAgo.toISOString());

    const { valid, staleCount } = filterStaleEvents([staleEvent, freshEvent1, freshEvent2]);

    expect(valid).toHaveLength(2);
    expect(staleCount).toBe(1);
  });
});

describe("splitIntoBatches", () => {
  test("splits events into batches correctly", () => {
    const events = Array.from({ length: 150 }, () => createAtomicEvent(new Date().toISOString()));

    const batches = splitIntoBatches(events, 100);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(100);
    expect(batches[1]).toHaveLength(50);
  });
});

describe("handleTelemetryUpload", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    delete process.env.ATOMIC_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    process.env = { ...originalEnv };
  });

  test("returns early when telemetry disabled or no events", async () => {
    // Test disabled state
    writeTelemetryState(createDisabledState());
    let result = await handleTelemetryUpload();
    expect(result.success).toBe(true);
    expect(result.eventsUploaded).toBe(0);

    // Test enabled but no events file
    writeTelemetryState(createEnabledState());
    result = await handleTelemetryUpload();
    expect(result.success).toBe(true);
    expect(result.eventsUploaded).toBe(0);
  });

  test("uploads events when telemetry enabled", async () => {
    // Set up enabled telemetry state
    writeTelemetryState(createEnabledState());

    // Write some events
    const events = [
      createAtomicEvent(new Date().toISOString()),
      createCliEvent(new Date().toISOString()),
    ];
    writeEventsToJSONL(events);

    const result = await handleTelemetryUpload();

    expect(result.success).toBe(true);
    expect(result.eventsUploaded).toBe(2);
    expect(result.eventsSkipped).toBe(0);

    // JSONL file should be deleted after successful upload
    expect(existsSync(getTestEventsPath())).toBe(false);
  });

  test("reports stale events as skipped", async () => {
    // Set up enabled telemetry state
    writeTelemetryState(createEnabledState());

    // Write mix of fresh and stale events
    const now = new Date();
    const thirtyOneDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const events = [
      createAtomicEvent(thirtyOneDaysAgo.toISOString()), // stale
      createCliEvent(now.toISOString()), // fresh
    ];
    writeEventsToJSONL(events);

    const result = await handleTelemetryUpload();

    expect(result.success).toBe(true);
    expect(result.eventsUploaded).toBe(1);
    expect(result.eventsSkipped).toBe(1);
  });

  test("deletes JSONL file after successful upload", async () => {
    writeTelemetryState(createEnabledState());

    // Write only stale events
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const events = [
      createAtomicEvent(thirtyOneDaysAgo.toISOString()),
      createCliEvent(thirtyOneDaysAgo.toISOString()),
    ];
    writeEventsToJSONL(events);

    const result = await handleTelemetryUpload();

    expect(result.success).toBe(true);
    expect(result.eventsSkipped).toBe(2);

    // JSONL file should be deleted even when all events are stale
    expect(existsSync(getTestEventsPath())).toBe(false);
  });
});

// Note: TELEMETRY_UPLOAD_CONFIG tests removed in Phase 2 (dead code elimination)
// Retry/timeout logic is handled by @azure/monitor-opentelemetry SDK internally
