/**
 * Unit tests for telemetry core module
 *
 * Tests cover:
 * - Anonymous ID generation (UUID v4 format)
 * - State persistence (read/write/corrupted handling)
 * - Monthly ID rotation
 * - Priority-based opt-out checking
 * - State initialization and lazy creation
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  generateAnonymousId,
  getTelemetryFilePath,
  readTelemetryState,
  writeTelemetryState,
  shouldRotateId,
  rotateAnonymousId,
  initializeTelemetryState,
  getOrCreateTelemetryState,
  isTelemetryEnabled,
  isTelemetryEnabledSync,
  setTelemetryEnabled,
} from "../../src/utils/telemetry/telemetry";
import type { TelemetryState } from "../../src/utils/telemetry/types";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(tmpdir(), "atomic-telemetry-test-" + Date.now());

// Mock getBinaryDataDir to use test directory
mock.module("../../src/utils/config-path", () => ({
  getBinaryDataDir: () => TEST_DATA_DIR,
}));

// Mock ci-info to prevent CI detection from disabling telemetry in tests
// CI detection is tested separately in telemetry-ci-detection.test.ts
mock.module("ci-info", () => ({
  isCI: false,
}));

describe("generateAnonymousId", () => {
  test("produces valid UUID v4 format", () => {
    const id = generateAnonymousId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidV4Regex);
  });

  test("generates unique IDs on successive calls", () => {
    const id1 = generateAnonymousId();
    const id2 = generateAnonymousId();
    expect(id1).not.toBe(id2);
  });
});

describe("getTelemetryFilePath", () => {
  test("returns path to telemetry.json in data directory", () => {
    const path = getTelemetryFilePath();
    expect(path).toContain("telemetry.json");
    expect(path).toContain(TEST_DATA_DIR);
  });
});

describe("readTelemetryState", () => {
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

  test("returns null for missing file", () => {
    const state = readTelemetryState();
    expect(state).toBeNull();
  });

  test("returns null for corrupted JSON", () => {
    const filePath = getTelemetryFilePath();
    writeFileSync(filePath, "{ not valid json", "utf-8");

    const state = readTelemetryState();
    expect(state).toBeNull();
  });

  test("returns null for missing required fields", () => {
    const filePath = getTelemetryFilePath();
    writeFileSync(filePath, JSON.stringify({ enabled: true }), "utf-8");

    const state = readTelemetryState();
    expect(state).toBeNull();
  });

  test("reads valid state correctly", () => {
    const validState: TelemetryState = {
      enabled: true,
      consentGiven: true,
      anonymousId: "test-uuid-1234",
      createdAt: "2026-01-01T00:00:00Z",
      rotatedAt: "2026-01-01T00:00:00Z",
    };
    const filePath = getTelemetryFilePath();
    writeFileSync(filePath, JSON.stringify(validState), "utf-8");

    const state = readTelemetryState();
    expect(state).toEqual(validState);
  });
});

describe("writeTelemetryState", () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  test("creates directory and writes file", () => {
    const state: TelemetryState = {
      enabled: false,
      consentGiven: false,
      anonymousId: "test-uuid",
      createdAt: "2026-01-01T00:00:00Z",
      rotatedAt: "2026-01-01T00:00:00Z",
    };

    writeTelemetryState(state);

    expect(existsSync(TEST_DATA_DIR)).toBe(true);
    const filePath = getTelemetryFilePath();
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(JSON.parse(content)).toEqual(state);
  });
});

describe("shouldRotateId", () => {
  test("returns true when month or year differs from rotatedAt", () => {
    const state: TelemetryState = {
      enabled: true,
      consentGiven: true,
      anonymousId: "test",
      createdAt: "2026-01-01T00:00:00Z",
      rotatedAt: "2025-12-15T00:00:00Z", // Different month and year
    };

    expect(shouldRotateId(state)).toBe(true);
  });

  test("returns false within same month", () => {
    const now = new Date();
    const sameMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).toISOString();

    const state: TelemetryState = {
      enabled: true,
      consentGiven: true,
      anonymousId: "test",
      createdAt: sameMonth,
      rotatedAt: sameMonth,
    };

    expect(shouldRotateId(state)).toBe(false);
  });
});

describe("rotateAnonymousId", () => {
  test("rotates ID and timestamp while preserving other fields", () => {
    const oldState: TelemetryState = {
      enabled: false,
      consentGiven: true,
      anonymousId: "old-uuid",
      createdAt: "2026-01-01T00:00:00Z",
      rotatedAt: "2026-01-01T00:00:00Z",
    };

    const newState = rotateAnonymousId(oldState);

    // New ID generated
    expect(newState.anonymousId).not.toBe(oldState.anonymousId);
    expect(newState.anonymousId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    // Timestamp updated
    expect(new Date(newState.rotatedAt).getTime()).toBeGreaterThan(
      new Date(oldState.rotatedAt).getTime()
    );

    // Other fields preserved
    expect(newState.enabled).toBe(oldState.enabled);
    expect(newState.consentGiven).toBe(oldState.consentGiven);
    expect(newState.createdAt).toBe(oldState.createdAt);
  });
});

describe("initializeTelemetryState", () => {
  test("initializes with correct defaults", () => {
    const state = initializeTelemetryState();

    // Defaults
    expect(state.enabled).toBe(false);
    expect(state.consentGiven).toBe(false);

    // UUID format
    expect(state.anonymousId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    // Timestamp format
    expect(state.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(state.rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("getOrCreateTelemetryState", () => {
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

  test("creates new state when file missing", () => {
    const state = getOrCreateTelemetryState();

    expect(state).toBeDefined();
    expect(state.enabled).toBe(false);
    expect(state.consentGiven).toBe(false);
    expect(existsSync(getTelemetryFilePath())).toBe(true);
  });

  test("returns existing state when file exists", () => {
    const existingState: TelemetryState = {
      enabled: true,
      consentGiven: true,
      anonymousId: "existing-uuid",
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    writeTelemetryState(existingState);

    const state = getOrCreateTelemetryState();

    expect(state.anonymousId).toBe("existing-uuid");
    expect(state.enabled).toBe(true);
  });

  test("rotates ID on existing state when month changed", () => {
    const oldState: TelemetryState = {
      enabled: true,
      consentGiven: true,
      anonymousId: "old-uuid",
      createdAt: "2025-06-01T00:00:00Z",
      rotatedAt: "2025-06-01T00:00:00Z", // Old month
    };
    writeTelemetryState(oldState);

    const state = getOrCreateTelemetryState();

    expect(state.anonymousId).not.toBe("old-uuid");
    expect(state.enabled).toBe(true); // Preserved
  });
});

describe("isTelemetryEnabled", () => {
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

  test("returns false when ATOMIC_TELEMETRY disables telemetry", async () => {
    process.env.ATOMIC_TELEMETRY = "0";
    expect(await isTelemetryEnabled()).toBe(false);
  });

  test("returns false for DO_NOT_TRACK=1", async () => {
    process.env.DO_NOT_TRACK = "1";
    expect(await isTelemetryEnabled()).toBe(false);
  });

  test("returns false when config file missing (no consent)", async () => {
    expect(await isTelemetryEnabled()).toBe(false);
  });

  test("returns false when enabled=false in config", async () => {
    const state: TelemetryState = {
      enabled: false,
      consentGiven: true,
      anonymousId: "test",
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    writeTelemetryState(state);

    expect(await isTelemetryEnabled()).toBe(false);
  });

  test("returns false when consentGiven=false in config", async () => {
    const state: TelemetryState = {
      enabled: true,
      consentGiven: false,
      anonymousId: "test",
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    writeTelemetryState(state);

    expect(await isTelemetryEnabled()).toBe(false);
  });

  test("returns true when enabled and consent given", async () => {
    const state: TelemetryState = {
      enabled: true,
      consentGiven: true,
      anonymousId: "test",
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    writeTelemetryState(state);

    expect(await isTelemetryEnabled()).toBe(true);
  });
});

describe("setTelemetryEnabled", () => {
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

  test("enables telemetry and sets consent", () => {
    setTelemetryEnabled(true);

    const state = readTelemetryState();
    expect(state?.enabled).toBe(true);
    expect(state?.consentGiven).toBe(true);
  });

  test("disables telemetry", () => {
    // First enable
    setTelemetryEnabled(true);
    // Then disable
    setTelemetryEnabled(false);

    const state = readTelemetryState();
    expect(state?.enabled).toBe(false);
    expect(state?.consentGiven).toBe(true); // Consent remains true
  });

  test("creates state if not exists when enabling", () => {
    setTelemetryEnabled(true);

    expect(existsSync(getTelemetryFilePath())).toBe(true);
    const state = readTelemetryState();
    expect(state?.enabled).toBe(true);
  });
});
