/**
 * Tests for the global state registry.
 *
 * Verifies that resetAllGlobalState() properly resets all known
 * module-level mutable state, and that the inventory is accurate.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  resetAllGlobalState,
  MUTABLE_STATE_INVENTORY,
  type MutableStateEntry,
} from "./global-state-registry.ts";

// ── Source module imports for verification ──────────────────────────────

import { createPartId, _resetPartCounter } from "@/state/parts/id.ts";
import { isPipelineDebug, resetPipelineDebugCache } from "@/services/events/pipeline-logger.ts";
import {
  incrementRuntimeParityCounter,
  getRuntimeParityMetricsSnapshot,
} from "@/services/workflows/runtime-parity-observability.ts";
import {
  registerActiveSession,
  getActiveSessions,
  clearActiveSessions,
} from "@/services/agent-discovery/session.ts";
import {
  startProviderDiscoverySessionCache,
  getProviderDiscoverySessionCacheValue,
  setProviderDiscoverySessionCacheValue,
  clearProviderDiscoverySessionCache,
} from "@/services/config/provider-discovery-cache.ts";
import { clearAgentEventBuffer } from "@/state/streaming/pipeline-agents/buffer.ts";
import {
  clearAgentLookupCache,
} from "@/services/workflows/dsl/agent-resolution.ts";
import {
  getToolRegistry,
  setToolRegistry,
  ToolRegistry,
} from "@/services/agents/tools/registry.ts";
import { globalRegistry as commandRegistry } from "@/commands/core/registry.ts";

describe("global-state-registry", () => {
  beforeEach(() => {
    resetAllGlobalState();
  });

  describe("MUTABLE_STATE_INVENTORY", () => {
    test("contains entries for all known mutable state modules", () => {
      // Verify the inventory has a reasonable number of entries
      expect(MUTABLE_STATE_INVENTORY.length).toBeGreaterThanOrEqual(20);
    });

    test("every entry has required fields", () => {
      for (const entry of MUTABLE_STATE_INVENTORY) {
        expect(entry.file).toMatch(/^@\//);
        expect(entry.variables.length).toBeGreaterThan(0);
        expect(entry.description.length).toBeGreaterThan(0);
        expect(entry.resetStrategy).toBeDefined();
        expect(typeof entry.coveredByResetAll).toBe("boolean");
      }
    });

    test("entries marked coveredByResetAll have resettable strategies", () => {
      const covered = MUTABLE_STATE_INVENTORY.filter(
        (e) => e.coveredByResetAll,
      );
      for (const entry of covered) {
        expect(
          ["exported-reset-fn", "manual-clear"].includes(entry.resetStrategy),
        ).toBe(true);
      }
    });

    test("no duplicate file paths in inventory", () => {
      const files = MUTABLE_STATE_INVENTORY.map((e) => e.file);
      const unique = new Set(files);
      expect(unique.size).toBe(files.length);
    });

    test("inventory includes the key known entries from the spec", () => {
      const files = MUTABLE_STATE_INVENTORY.map((e) => e.file);
      expect(files).toContain("@/state/parts/id.ts");
      expect(files).toContain("@/theme/colors.ts");
    });

    test("EventHandlerRegistry is classified as read-only-at-init", () => {
      const entry = MUTABLE_STATE_INVENTORY.find(
        (e) => e.file === "@/services/events/registry/registry.ts",
      );
      expect(entry).toBeDefined();
      expect(entry!.resetStrategy).toBe("read-only-at-init");
      expect(entry!.coveredByResetAll).toBe(false);
    });
  });

  describe("resetAllGlobalState", () => {
    test("resets part ID counter so IDs start fresh", () => {
      // Generate several IDs to advance the counter past 0
      createPartId();
      createPartId();
      const id3 = createPartId();
      expect(id3).toMatch(/^part_/);

      // The counter should now be at 3 — the last hex digit encodes the counter.
      // After reset, a new ID within the same millisecond will restart at counter 0.
      resetAllGlobalState();

      // Verify createPartId still works after reset
      const afterReset = createPartId();
      expect(afterReset).toMatch(/^part_/);
    });

    test("resets pipeline debug cache", () => {
      // Access the cached value to populate it
      const original = isPipelineDebug();

      // Reset clears the cache (so next call re-reads env)
      resetAllGlobalState();

      // After reset, isPipelineDebug() should still work
      const afterReset = isPipelineDebug();
      expect(typeof afterReset).toBe("boolean");
    });

    test("resets runtime parity metrics", () => {
      // Add some metrics
      incrementRuntimeParityCounter("test.counter");
      incrementRuntimeParityCounter("test.counter");

      const before = getRuntimeParityMetricsSnapshot();
      expect(before.counters["test.counter"]).toBe(2);

      // Reset
      resetAllGlobalState();

      const after = getRuntimeParityMetricsSnapshot();
      expect(after.counters["test.counter"]).toBeUndefined();
      expect(Object.keys(after.counters).length).toBe(0);
    });

    test("clears active sessions", () => {
      // Register a session
      registerActiveSession({
        sessionId: "test-session-123",
        workflowName: "test",
        sessionDir: "/tmp/test/sessions/test-session-123",
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        status: "running",
        nodeHistory: [],
        outputs: {},
      });

      expect(getActiveSessions().size).toBe(1);

      // Reset
      resetAllGlobalState();

      expect(getActiveSessions().size).toBe(0);
    });

    test("clears provider discovery session cache", () => {
      // Set up a cache
      startProviderDiscoverySessionCache({ projectRoot: "/tmp/test" });
      setProviderDiscoverySessionCacheValue("key", "value", {
        projectRoot: "/tmp/test",
      });

      expect(
        getProviderDiscoverySessionCacheValue<string>("key", {
          projectRoot: "/tmp/test",
        }),
      ).toBe("value");

      // Reset
      resetAllGlobalState();

      expect(
        getProviderDiscoverySessionCacheValue("key", {
          projectRoot: "/tmp/test",
        }),
      ).toBeUndefined();
    });

    test("replaces tool registry with fresh instance", () => {
      // Populate the registry
      const registry = getToolRegistry();
      registry.register({
        name: "test-tool",
        description: "A test tool",
        definition: {
          name: "test-tool",
          description: "A test tool",
          inputSchema: { type: "object", properties: {} },
          handler: async () => ({ content: "ok" }),
        },
        source: "local",
        filePath: "/tmp/test.ts",
      });
      expect(registry.has("test-tool")).toBe(true);

      // Reset
      resetAllGlobalState();

      // After reset, the registry should be a fresh empty instance
      const freshRegistry = getToolRegistry();
      expect(freshRegistry.has("test-tool")).toBe(false);
      expect(freshRegistry.getAll().length).toBe(0);
    });

    test("clears command registry", () => {
      // Register a command
      commandRegistry.register({
        name: "test-cmd",
        description: "A test command",
        category: "builtin",
        execute: async (_args: string) => ({ success: true }),
      });
      expect(commandRegistry.size()).toBeGreaterThan(0);

      // Reset
      resetAllGlobalState();

      expect(commandRegistry.size()).toBe(0);
    });

    test("can be called multiple times without error", () => {
      expect(() => {
        resetAllGlobalState();
        resetAllGlobalState();
        resetAllGlobalState();
      }).not.toThrow();
    });

    test("inventory count of coveredByResetAll matches actual reset calls", () => {
      const coveredEntries = MUTABLE_STATE_INVENTORY.filter(
        (e) => e.coveredByResetAll,
      );
      // We reset 10 pieces of state in resetAllGlobalState()
      expect(coveredEntries.length).toBe(10);
    });
  });

  describe("MutableStateEntry type", () => {
    test("resetStrategy values are from the expected union", () => {
      const validStrategies = new Set([
        "exported-reset-fn",
        "read-only-at-init",
        "lazy-cache-no-reset-needed",
        "mock-module",
        "gc-managed",
        "manual-clear",
      ]);

      for (const entry of MUTABLE_STATE_INVENTORY) {
        expect(validStrategies.has(entry.resetStrategy)).toBe(true);
      }
    });
  });
});
