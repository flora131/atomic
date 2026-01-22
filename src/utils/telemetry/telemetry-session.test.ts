/**
 * Unit tests for telemetry session module
 *
 * Tests cover:
 * - extractCommandsFromTranscript extracts commands correctly
 * - createSessionEvent creates valid AgentSessionEvent objects
 * - trackAgentSession writes events when enabled and commands found
 * - trackAgentSession respects telemetry opt-out
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  extractCommandsFromTranscript,
  createSessionEvent,
  trackAgentSession,
} from "./telemetry-session";
import { writeTelemetryState, getTelemetryFilePath } from "./telemetry";
import { getEventsFilePath } from "./telemetry-cli";
import type { TelemetryState, AgentSessionEvent, TelemetryEvent } from "./types";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(tmpdir(), "atomic-telemetry-session-test-" + Date.now());

// Mock getBinaryDataDir to use test directory
mock.module("../config-path", () => ({
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
    anonymousId: "session-test-uuid",
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

// Helper to read only AgentSessionEvents
function readSessionEvents(): AgentSessionEvent[] {
  return readEvents().filter(
    (e): e is AgentSessionEvent => e.eventType === "agent_session"
  );
}

// Write telemetry state to test directory
function writeTelemetryStateToTest(state: TelemetryState): void {
  if (!existsSync(TEST_DATA_DIR)) {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  writeTelemetryState(state);
}

describe("extractCommandsFromTranscript", () => {
  test("extracts single command from transcript", () => {
    const transcript = "User ran /research-codebase src/";
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/research-codebase"]);
  });

  test("extracts multiple different commands", () => {
    const transcript = "First /commit was run, then /create-gh-pr was executed";
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toContain("/commit");
    expect(result).toContain("/create-gh-pr");
    expect(result).toHaveLength(2);
  });

  test("returns empty array for no commands", () => {
    const transcript = "Just some regular text without any commands";
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual([]);
  });

  test("counts all occurrences of repeated commands for usage frequency", () => {
    const transcript = "/commit was run, then /commit again and /commit once more";
    const result = extractCommandsFromTranscript(transcript);
    // Should count each occurrence for usage frequency tracking
    expect(result).toEqual(["/commit", "/commit", "/commit"]);
  });

  test("extracts namespaced commands", () => {
    const transcript = "Started /ralph:ralph-loop for automated testing";
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/ralph:ralph-loop"]);
  });

  test("extracts command at start of transcript", () => {
    const transcript = "/research-codebase was the first command";
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/research-codebase"]);
  });

  test("extracts command at end of transcript", () => {
    const transcript = "The last command was /commit";
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/commit"]);
  });

  test("extracts all variations of ralph commands", () => {
    const transcript = `
      /ralph-loop started
      /ralph:ralph-loop also works
      /cancel-ralph to stop
      /ralph:cancel-ralph alternative
      /ralph-help for info
      /ralph:help also shows help
    `;
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toContain("/ralph-loop");
    expect(result).toContain("/ralph:ralph-loop");
    expect(result).toContain("/cancel-ralph");
    expect(result).toContain("/ralph:cancel-ralph");
    expect(result).toContain("/ralph-help");
    expect(result).toContain("/ralph:help");
  });

  test("does not extract partial matches", () => {
    // /research-codebase-extra should not match /research-codebase
    const transcript = "Running /research-codebase-extra command";
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual([]);
  });

  test("extracts commands with arguments in transcript", () => {
    const transcript = "Ran /research-codebase src/utils/ to analyze code";
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/research-codebase"]);
  });

  test("handles empty transcript", () => {
    const result = extractCommandsFromTranscript("");
    expect(result).toEqual([]);
  });

  test("handles transcript with only whitespace", () => {
    const result = extractCommandsFromTranscript("   \n\t  ");
    expect(result).toEqual([]);
  });
});

describe("createSessionEvent", () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    writeTelemetryStateToTest(createEnabledState());
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  test("creates event with correct eventType", () => {
    const event = createSessionEvent("claude", ["/commit"]);
    expect(event.eventType).toBe("agent_session");
  });

  test("creates event with valid sessionId (UUID format)", () => {
    const event = createSessionEvent("claude", ["/commit"]);
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(event.sessionId).toMatch(uuidV4Regex);
  });

  test("creates event with eventId equal to sessionId", () => {
    const event = createSessionEvent("claude", ["/commit"]);
    expect(event.eventId).toBe(event.sessionId);
  });

  test("creates event with valid timestamp (ISO 8601 format)", () => {
    const event = createSessionEvent("claude", ["/commit"]);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  test("creates event with correct agentType", () => {
    const claudeEvent = createSessionEvent("claude", ["/commit"]);
    expect(claudeEvent.agentType).toBe("claude");

    const opencodeEvent = createSessionEvent("opencode", ["/commit"]);
    expect(opencodeEvent.agentType).toBe("opencode");

    const copilotEvent = createSessionEvent("copilot", ["/commit"]);
    expect(copilotEvent.agentType).toBe("copilot");
  });

  test("creates event with correct commands array", () => {
    const event = createSessionEvent("claude", ["/commit", "/create-gh-pr"]);
    expect(event.commands).toEqual(["/commit", "/create-gh-pr"]);
  });

  test("creates event with correct commandCount", () => {
    const singleCommand = createSessionEvent("claude", ["/commit"]);
    expect(singleCommand.commandCount).toBe(1);

    const multipleCommands = createSessionEvent("claude", [
      "/commit",
      "/create-gh-pr",
      "/research-codebase",
    ]);
    expect(multipleCommands.commandCount).toBe(3);
  });

  test("creates event with source as session_hook", () => {
    const event = createSessionEvent("claude", ["/commit"]);
    expect(event.source).toBe("session_hook");
  });

  test("creates event with correct platform", () => {
    const event = createSessionEvent("claude", ["/commit"]);
    expect(event.platform).toBe(process.platform);
  });

  test("creates event with anonymousId from state", () => {
    const event = createSessionEvent("claude", ["/commit"]);
    expect(event.anonymousId).toBe("session-test-uuid");
  });

  test("sets sessionStartedAt to null when not provided", () => {
    const event = createSessionEvent("claude", ["/commit"]);
    expect(event.sessionStartedAt).toBeNull();
  });

  test("sets sessionStartedAt when provided", () => {
    const startTime = "2026-01-15T10:30:00Z";
    const event = createSessionEvent("claude", ["/commit"], startTime);
    expect(event.sessionStartedAt).toBe(startTime);
  });

  test("handles empty commands array", () => {
    const event = createSessionEvent("claude", []);
    expect(event.commands).toEqual([]);
    expect(event.commandCount).toBe(0);
  });
});

describe("trackAgentSession", () => {
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

  test("does not write when telemetry is disabled via env var", () => {
    process.env.ATOMIC_TELEMETRY = "0";
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/commit"]);

    const events = readSessionEvents();
    expect(events).toHaveLength(0);
  });

  test("does not write when DO_NOT_TRACK is set", () => {
    process.env.DO_NOT_TRACK = "1";
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/commit"]);

    const events = readSessionEvents();
    expect(events).toHaveLength(0);
  });

  test("does not write when telemetry disabled in config", () => {
    const state = createEnabledState();
    state.enabled = false;
    writeTelemetryStateToTest(state);

    trackAgentSession("claude", ["/commit"]);

    const events = readSessionEvents();
    expect(events).toHaveLength(0);
  });

  test("does not write when commands array is empty", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", []);

    const events = readSessionEvents();
    expect(events).toHaveLength(0);
  });

  test("does not write when transcript has no commands", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", "Just some regular text without commands");

    const events = readSessionEvents();
    expect(events).toHaveLength(0);
  });

  test("writes AgentSessionEvent when enabled and commands provided as array", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/commit", "/create-gh-pr"]);

    const events = readSessionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("agent_session");
    expect(events[0]?.commands).toEqual(["/commit", "/create-gh-pr"]);
    expect(events[0]?.commandCount).toBe(2);
  });

  test("writes AgentSessionEvent when enabled and commands extracted from transcript", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", "User ran /research-codebase and then /commit");

    const events = readSessionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.commands).toContain("/research-codebase");
    expect(events[0]?.commands).toContain("/commit");
  });

  test("event contains correct agentType", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("opencode", ["/commit"]);

    const events = readSessionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.agentType).toBe("opencode");
  });

  test("event contains sessionStartedAt when provided", () => {
    writeTelemetryStateToTest(createEnabledState());

    const startTime = "2026-01-15T10:30:00Z";
    trackAgentSession("claude", ["/commit"], startTime);

    const events = readSessionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.sessionStartedAt).toBe(startTime);
  });

  test("event has source as session_hook", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/commit"]);

    const events = readSessionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("session_hook");
  });

  test("event uses anonymousId from state", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/commit"]);

    const events = readSessionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.anonymousId).toBe("session-test-uuid");
  });

  test("works with all agent types", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/commit"]);
    trackAgentSession("opencode", ["/research-codebase"]);
    trackAgentSession("copilot", ["/create-gh-pr"]);

    const events = readSessionEvents();
    expect(events).toHaveLength(3);
    expect(events[0]?.agentType).toBe("claude");
    expect(events[1]?.agentType).toBe("opencode");
    expect(events[2]?.agentType).toBe("copilot");
  });

  test("each event has unique sessionId", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/commit"]);
    trackAgentSession("claude", ["/research-codebase"]);
    trackAgentSession("claude", ["/create-gh-pr"]);

    const events = readSessionEvents();
    expect(events).toHaveLength(3);

    const sessionIds = events.map((e) => e.sessionId);
    const uniqueIds = new Set(sessionIds);
    expect(uniqueIds.size).toBe(3);
  });

  test("does not throw on write errors (fail-safe)", () => {
    writeTelemetryStateToTest(createEnabledState());

    // Make the events file a directory to cause a write error
    const eventsPath = getEventsFilePath();
    mkdirSync(eventsPath, { recursive: true });

    // Should not throw
    expect(() => {
      trackAgentSession("claude", ["/commit"]);
    }).not.toThrow();
  });
});
