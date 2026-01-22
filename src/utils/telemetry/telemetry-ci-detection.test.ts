/**
 * Tests for CI environment detection in telemetry
 *
 * This file is separate because ci-info is cached after first import.
 * Other telemetry tests mock ci-info with isCI: false to test consent/config logic.
 * This file mocks ci-info with isCI: true to verify CI detection works.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(tmpdir(), "atomic-telemetry-ci-test-" + Date.now());

// Mock getBinaryDataDir to use test directory
mock.module("../config-path", () => ({
  getBinaryDataDir: () => TEST_DATA_DIR,
}));

// Mock ci-info to simulate CI environment
mock.module("ci-info", () => ({
  isCI: true,
}));

// Import after mocks are set up
import { isTelemetryEnabled, getTelemetryFilePath } from "./telemetry";
import type { TelemetryState } from "./types";

describe("CI environment detection", () => {
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

  test("returns false when ci-info detects CI environment", async () => {
    // Set up a fully enabled telemetry state
    const state: TelemetryState = {
      enabled: true,
      consentGiven: true,
      anonymousId: "test-uuid",
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    const filePath = getTelemetryFilePath();
    writeFileSync(filePath, JSON.stringify(state), "utf-8");

    // Even with telemetry enabled and consent given, CI detection should override
    expect(await isTelemetryEnabled()).toBe(false);
  });

  test("CI detection takes priority over enabled config", async () => {
    // This verifies the priority order: CI > env vars > config
    const state: TelemetryState = {
      enabled: true,
      consentGiven: true,
      anonymousId: "priority-test-uuid",
      createdAt: new Date().toISOString(),
      rotatedAt: new Date().toISOString(),
    };
    const filePath = getTelemetryFilePath();
    writeFileSync(filePath, JSON.stringify(state), "utf-8");

    // Should be false because CI detection happens before config check
    expect(await isTelemetryEnabled()).toBe(false);
  });
});
