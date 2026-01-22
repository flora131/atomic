/**
 * Integration tests for command tracking end-to-end
 *
 * Tests cover:
 * - init command produces atomic_command event in JSONL
 * - update command produces atomic_command event
 * - run command produces atomic_command event with agentType
 * - Opt-out via ATOMIC_TELEMETRY=0 prevents event writing
 * - Opt-out via DO_NOT_TRACK=1 prevents event writing
 *
 * Note: These tests use temporary directories for isolation.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { writeTelemetryState, getTelemetryFilePath } from "./telemetry";
import { getEventsFilePath, trackCliInvocation } from "./telemetry-cli";
import type {
  TelemetryState,
  AtomicCommandEvent,
  CliCommandEvent,
  TelemetryEvent,
} from "./types";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(
  tmpdir(),
  "atomic-telemetry-integration-test-" + Date.now()
);

// Mock getBinaryDataDir to use test directory
mock.module("../config-path", () => ({
  getBinaryDataDir: () => TEST_DATA_DIR,
  getConfigRoot: () => join(TEST_DATA_DIR, "config"),
  detectInstallationType: () => "source",
  getBinaryPath: () => join(TEST_DATA_DIR, "bin", "atomic"),
  getBinaryInstallDir: () => join(TEST_DATA_DIR, "bin"),
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
    anonymousId: "integration-test-uuid",
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

describe("Environment-based opt-out", () => {
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

  test("ATOMIC_TELEMETRY=0 prevents all event writing", async () => {
    process.env.ATOMIC_TELEMETRY = "0";
    writeTelemetryState(createEnabledState());

    // Import trackAtomicCommand after mocking
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("update", null, true);
    trackAtomicCommand("run", "opencode", true);

    const events = readEvents();
    expect(events).toHaveLength(0);
  });

  test("DO_NOT_TRACK=1 prevents all event writing", async () => {
    process.env.DO_NOT_TRACK = "1";
    writeTelemetryState(createEnabledState());

    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("update", null, true);
    trackAtomicCommand("run", "opencode", true);

    const events = readEvents();
    expect(events).toHaveLength(0);
  });

  test("Telemetry disabled in config prevents event writing", async () => {
    const state = createEnabledState();
    state.enabled = false;
    writeTelemetryState(state);

    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("init", "claude", true);

    const events = readEvents();
    expect(events).toHaveLength(0);
  });

  test("Missing consent prevents event writing", async () => {
    const state = createEnabledState();
    state.consentGiven = false;
    writeTelemetryState(state);

    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("init", "claude", true);

    const events = readEvents();
    expect(events).toHaveLength(0);
  });
});

describe("Command tracking events", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    // Reset env vars
    delete process.env.ATOMIC_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    // Enable telemetry for these tests
    writeTelemetryState(createEnabledState());
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    // Restore env
    process.env = { ...originalEnv };
  });

  test("init command produces atomic_command event with agentType", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("atomic_command");
    expect(events[0]?.command).toBe("init");
    expect(events[0]?.agentType).toBe("claude");
    expect(events[0]?.success).toBe(true);
    expect(events[0]?.source).toBe("cli");
  });

  test("update command produces atomic_command event without agentType", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("update", null, true);

    const events = readAtomicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("atomic_command");
    expect(events[0]?.command).toBe("update");
    expect(events[0]?.agentType).toBeNull();
    expect(events[0]?.success).toBe(true);
  });

  test("uninstall command produces atomic_command event without agentType", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("uninstall", null, true);

    const events = readAtomicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("atomic_command");
    expect(events[0]?.command).toBe("uninstall");
    expect(events[0]?.agentType).toBeNull();
  });

  test("run command produces atomic_command event with agentType", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("run", "opencode", true);

    const events = readAtomicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("atomic_command");
    expect(events[0]?.command).toBe("run");
    expect(events[0]?.agentType).toBe("opencode");
    expect(events[0]?.success).toBe(true);
  });

  test("run command works with all agent types", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("run", "claude", true);
    trackAtomicCommand("run", "opencode", true);
    trackAtomicCommand("run", "copilot", true);

    const events = readAtomicEvents();
    expect(events).toHaveLength(3);
    expect(events[0]?.agentType).toBe("claude");
    expect(events[1]?.agentType).toBe("opencode");
    expect(events[2]?.agentType).toBe("copilot");
  });

  test("failed command is tracked with success=false", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("init", "claude", false);

    const events = readAtomicEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.success).toBe(false);
  });

  test("multiple command sequence produces correct events", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    // Simulate typical user workflow
    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("run", "claude", true);
    trackAtomicCommand("run", "claude", true);
    trackAtomicCommand("update", null, true);
    trackAtomicCommand("run", "claude", true);

    const events = readAtomicEvents();
    expect(events).toHaveLength(5);

    expect(events[0]?.command).toBe("init");
    expect(events[1]?.command).toBe("run");
    expect(events[2]?.command).toBe("run");
    expect(events[3]?.command).toBe("update");
    expect(events[4]?.command).toBe("run");
  });

  test("events contain required metadata", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;

    // Required metadata
    expect(event.anonymousId).toBe("integration-test-uuid");
    expect(event.eventId).toBeDefined();
    expect(event.timestamp).toBeDefined();
    expect(event.platform).toBe(process.platform);
    expect(event.atomicVersion).toBeDefined();
    expect(event.source).toBe("cli");
  });

  test("JSONL format is valid and parseable", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("update", null, true);
    trackAtomicCommand("run", "opencode", true);

    const eventsPath = getEventsFilePath();
    const content = readFileSync(eventsPath, "utf-8");

    // Each line should be valid JSON
    const lines = content.split("\n").filter((line) => line.trim());
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // Lines should be newline-delimited
    expect(content.endsWith("\n")).toBe(true);
  });
});

describe("Event isolation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    delete process.env.ATOMIC_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    writeTelemetryState(createEnabledState());
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    process.env = { ...originalEnv };
  });

  test("events from different sessions have unique eventIds", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    // Simulate multiple sessions
    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("init", "claude", true);

    const events = readAtomicEvents();
    const eventIds = events.map((e) => e.eventId);
    const uniqueIds = new Set(eventIds);

    expect(uniqueIds.size).toBe(3);
  });

  test("events share the same anonymousId within a session", async () => {
    const { trackAtomicCommand } = await import("./telemetry-cli");

    trackAtomicCommand("init", "claude", true);
    trackAtomicCommand("run", "claude", true);
    trackAtomicCommand("update", null, true);

    const events = readAtomicEvents();
    const anonymousIds = events.map((e) => e.anonymousId);
    const uniqueIds = new Set(anonymousIds);

    expect(uniqueIds.size).toBe(1);
    expect(uniqueIds.has("integration-test-uuid")).toBe(true);
  });
});

describe("CLI invocation tracking", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    delete process.env.ATOMIC_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    writeTelemetryState(createEnabledState());
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    process.env = { ...originalEnv };
  });

  test("tracks slash commands from CLI invocation", async () => {
    const { trackCliInvocation } = await import("./telemetry-cli");

    trackCliInvocation("claude", ["/research-codebase", "src/"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event?.eventType).toBe("cli_command");
    expect(event?.commands).toEqual(["/research-codebase"]);
    expect(event?.commandCount).toBe(1);
    expect(event?.agentType).toBe("claude");
    expect(event?.source).toBe("cli");
    expect(event?.anonymousId).toBe("integration-test-uuid");
  });

  test("tracks multiple slash commands in single invocation", async () => {
    const { trackCliInvocation } = await import("./telemetry-cli");

    trackCliInvocation("claude", ["/research-codebase", "/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event?.commands).toEqual(["/research-codebase", "/commit"]);
    expect(event?.commandCount).toBe(2);
  });

  test("does not track when no slash commands present", async () => {
    const { trackCliInvocation } = await import("./telemetry-cli");

    trackCliInvocation("claude", ["fix the bug", "--help"]);

    const events = readCliEvents();
    expect(events).toHaveLength(0);
  });

  test("event structure matches CliCommandEvent interface", async () => {
    const { trackCliInvocation } = await import("./telemetry-cli");

    trackCliInvocation("claude", ["/research-codebase", "src/"]);

    const events = readCliEvents();
    expect(events).toHaveLength(1);

    const event = events[0];

    // Check all required fields exist and have correct types
    expect(typeof event?.anonymousId).toBe("string");
    expect(typeof event?.eventId).toBe("string");
    expect(event?.eventType).toBe("cli_command");
    expect(typeof event?.timestamp).toBe("string");
    expect(event?.agentType).toBe("claude");
    expect(Array.isArray(event?.commands)).toBe(true);
    expect(typeof event?.commandCount).toBe("number");
    expect(typeof event?.platform).toBe("string");
    expect(typeof event?.atomicVersion).toBe("string");
    expect(event?.source).toBe("cli");
  });

  test("JSONL contains both event types when both tracking methods used", async () => {
    const { trackAtomicCommand, trackCliInvocation } = await import(
      "./telemetry-cli"
    );

    // Simulate what happens in run-agent.ts
    trackAtomicCommand("run", "claude", true);
    trackCliInvocation("claude", ["/research-codebase", "src/"]);

    const allEvents = readEvents();
    expect(allEvents).toHaveLength(2);

    const atomicEvents = readAtomicEvents();
    const cliEvents = readCliEvents();

    expect(atomicEvents).toHaveLength(1);
    expect(cliEvents).toHaveLength(1);

    expect(atomicEvents[0]?.eventType).toBe("atomic_command");
    expect(cliEvents[0]?.eventType).toBe("cli_command");
  });

  test("events from different agents are tracked correctly", async () => {
    const { trackCliInvocation } = await import("./telemetry-cli");

    trackCliInvocation("claude", ["/commit"]);
    trackCliInvocation("opencode", ["/research-codebase"]);
    trackCliInvocation("copilot", ["/create-gh-pr"]);

    const events = readCliEvents();
    expect(events).toHaveLength(3);

    expect(events[0]?.agentType).toBe("claude");
    expect(events[0]?.commands).toEqual(["/commit"]);

    expect(events[1]?.agentType).toBe("opencode");
    expect(events[1]?.commands).toEqual(["/research-codebase"]);

    expect(events[2]?.agentType).toBe("copilot");
    expect(events[2]?.commands).toEqual(["/create-gh-pr"]);
  });

  test("ATOMIC_TELEMETRY=0 prevents CLI invocation tracking", async () => {
    process.env.ATOMIC_TELEMETRY = "0";

    const { trackCliInvocation } = await import("./telemetry-cli");

    trackCliInvocation("claude", ["/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(0);
  });

  test("DO_NOT_TRACK=1 prevents CLI invocation tracking", async () => {
    process.env.DO_NOT_TRACK = "1";

    const { trackCliInvocation } = await import("./telemetry-cli");

    trackCliInvocation("claude", ["/commit"]);

    const events = readCliEvents();
    expect(events).toHaveLength(0);
  });
});
