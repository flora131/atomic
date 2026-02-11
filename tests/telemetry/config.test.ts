/**
 * Unit tests for telemetry configuration module
 *
 * Tests cover:
 * - Environment variable detection (DO_NOT_TRACK, ATOMIC_TELEMETRY, CI)
 * - Platform-specific data directory detection
 * - Configuration loading with defaults and overrides
 * - Helper functions for configuration management
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as os from "os";
import * as path from "path";
import {
  loadTelemetryConfig,
  isTelemetryEnabled,
  getPlatformDataDir,
  getDefaultTelemetryLogPath,
  getAppInsightsKey,
  toCollectorConfig,
  describeTelemetryConfig,
  getTelemetryDisabledReason,
  TELEMETRY_ENV_VARS,
  type TelemetryConfig,
} from "../../src/telemetry/config.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Save and restore environment variables around tests.
 */
function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void
): void {
  const saved: Record<string, string | undefined> = {};

  // Save current values
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
  }

  // Set new values
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    // Restore original values
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// ============================================================================
// Setup - Clear relevant env vars before each test
// ============================================================================

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  // Save original values
  originalEnv.DO_NOT_TRACK = process.env.DO_NOT_TRACK;
  originalEnv.ATOMIC_TELEMETRY = process.env.ATOMIC_TELEMETRY;
  originalEnv.ATOMIC_APP_INSIGHTS_KEY = process.env.ATOMIC_APP_INSIGHTS_KEY;
  originalEnv.CI = process.env.CI;

  // Clear all telemetry-related env vars
  delete process.env.DO_NOT_TRACK;
  delete process.env.ATOMIC_TELEMETRY;
  delete process.env.ATOMIC_APP_INSIGHTS_KEY;
  delete process.env.CI;
});

afterEach(() => {
  // Restore original values
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

// ============================================================================
// TELEMETRY_ENV_VARS Tests
// ============================================================================

describe("TELEMETRY_ENV_VARS", () => {
  test("defines DO_NOT_TRACK constant", () => {
    expect(TELEMETRY_ENV_VARS.DO_NOT_TRACK).toBe("DO_NOT_TRACK");
  });

  test("defines ATOMIC_TELEMETRY constant", () => {
    expect(TELEMETRY_ENV_VARS.ATOMIC_TELEMETRY).toBe("ATOMIC_TELEMETRY");
  });

  test("defines ATOMIC_APP_INSIGHTS_KEY constant", () => {
    expect(TELEMETRY_ENV_VARS.ATOMIC_APP_INSIGHTS_KEY).toBe("ATOMIC_APP_INSIGHTS_KEY");
  });

  test("defines CI constant", () => {
    expect(TELEMETRY_ENV_VARS.CI).toBe("CI");
  });
});

// ============================================================================
// isTelemetryEnabled Tests
// ============================================================================

describe("isTelemetryEnabled", () => {
  test("returns true when no opt-out env vars set", () => {
    expect(isTelemetryEnabled()).toBe(true);
  });

  test("returns false when DO_NOT_TRACK=1", () => {
    process.env.DO_NOT_TRACK = "1";
    expect(isTelemetryEnabled()).toBe(false);
  });

  test("returns true when DO_NOT_TRACK is set to other values", () => {
    process.env.DO_NOT_TRACK = "0";
    expect(isTelemetryEnabled()).toBe(true);

    process.env.DO_NOT_TRACK = "true";
    expect(isTelemetryEnabled()).toBe(true);
  });

  test("returns false when ATOMIC_TELEMETRY=0", () => {
    process.env.ATOMIC_TELEMETRY = "0";
    expect(isTelemetryEnabled()).toBe(false);
  });

  test("returns true when ATOMIC_TELEMETRY is set to other values", () => {
    process.env.ATOMIC_TELEMETRY = "1";
    expect(isTelemetryEnabled()).toBe(true);

    process.env.ATOMIC_TELEMETRY = "false";
    expect(isTelemetryEnabled()).toBe(true);
  });

  test("returns false when CI=true", () => {
    process.env.CI = "true";
    expect(isTelemetryEnabled()).toBe(false);
  });

  test("returns true when CI is set to other values", () => {
    process.env.CI = "false";
    expect(isTelemetryEnabled()).toBe(true);

    process.env.CI = "1";
    expect(isTelemetryEnabled()).toBe(true);
  });

  test("DO_NOT_TRACK takes precedence", () => {
    process.env.DO_NOT_TRACK = "1";
    process.env.ATOMIC_TELEMETRY = "1"; // Would enable if DO_NOT_TRACK not checked first
    expect(isTelemetryEnabled()).toBe(false);
  });
});

// ============================================================================
// getPlatformDataDir Tests
// ============================================================================

describe("getPlatformDataDir", () => {
  test("returns a valid directory path", () => {
    const dataDir = getPlatformDataDir();
    expect(typeof dataDir).toBe("string");
    expect(dataDir.length).toBeGreaterThan(0);
  });

  test("returns platform-specific path", () => {
    const dataDir = getPlatformDataDir();
    const platform = os.platform();

    if (platform === "win32") {
      // Should contain AppData or Roaming
      expect(
        dataDir.includes("AppData") || dataDir.includes("Roaming")
      ).toBe(true);
    } else if (platform === "darwin") {
      // Should be Library/Application Support
      expect(dataDir).toContain("Library");
      expect(dataDir).toContain("Application Support");
    } else {
      // Linux: should be .local/share or XDG_DATA_HOME
      expect(
        dataDir.includes(".local/share") ||
        dataDir === process.env.XDG_DATA_HOME
      ).toBe(true);
    }
  });
});

// ============================================================================
// getDefaultTelemetryLogPath Tests
// ============================================================================

describe("getDefaultTelemetryLogPath", () => {
  test("returns path ending with atomic/telemetry", () => {
    const logPath = getDefaultTelemetryLogPath();
    expect(logPath).toMatch(/atomic[\/\\]telemetry$/);
  });

  test("returns path within platform data directory", () => {
    const logPath = getDefaultTelemetryLogPath();
    const dataDir = getPlatformDataDir();
    expect(logPath.startsWith(dataDir)).toBe(true);
  });

  test("returns consistent path across calls", () => {
    const path1 = getDefaultTelemetryLogPath();
    const path2 = getDefaultTelemetryLogPath();
    expect(path1).toBe(path2);
  });
});

// ============================================================================
// getAppInsightsKey Tests
// ============================================================================

describe("getAppInsightsKey", () => {
  test("returns undefined when env var not set", () => {
    expect(getAppInsightsKey()).toBeUndefined();
  });

  test("returns key when env var is set", () => {
    process.env.ATOMIC_APP_INSIGHTS_KEY = "test-key-123";
    expect(getAppInsightsKey()).toBe("test-key-123");
  });

  test("returns undefined for empty string", () => {
    process.env.ATOMIC_APP_INSIGHTS_KEY = "";
    expect(getAppInsightsKey()).toBeUndefined();
  });

  test("returns undefined for whitespace-only string", () => {
    process.env.ATOMIC_APP_INSIGHTS_KEY = "   ";
    expect(getAppInsightsKey()).toBeUndefined();
  });
});

// ============================================================================
// loadTelemetryConfig Tests
// ============================================================================

describe("loadTelemetryConfig", () => {
  test("returns config with enabled=true by default", () => {
    const config = loadTelemetryConfig();
    expect(config.enabled).toBe(true);
  });

  test("returns config with enabled=false when DO_NOT_TRACK=1", () => {
    process.env.DO_NOT_TRACK = "1";
    const config = loadTelemetryConfig();
    expect(config.enabled).toBe(false);
  });

  test("returns config with enabled=false when ATOMIC_TELEMETRY=0", () => {
    process.env.ATOMIC_TELEMETRY = "0";
    const config = loadTelemetryConfig();
    expect(config.enabled).toBe(false);
  });

  test("returns config with enabled=false when CI=true", () => {
    process.env.CI = "true";
    const config = loadTelemetryConfig();
    expect(config.enabled).toBe(false);
  });

  test("returns config with default localLogPath", () => {
    const config = loadTelemetryConfig();
    expect(config.localLogPath).toBe(getDefaultTelemetryLogPath());
  });

  test("returns config with appInsightsKey from env", () => {
    process.env.ATOMIC_APP_INSIGHTS_KEY = "my-key";
    const config = loadTelemetryConfig();
    expect(config.appInsightsKey).toBe("my-key");
  });

  test("returns config with undefined appInsightsKey when not set", () => {
    const config = loadTelemetryConfig();
    expect(config.appInsightsKey).toBeUndefined();
  });

  test("allows overriding enabled via options", () => {
    process.env.DO_NOT_TRACK = "1"; // Would disable
    const config = loadTelemetryConfig({ enabled: true });
    expect(config.enabled).toBe(true);
  });

  test("allows overriding localLogPath via options", () => {
    const customPath = "/custom/path";
    const config = loadTelemetryConfig({ localLogPath: customPath });
    expect(config.localLogPath).toBe(customPath);
  });

  test("allows overriding appInsightsKey via options", () => {
    process.env.ATOMIC_APP_INSIGHTS_KEY = "env-key";
    const config = loadTelemetryConfig({ appInsightsKey: "override-key" });
    expect(config.appInsightsKey).toBe("override-key");
  });

  test("returns all expected fields", () => {
    const config = loadTelemetryConfig();
    expect(config).toHaveProperty("enabled");
    expect(config).toHaveProperty("localLogPath");
    // appInsightsKey is optional, may be undefined
    expect("appInsightsKey" in config).toBe(true);
  });
});

// ============================================================================
// toCollectorConfig Tests
// ============================================================================

describe("toCollectorConfig", () => {
  test("converts TelemetryConfig to TelemetryCollectorConfig", () => {
    const config: TelemetryConfig = {
      enabled: true,
      localLogPath: "/path/to/logs",
      appInsightsKey: "key-123",
    };

    const collectorConfig = toCollectorConfig(config);

    expect(collectorConfig.enabled).toBe(true);
    expect(collectorConfig.localLogPath).toBe("/path/to/logs");
    expect(collectorConfig.appInsightsKey).toBe("key-123");
  });

  test("allows adding additional options", () => {
    const config: TelemetryConfig = {
      enabled: true,
      localLogPath: "/path/to/logs",
    };

    const collectorConfig = toCollectorConfig(config, {
      batchSize: 50,
      flushIntervalMs: 10000,
    });

    expect(collectorConfig.enabled).toBe(true);
    expect(collectorConfig.localLogPath).toBe("/path/to/logs");
    expect(collectorConfig.batchSize).toBe(50);
    expect(collectorConfig.flushIntervalMs).toBe(10000);
  });
});

// ============================================================================
// describeTelemetryConfig Tests
// ============================================================================

describe("describeTelemetryConfig", () => {
  test("includes enabled status", () => {
    const config: TelemetryConfig = {
      enabled: true,
      localLogPath: "/path/to/logs",
    };

    const description = describeTelemetryConfig(config);
    expect(description).toContain("Telemetry: enabled");
  });

  test("includes disabled status", () => {
    const config: TelemetryConfig = {
      enabled: false,
      localLogPath: "/path/to/logs",
    };

    const description = describeTelemetryConfig(config);
    expect(description).toContain("Telemetry: disabled");
  });

  test("includes log path", () => {
    const config: TelemetryConfig = {
      enabled: true,
      localLogPath: "/custom/log/path",
    };

    const description = describeTelemetryConfig(config);
    expect(description).toContain("Log path: /custom/log/path");
  });

  test("includes App Insights status when configured", () => {
    const config: TelemetryConfig = {
      enabled: true,
      localLogPath: "/path",
      appInsightsKey: "key-123",
    };

    const description = describeTelemetryConfig(config);
    expect(description).toContain("App Insights: configured");
  });

  test("excludes App Insights status when not configured", () => {
    const config: TelemetryConfig = {
      enabled: true,
      localLogPath: "/path",
    };

    const description = describeTelemetryConfig(config);
    expect(description).not.toContain("App Insights");
  });
});

// ============================================================================
// getTelemetryDisabledReason Tests
// ============================================================================

describe("getTelemetryDisabledReason", () => {
  test("returns null when telemetry is enabled", () => {
    expect(getTelemetryDisabledReason()).toBeNull();
  });

  test("returns DO_NOT_TRACK reason when set", () => {
    process.env.DO_NOT_TRACK = "1";
    const reason = getTelemetryDisabledReason();
    expect(reason).not.toBeNull();
    expect(reason?.envVar).toBe("DO_NOT_TRACK");
    expect(reason?.value).toBe("1");
  });

  test("returns ATOMIC_TELEMETRY reason when set", () => {
    process.env.ATOMIC_TELEMETRY = "0";
    const reason = getTelemetryDisabledReason();
    expect(reason).not.toBeNull();
    expect(reason?.envVar).toBe("ATOMIC_TELEMETRY");
    expect(reason?.value).toBe("0");
  });

  test("returns CI reason when set", () => {
    process.env.CI = "true";
    const reason = getTelemetryDisabledReason();
    expect(reason).not.toBeNull();
    expect(reason?.envVar).toBe("CI");
    expect(reason?.value).toBe("true");
  });

  test("returns DO_NOT_TRACK reason first when multiple set", () => {
    process.env.DO_NOT_TRACK = "1";
    process.env.ATOMIC_TELEMETRY = "0";
    process.env.CI = "true";

    const reason = getTelemetryDisabledReason();
    expect(reason?.envVar).toBe("DO_NOT_TRACK");
  });

  test("returns ATOMIC_TELEMETRY reason when DO_NOT_TRACK not set", () => {
    process.env.ATOMIC_TELEMETRY = "0";
    process.env.CI = "true";

    const reason = getTelemetryDisabledReason();
    expect(reason?.envVar).toBe("ATOMIC_TELEMETRY");
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  test("loadTelemetryConfig integrates with environment detection", () => {
    // Test the full flow from env vars to config
    process.env.ATOMIC_APP_INSIGHTS_KEY = "integration-test-key";

    const config = loadTelemetryConfig();

    expect(config.enabled).toBe(true);
    expect(config.localLogPath).toBe(getDefaultTelemetryLogPath());
    expect(config.appInsightsKey).toBe("integration-test-key");

    // Now disable and verify
    process.env.DO_NOT_TRACK = "1";
    const disabledConfig = loadTelemetryConfig();
    expect(disabledConfig.enabled).toBe(false);

    // Verify reason detection matches
    const reason = getTelemetryDisabledReason();
    expect(reason?.envVar).toBe("DO_NOT_TRACK");
  });

  test("config can be converted to collector config", () => {
    const config = loadTelemetryConfig({
      enabled: true,
      localLogPath: "/test/path",
      appInsightsKey: "test-key",
    });

    const collectorConfig = toCollectorConfig(config, {
      batchSize: 100,
      flushIntervalMs: 30000,
    });

    expect(collectorConfig.enabled).toBe(true);
    expect(collectorConfig.localLogPath).toBe("/test/path");
    expect(collectorConfig.appInsightsKey).toBe("test-key");
    expect(collectorConfig.batchSize).toBe(100);
    expect(collectorConfig.flushIntervalMs).toBe(30000);
  });
});
