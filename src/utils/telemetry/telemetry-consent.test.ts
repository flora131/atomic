/**
 * Unit tests for telemetry consent module
 *
 * Tests cover:
 * - First-run detection via isFirstRun()
 * - Consent prompt behavior via promptTelemetryConsent()
 * - Consent flow orchestration via handleTelemetryConsent()
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(tmpdir(), "atomic-telemetry-consent-test-" + Date.now());

// Mock getBinaryDataDir to use test directory
mock.module("../config-path", () => ({
  getBinaryDataDir: () => TEST_DATA_DIR,
}));

// Track mock calls and return values
let confirmReturnValue: boolean | symbol = true;
let isCancelReturnValue = false;
const noteCalls: Array<[string, string?]> = [];
const logInfoCalls: string[] = [];

mock.module("@clack/prompts", () => ({
  confirm: async () => confirmReturnValue,
  note: (message: string, title?: string) => {
    noteCalls.push([message, title]);
  },
  log: {
    info: (message: string) => {
      logInfoCalls.push(message);
    },
  },
  isCancel: (value: unknown) => isCancelReturnValue || value === Symbol.for("cancel"),
}));

// Import after mocks are set up
import { isFirstRun, promptTelemetryConsent, handleTelemetryConsent } from "./telemetry-consent";
import { readTelemetryState, writeTelemetryState, getTelemetryFilePath } from "./telemetry";
import type { TelemetryState } from "./types";

describe("isFirstRun", () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  test("returns true when no telemetry state exists", () => {
    expect(isFirstRun()).toBe(true);
  });

  test("returns false when telemetry state exists", () => {
    const state: TelemetryState = {
      enabled: false,
      consentGiven: false,
      anonymousId: "test-uuid",
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    writeTelemetryState(state);

    expect(isFirstRun()).toBe(false);
  });

  test("returns false even when telemetry is disabled (state file exists)", () => {
    const state: TelemetryState = {
      enabled: false,
      consentGiven: false,
      anonymousId: "test-uuid",
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    writeTelemetryState(state);

    expect(isFirstRun()).toBe(false);
  });
});

describe("promptTelemetryConsent", () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    // Reset mock state
    confirmReturnValue = true;
    isCancelReturnValue = false;
    noteCalls.length = 0;
    logInfoCalls.length = 0;
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  test("returns true when user confirms", async () => {
    confirmReturnValue = true;
    isCancelReturnValue = false;

    const result = await promptTelemetryConsent();

    expect(result).toBe(true);
  });

  test("returns false when user declines", async () => {
    confirmReturnValue = false;
    isCancelReturnValue = false;

    const result = await promptTelemetryConsent();

    expect(result).toBe(false);
  });

  test("returns false when user cancels (Ctrl+C)", async () => {
    confirmReturnValue = Symbol.for("cancel");
    isCancelReturnValue = true;

    const result = await promptTelemetryConsent();

    expect(result).toBe(false);
  });

  test("displays informational note about what is collected", async () => {
    confirmReturnValue = true;
    isCancelReturnValue = false;

    await promptTelemetryConsent();

    expect(noteCalls.length).toBeGreaterThan(0);
    // Check that the note was called with content about what we collect
    const noteContent = noteCalls[0]?.[0] ?? "";
    expect(noteContent).toContain("Command names");
    expect(noteContent).toContain("Agent type");
    expect(noteContent).toContain("Success/failure status");
  });

  test("displays opt-out hint", async () => {
    confirmReturnValue = true;
    isCancelReturnValue = false;

    await promptTelemetryConsent();

    // Check that log.info was called with opt-out hint
    const optOutHintCall = logInfoCalls.find((call) =>
      call.includes("ATOMIC_TELEMETRY=0")
    );
    expect(optOutHintCall).toBeDefined();
  });
});

describe("handleTelemetryConsent", () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    // Reset mock state
    confirmReturnValue = true;
    isCancelReturnValue = false;
    noteCalls.length = 0;
    logInfoCalls.length = 0;
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  test("skips prompt when not first run", async () => {
    // Create existing state to simulate not first run
    const state: TelemetryState = {
      enabled: true,
      consentGiven: true,
      anonymousId: "existing-uuid",
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    writeTelemetryState(state);

    await handleTelemetryConsent();

    // Note should not have been called (indicates prompt was skipped)
    expect(noteCalls.length).toBe(0);
  });

  test("enables telemetry when user consents on first run", async () => {
    confirmReturnValue = true;
    isCancelReturnValue = false;

    await handleTelemetryConsent();

    const state = readTelemetryState();
    expect(state?.enabled).toBe(true);
    expect(state?.consentGiven).toBe(true);
  });

  test("disables telemetry but creates state when user declines on first run", async () => {
    confirmReturnValue = false;
    isCancelReturnValue = false;

    await handleTelemetryConsent();

    const state = readTelemetryState();
    expect(state?.enabled).toBe(false);
    // State file should exist to prevent re-prompting
    expect(existsSync(getTelemetryFilePath())).toBe(true);
  });

  test("creates state file even when user cancels (prevents re-prompting)", async () => {
    confirmReturnValue = Symbol.for("cancel");
    isCancelReturnValue = true;

    await handleTelemetryConsent();

    // State file should exist to prevent re-prompting
    expect(existsSync(getTelemetryFilePath())).toBe(true);
    const state = readTelemetryState();
    expect(state?.enabled).toBe(false);
  });
});
