/**
 * Unit tests for config command
 *
 * Tests cover:
 * - atomic config set telemetry true (enables telemetry)
 * - atomic config set telemetry false (disables telemetry)
 * - Error handling for invalid inputs
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Use a temp directory for tests to avoid polluting real config
const TEST_DATA_DIR = join(tmpdir(), "atomic-config-test-" + Date.now());

// Mock getBinaryDataDir to use test directory
mock.module("../utils/config-path", () => ({
  getBinaryDataDir: () => TEST_DATA_DIR,
}));

// Mock @clack/prompts
const mockLogSuccess = mock(() => {});
const mockLogError = mock(() => {});

mock.module("@clack/prompts", () => ({
  log: {
    success: mockLogSuccess,
    error: mockLogError,
  },
}));

// Mock process.exit to prevent test from actually exiting
const mockExit = spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});

// Import after mocks are set up
import { configCommand } from "./config";
import { readTelemetryState, writeTelemetryState } from "../utils/telemetry/telemetry";
import type { TelemetryState } from "../utils/telemetry/types";

describe("configCommand", () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    // Reset mocks
    mockLogSuccess.mockClear();
    mockLogError.mockClear();
    mockExit.mockClear();
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  describe("atomic config set telemetry true", () => {
    test("enables telemetry and shows success message", async () => {
      await configCommand("set", "telemetry", "true");

      const state = readTelemetryState();
      expect(state?.enabled).toBe(true);
      expect(state?.consentGiven).toBe(true);
      expect(mockLogSuccess).toHaveBeenCalledWith("Telemetry has been enabled.");
    });
  });

  describe("atomic config set telemetry false", () => {
    test("disables telemetry and shows success message", async () => {
      // First enable telemetry
      await configCommand("set", "telemetry", "true");
      mockLogSuccess.mockClear();

      // Then disable
      await configCommand("set", "telemetry", "false");

      const state = readTelemetryState();
      expect(state?.enabled).toBe(false);
      expect(mockLogSuccess).toHaveBeenCalledWith("Telemetry has been disabled.");
    });
  });

  describe("error handling", () => {
    test("shows error for missing subcommand", async () => {
      await expect(configCommand(undefined, "telemetry", "true")).rejects.toThrow("process.exit called");
      expect(mockLogError).toHaveBeenCalledWith(
        "Missing subcommand. Usage: atomic config set <key> <value>"
      );
    });

    test("shows error for invalid subcommand", async () => {
      await expect(configCommand("get", "telemetry", "true")).rejects.toThrow("process.exit called");
      expect(mockLogError).toHaveBeenCalledWith(
        "Unknown subcommand: get. Only 'set' is supported."
      );
    });

    test("shows error for missing key", async () => {
      await expect(configCommand("set", undefined, "true")).rejects.toThrow("process.exit called");
      expect(mockLogError).toHaveBeenCalledWith(
        "Missing key. Usage: atomic config set <key> <value>"
      );
    });

    test("shows error for invalid key", async () => {
      await expect(configCommand("set", "unknown", "true")).rejects.toThrow("process.exit called");
      expect(mockLogError).toHaveBeenCalledWith(
        "Unknown config key: unknown. Only 'telemetry' is supported."
      );
    });

    test("shows error for missing value", async () => {
      await expect(configCommand("set", "telemetry", undefined)).rejects.toThrow("process.exit called");
      expect(mockLogError).toHaveBeenCalledWith(
        "Missing value. Usage: atomic config set telemetry <true|false>"
      );
    });

    test("shows error for invalid value (not true/false)", async () => {
      await expect(configCommand("set", "telemetry", "yes")).rejects.toThrow("process.exit called");
      expect(mockLogError).toHaveBeenCalledWith(
        "Invalid value: yes. Must be 'true' or 'false'."
      );
    });

    test("shows error for invalid value (number)", async () => {
      await expect(configCommand("set", "telemetry", "1")).rejects.toThrow("process.exit called");
      expect(mockLogError).toHaveBeenCalledWith(
        "Invalid value: 1. Must be 'true' or 'false'."
      );
    });
  });
});
