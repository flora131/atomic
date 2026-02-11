/**
 * Unit tests for UnifiedTelemetryCollector
 *
 * Tests cover:
 * - Collector creation and configuration
 * - Event tracking and buffering
 * - Flush behavior (local and remote)
 * - Environment variable handling
 * - Shutdown behavior
 * - Factory functions
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  UnifiedTelemetryCollector,
  createTelemetryCollector,
  createNoopCollector,
  getGlobalCollector,
  setGlobalCollector,
  resetGlobalCollector,
  generateAnonymousId,
  getDefaultLogPath,
  shouldEnableTelemetry,
} from "../../src/telemetry/collector.ts";
import type { TelemetryCollector, FlushResult } from "../../src/telemetry/types.ts";

// ============================================================================
// Test Setup
// ============================================================================

let testLogDir: string;

beforeEach(async () => {
  // Create temp directory for tests
  testLogDir = path.join(os.tmpdir(), `telemetry-test-${Date.now()}`);
  await fs.mkdir(testLogDir, { recursive: true });

  // Reset global collector
  resetGlobalCollector();

  // Reset environment variables
  delete process.env.DO_NOT_TRACK;
  delete process.env.ATOMIC_TELEMETRY;
  delete process.env.CI;
  delete process.env.ATOMIC_APP_INSIGHTS_KEY;
});

afterEach(async () => {
  // Clean up temp directory
  try {
    await fs.rm(testLogDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ============================================================================
// generateAnonymousId Tests
// ============================================================================

describe("generateAnonymousId", () => {
  test("generates consistent ID for same machine", () => {
    const id1 = generateAnonymousId();
    const id2 = generateAnonymousId();

    expect(id1).toBe(id2);
  });

  test("generates UUID-like format", () => {
    const id = generateAnonymousId();

    // Should have 5 parts separated by dashes
    const parts = id.split("-");
    expect(parts.length).toBe(5);

    // Total length should be 36 (32 hex chars + 4 dashes)
    expect(id.length).toBe(36);
  });

  test("generates hex characters only", () => {
    const id = generateAnonymousId();
    const hexOnly = id.replace(/-/g, "");

    expect(hexOnly).toMatch(/^[0-9a-f]+$/);
  });
});

// ============================================================================
// getDefaultLogPath Tests
// ============================================================================

describe("getDefaultLogPath", () => {
  test("returns a valid path", () => {
    const logPath = getDefaultLogPath();

    expect(logPath).toBeDefined();
    expect(typeof logPath).toBe("string");
    expect(logPath.length).toBeGreaterThan(0);
  });

  test("path ends with telemetry directory", () => {
    const logPath = getDefaultLogPath();

    expect(logPath.endsWith("telemetry")).toBe(true);
    expect(logPath).toContain("atomic");
  });
});

// ============================================================================
// shouldEnableTelemetry Tests
// ============================================================================

describe("shouldEnableTelemetry", () => {
  test("returns true by default", () => {
    expect(shouldEnableTelemetry()).toBe(true);
  });

  test("returns false when DO_NOT_TRACK=1", () => {
    process.env.DO_NOT_TRACK = "1";
    expect(shouldEnableTelemetry()).toBe(false);
  });

  test("returns true when DO_NOT_TRACK=0", () => {
    process.env.DO_NOT_TRACK = "0";
    expect(shouldEnableTelemetry()).toBe(true);
  });

  test("returns false when ATOMIC_TELEMETRY=0", () => {
    process.env.ATOMIC_TELEMETRY = "0";
    expect(shouldEnableTelemetry()).toBe(false);
  });

  test("returns true when ATOMIC_TELEMETRY=1", () => {
    process.env.ATOMIC_TELEMETRY = "1";
    expect(shouldEnableTelemetry()).toBe(true);
  });

  test("returns false when CI=true", () => {
    process.env.CI = "true";
    expect(shouldEnableTelemetry()).toBe(false);
  });

  test("DO_NOT_TRACK takes precedence", () => {
    process.env.DO_NOT_TRACK = "1";
    process.env.ATOMIC_TELEMETRY = "1";
    expect(shouldEnableTelemetry()).toBe(false);
  });
});

// ============================================================================
// UnifiedTelemetryCollector Creation Tests
// ============================================================================

describe("UnifiedTelemetryCollector creation", () => {
  test("creates collector with default config", () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: false, // Disable to avoid interval
    });

    expect(collector).toBeDefined();
    expect(collector.getBufferSize()).toBe(0);
  });

  test("creates collector with custom config", () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      batchSize: 50,
      flushIntervalMs: 0, // Disable auto-flush for testing
      anonymousId: "custom-id",
    });

    const config = collector.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.localLogPath).toBe(testLogDir);
    expect(config.batchSize).toBe(50);
    expect(config.anonymousId).toBe("custom-id");
  });

  test("respects enabled flag in config", () => {
    const enabledCollector = new UnifiedTelemetryCollector({
      enabled: true,
      flushIntervalMs: 0,
    });
    expect(enabledCollector.isEnabled()).toBe(true);

    const disabledCollector = new UnifiedTelemetryCollector({
      enabled: false,
    });
    expect(disabledCollector.isEnabled()).toBe(false);
  });
});

// ============================================================================
// Event Tracking Tests
// ============================================================================

describe("Event tracking", () => {
  test("tracks events when enabled", () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", { agentType: "claude" });

    expect(collector.getBufferSize()).toBe(1);
  });

  test("does not track events when disabled", () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: false,
    });

    collector.track("sdk.session.created", { agentType: "claude" });

    expect(collector.getBufferSize()).toBe(0);
  });

  test("tracks multiple events", () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", { agentType: "claude" });
    collector.track("sdk.message.sent", { durationMs: 100 });
    collector.track("sdk.session.destroyed", {});

    expect(collector.getBufferSize()).toBe(3);
  });

  test("enriches events with standard properties", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
      anonymousId: "test-anon-id",
    });

    collector.track("sdk.session.created", { agentType: "claude" });
    await collector.flush();

    // Read the log file
    const files = await fs.readdir(testLogDir);
    expect(files.length).toBe(1);

    const filename = files[0];
    expect(filename).toBeDefined();
    const content = await fs.readFile(path.join(testLogDir, filename!), "utf-8");
    const event = JSON.parse(content.trim());

    expect(event.properties.platform).toBe(os.platform());
    expect(event.properties.nodeVersion).toBe(process.version);
    expect(event.properties.anonymousId).toBe("test-anon-id");
    expect(event.properties.agentType).toBe("claude");
  });

  test("includes session and execution IDs when provided", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    collector.track(
      "graph.node.completed",
      { nodeId: "start" },
      { sessionId: "session-123", executionId: "exec-456" }
    );
    await collector.flush();

    const files = await fs.readdir(testLogDir);
    const filename = files[0];
    expect(filename).toBeDefined();
    const content = await fs.readFile(path.join(testLogDir, filename!), "utf-8");
    const event = JSON.parse(content.trim());

    expect(event.sessionId).toBe("session-123");
    expect(event.executionId).toBe("exec-456");
  });
});

// ============================================================================
// Auto-Flush Tests
// ============================================================================

describe("Auto-flush behavior", () => {
  test("auto-flushes when batch size reached", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      batchSize: 3,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", {});
    collector.track("sdk.message.sent", {});

    // Buffer should have 2 events
    expect(collector.getBufferSize()).toBe(2);

    // Third event triggers auto-flush
    collector.track("sdk.session.destroyed", {});

    // Wait for async flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Buffer should be empty after auto-flush
    expect(collector.getBufferSize()).toBe(0);

    // Log file should exist
    const files = await fs.readdir(testLogDir);
    expect(files.length).toBe(1);
  });
});

// ============================================================================
// Flush Tests
// ============================================================================

describe("Flush behavior", () => {
  test("flush returns correct event count", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", {});
    collector.track("sdk.message.sent", {});
    collector.track("sdk.session.destroyed", {});

    const result = await collector.flush();

    expect(result.eventCount).toBe(3);
    expect(result.localLogSuccess).toBe(true);
  });

  test("flush clears buffer", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", {});
    expect(collector.getBufferSize()).toBe(1);

    await collector.flush();
    expect(collector.getBufferSize()).toBe(0);
  });

  test("flush with empty buffer succeeds", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    const result = await collector.flush();

    expect(result.eventCount).toBe(0);
    expect(result.localLogSuccess).toBe(true);
    expect(result.remoteSuccess).toBe(true);
  });

  test("writes JSONL format to log file", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", { agentType: "claude" });
    collector.track("sdk.message.sent", { durationMs: 100 });
    await collector.flush();

    const files = await fs.readdir(testLogDir);
    expect(files.length).toBe(1);
    const filename = files[0]!;
    expect(filename).toMatch(/^telemetry-\d{4}-\d{2}-\d{2}\.jsonl$/);

    const content = await fs.readFile(path.join(testLogDir, filename), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);

    // Each line should be valid JSON
    const event1 = JSON.parse(lines[0]!);
    const event2 = JSON.parse(lines[1]!);

    expect(event1.eventType).toBe("sdk.session.created");
    expect(event2.eventType).toBe("sdk.message.sent");
  });

  test("appends to existing log file", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", {});
    await collector.flush();

    collector.track("sdk.message.sent", {});
    await collector.flush();

    const files = await fs.readdir(testLogDir);
    expect(files.length).toBe(1);

    const content = await fs.readFile(path.join(testLogDir, files[0]!), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
  });
});

// ============================================================================
// Shutdown Tests
// ============================================================================

describe("Shutdown behavior", () => {
  test("shutdown flushes remaining events", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", {});
    collector.track("sdk.message.sent", {});

    expect(collector.getBufferSize()).toBe(2);

    await collector.shutdown();

    expect(collector.getBufferSize()).toBe(0);

    // Check log file was written
    const files = await fs.readdir(testLogDir);
    expect(files.length).toBe(1);
  });

  test("shutdown prevents further tracking", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      flushIntervalMs: 0,
    });

    await collector.shutdown();

    // Track after shutdown should be ignored
    collector.track("sdk.session.created", {});

    expect(collector.getBufferSize()).toBe(0);
  });

  test("multiple shutdowns are safe", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", {});

    await collector.shutdown();
    await collector.shutdown();
    await collector.shutdown();

    // Should not throw, should only write once
    const files = await fs.readdir(testLogDir);
    expect(files.length).toBe(1);
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("createTelemetryCollector", () => {
  test("creates collector with defaults", () => {
    process.env.DO_NOT_TRACK = "1"; // Disable to avoid interval
    const collector = createTelemetryCollector();

    expect(collector).toBeDefined();
    expect(collector.isEnabled()).toBe(false);
  });

  test("creates collector with custom config", () => {
    const collector = createTelemetryCollector({
      enabled: true,
      batchSize: 25,
      flushIntervalMs: 0,
    });

    expect(collector.isEnabled()).toBe(true);
    expect(collector.getConfig().batchSize).toBe(25);
  });
});

describe("createNoopCollector", () => {
  test("creates disabled collector", () => {
    const collector = createNoopCollector();

    expect(collector.isEnabled()).toBe(false);
  });

  test("does not track events", () => {
    const collector = createNoopCollector();

    collector.track("sdk.session.created", {});

    expect(collector.getBufferSize()).toBe(0);
  });

  test("flush succeeds with no events", async () => {
    const collector = createNoopCollector();

    const result = await collector.flush();

    expect(result.eventCount).toBe(0);
    expect(result.localLogSuccess).toBe(true);
    expect(result.remoteSuccess).toBe(true);
  });

  test("shutdown succeeds", async () => {
    const collector = createNoopCollector();

    await expect(collector.shutdown()).resolves.toBeUndefined();
  });
});

// ============================================================================
// Global Collector Tests
// ============================================================================

describe("Global collector", () => {
  test("getGlobalCollector returns same instance", () => {
    process.env.DO_NOT_TRACK = "1"; // Disable

    const collector1 = getGlobalCollector();
    const collector2 = getGlobalCollector();

    expect(collector1).toBe(collector2);
  });

  test("setGlobalCollector replaces instance", () => {
    process.env.DO_NOT_TRACK = "1";

    const original = getGlobalCollector();
    const custom = createNoopCollector();

    setGlobalCollector(custom);

    expect(getGlobalCollector()).toBe(custom);
    expect(getGlobalCollector()).not.toBe(original);
  });

  test("resetGlobalCollector clears instance", () => {
    process.env.DO_NOT_TRACK = "1";

    const first = getGlobalCollector();
    resetGlobalCollector();
    const second = getGlobalCollector();

    expect(first).not.toBe(second);
  });
});

// ============================================================================
// Event Structure Tests
// ============================================================================

describe("Event structure", () => {
  test("events have required fields", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    collector.track("workflow.feature.completed", {
      featureId: "feat-1",
      passingFeatures: 5,
    });
    await collector.flush();

    const files = await fs.readdir(testLogDir);
    const content = await fs.readFile(path.join(testLogDir, files[0]!), "utf-8");
    const event = JSON.parse(content.trim());

    // Required fields
    expect(event.eventId).toBeDefined();
    expect(event.eventId.length).toBeGreaterThan(0);
    expect(event.timestamp).toBeDefined();
    expect(new Date(event.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    expect(event.eventType).toBe("workflow.feature.completed");
    expect(event.properties).toBeDefined();

    // Custom properties
    expect(event.properties.featureId).toBe("feat-1");
    expect(event.properties.passingFeatures).toBe(5);
  });

  test("events have unique IDs", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: testLogDir,
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", {});
    collector.track("sdk.session.created", {});
    collector.track("sdk.session.created", {});
    await collector.flush();

    const files = await fs.readdir(testLogDir);
    const content = await fs.readFile(path.join(testLogDir, files[0]!), "utf-8");
    const lines = content.trim().split("\n");
    const events = lines.map((line) => JSON.parse(line));

    const eventIds = events.map((e) => e.eventId);
    const uniqueIds = new Set(eventIds);

    expect(uniqueIds.size).toBe(3);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error handling", () => {
  test("handles invalid log path gracefully", async () => {
    const collector = new UnifiedTelemetryCollector({
      enabled: true,
      localLogPath: "/nonexistent/deeply/nested/path/that/cannot/be/created",
      flushIntervalMs: 0,
    });

    collector.track("sdk.session.created", {});

    // Should not throw but should report failure
    const result = await collector.flush();

    expect(result.eventCount).toBe(1);
    expect(result.localLogSuccess).toBe(false);
    expect(result.error).toBeDefined();
  });
});
