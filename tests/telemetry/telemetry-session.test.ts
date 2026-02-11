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
} from "../../src/utils/telemetry/telemetry-session";
import { writeTelemetryState, getTelemetryFilePath } from "../../src/utils/telemetry/telemetry";
import { getEventsFilePath } from "../../src/utils/telemetry/telemetry-cli";
import type { TelemetryState, AgentSessionEvent, TelemetryEvent } from "../../src/utils/telemetry/types";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(tmpdir(), "atomic-telemetry-session-test-" + Date.now());

// Mock getBinaryDataDir to use test directory
mock.module("../../src/utils/config-path", () => ({
  getBinaryDataDir: () => TEST_DATA_DIR,
}));

// Mock ci-info to prevent CI detection from disabling telemetry in tests
mock.module("ci-info", () => ({
  isCI: false,
}));

// Helper to create enabled telemetry state
// Uses current month for rotatedAt to prevent ID rotation during tests
function createEnabledState(): TelemetryState {
  const now = new Date();
  const currentMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).toISOString();
  return {
    enabled: true,
    consentGiven: true,
    anonymousId: "session-test-uuid",
    createdAt: currentMonth,
    rotatedAt: currentMonth,
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

// Helper to read events from ALL agent-specific files
function readAllEvents(): TelemetryEvent[] {
  const agents = ["claude", "opencode", "copilot", "atomic"];
  const allEvents: TelemetryEvent[] = [];

  for (const agent of agents) {
    const events = readEvents(agent);
    allEvents.push(...events);
  }

  return allEvents;
}

// Helper to read only AgentSessionEvents
function readSessionEvents(agentType?: string | null): AgentSessionEvent[] {
  return readEvents(agentType).filter(
    (e): e is AgentSessionEvent => e.eventType === "agent_session"
  );
}

// Helper to read all AgentSessionEvents from all files
function readAllSessionEvents(): AgentSessionEvent[] {
  return readAllEvents().filter(
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

// Helper to create JSONL message matching Claude Code format
function createMessage(type: "user" | "assistant" | "system", text: string): string {
  return JSON.stringify({
    type,
    message: {
      role: type,
      // User messages have content as string, assistant/system as array
      content: type === "user" ? text : [{ type: "text", text }],
    },
  });
}

describe("extractCommandsFromTranscript", () => {
  test("extracts single command from user message", () => {
    const transcript = createMessage("user", "/research-codebase src/");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/research-codebase"]);
  });

  test("extracts multiple different commands from user message", () => {
    const transcript = createMessage("user", "First /research-codebase was run, then /create-spec");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toContain("/research-codebase");
    expect(result).toContain("/create-spec");
    expect(result).toHaveLength(2);
  });

  test("ignores commands in system messages (skill instructions)", () => {
    const transcript = createMessage("system", "Run the /ralph command to start the loop");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual([]);
  });

  test("ignores commands in assistant messages (suggestions)", () => {
    const transcript = createMessage("assistant", "You should run /ralph next");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual([]);
  });

  test("only extracts from user messages in mixed transcript", () => {
    const transcript = [
      createMessage("system", "Instructions: Use /ralph to start"),
      createMessage("user", "/research-codebase src/"),
      createMessage("assistant", "Great! Now run /ralph"),
      createMessage("user", "/ralph"),
    ].join("\n");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/research-codebase", "/ralph"]);
  });

  test("returns empty array for no commands in user messages", () => {
    const transcript = createMessage("user", "Just some regular text without commands");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual([]);
  });

  test("counts all occurrences of repeated commands for usage frequency", () => {
    const transcript = createMessage("user", "/ralph first, then /ralph again, and /ralph once more");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/ralph", "/ralph", "/ralph"]);
  });

  test("extracts /ralph workflow command", () => {
    // Note: /ralph:ralph-help removed - replaced by SDK-native /ralph workflow
    const transcript = createMessage("user", "/ralph");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/ralph"]);
  });


  test("extracts ralph workflow command from user", () => {
    // Note: /ralph:ralph-help removed - replaced by SDK-native /ralph workflow
    const transcript = createMessage(
      "user",
      "/ralph with some args"
    );
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toContain("/ralph");
  });

  test("does not extract partial matches", () => {
    const transcript = createMessage("user", "/research-codebase-extra command");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual([]);
  });

  test("extracts commands with arguments", () => {
    const transcript = createMessage("user", "/research-codebase src/utils/");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/research-codebase"]);
  });

  test("handles empty transcript", () => {
    const result = extractCommandsFromTranscript("");
    expect(result).toEqual([]);
  });

  test("handles invalid JSON gracefully", () => {
    const transcript = "not valid json\n{also invalid}";
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual([]);
  });

  test("handles mixed valid and invalid lines", () => {
    const transcript = [
      "invalid line",
      createMessage("user", "/research-codebase"),
      "{broken json",
      createMessage("user", "/explain-code"),
    ].join("\n");
    const result = extractCommandsFromTranscript(transcript);
    expect(result).toEqual(["/research-codebase", "/explain-code"]);
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

  test("creates event with correct structure and format", () => {
    const event = createSessionEvent("claude", ["/research-codebase", "/explain-code"]);

    // Event type and IDs
    expect(event.eventType).toBe("agent_session");
    expect(event.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(event.eventId).toBe(event.sessionId);

    // Timestamp
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);

    // Agent and commands
    expect(event.agentType).toBe("claude");
    expect(event.commands).toEqual(["/research-codebase", "/explain-code"]);
    expect(event.commandCount).toBe(2);

    // Metadata
    expect(event.source).toBe("session_hook");
    expect(event.platform).toBe(process.platform);
    expect(event.anonymousId).toBe("session-test-uuid");
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

  test("does not write when telemetry is disabled", () => {
    // Test env var: ATOMIC_TELEMETRY=0
    process.env.ATOMIC_TELEMETRY = "0";
    writeTelemetryStateToTest(createEnabledState());
    trackAgentSession("claude", ["/ralph"]);
    expect(readSessionEvents("claude")).toHaveLength(0);
    delete process.env.ATOMIC_TELEMETRY;

    // Clean up for next test
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });

    // Test env var: DO_NOT_TRACK=1
    process.env.DO_NOT_TRACK = "1";
    writeTelemetryStateToTest(createEnabledState());
    trackAgentSession("claude", ["/ralph"]);
    expect(readSessionEvents("claude")).toHaveLength(0);
    delete process.env.DO_NOT_TRACK;

    // Clean up for next test
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });

    // Test config: enabled=false
    const disabledState = createEnabledState();
    disabledState.enabled = false;
    writeTelemetryStateToTest(disabledState);
    trackAgentSession("claude", ["/ralph"]);
    expect(readSessionEvents("claude")).toHaveLength(0);
  });

  test("does not write when commands array is empty", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", []);

    const events = readSessionEvents("claude");
    expect(events).toHaveLength(0);
  });

  test("does not write when transcript has no commands", () => {
    writeTelemetryStateToTest(createEnabledState());

    const transcript = createMessage("user", "Just some regular text without commands");
    trackAgentSession("claude", transcript);

    const events = readSessionEvents("claude");
    expect(events).toHaveLength(0);
  });

  test("writes AgentSessionEvent when enabled and commands provided as array", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/research-codebase", "/explain-code"]);

    const events = readSessionEvents("claude");
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("agent_session");
    expect(events[0]?.commands).toEqual(["/research-codebase", "/explain-code"]);
    expect(events[0]?.commandCount).toBe(2);
  });

  test("writes AgentSessionEvent when enabled and commands extracted from transcript", () => {
    writeTelemetryStateToTest(createEnabledState());

    const transcript = createMessage("user", "/research-codebase and then /ralph");
    trackAgentSession("claude", transcript);

    const events = readSessionEvents("claude");
    expect(events).toHaveLength(1);
    expect(events[0]?.commands).toContain("/research-codebase");
    expect(events[0]?.commands).toContain("/ralph");
  });

  test("event contains correct agentType", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("opencode", ["/ralph"]);

    const events = readSessionEvents("opencode");
    expect(events).toHaveLength(1);
    expect(events[0]?.agentType).toBe("opencode");
  });

  test("event has source as session_hook", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/ralph"]);

    const events = readSessionEvents("claude");
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("session_hook");
  });

  test("event uses anonymousId from state", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/ralph"]);

    const events = readSessionEvents("claude");
    expect(events).toHaveLength(1);
    expect(events[0]?.anonymousId).toBe("session-test-uuid");
  });

  test("works with all agent types", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/ralph"]);
    trackAgentSession("opencode", ["/research-codebase"]);
    trackAgentSession("copilot", ["/explain-code"]);

    const events = readAllSessionEvents();
    expect(events).toHaveLength(3);
    expect(events[0]?.agentType).toBe("claude");
    expect(events[1]?.agentType).toBe("opencode");
    expect(events[2]?.agentType).toBe("copilot");
  });

  test("each event has unique sessionId", () => {
    writeTelemetryStateToTest(createEnabledState());

    trackAgentSession("claude", ["/ralph"]);
    trackAgentSession("claude", ["/research-codebase"]);
    trackAgentSession("claude", ["/explain-code"]);

    const events = readAllSessionEvents();
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
      trackAgentSession("claude", ["/ralph"]);
    }).not.toThrow();
  });
});
