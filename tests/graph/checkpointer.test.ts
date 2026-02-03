/**
 * Unit tests for Checkpointer implementations
 *
 * Tests cover:
 * - MemorySaver: In-memory storage with structuredClone
 * - FileSaver: File-based storage using JSON files
 * - ResearchDirSaver: Research directory with YAML frontmatter
 * - createCheckpointer factory function
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MemorySaver,
  FileSaver,
  ResearchDirSaver,
  SessionDirSaver,
  createCheckpointer,
  type CheckpointerType,
} from "../../src/graph/checkpointer.ts";
import type { BaseState } from "../../src/graph/types.ts";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a test state for checkpointing.
 */
function createTestState(executionId: string, outputs: Record<string, unknown> = {}): BaseState {
  return {
    executionId,
    lastUpdated: new Date().toISOString(),
    outputs,
  };
}

// ============================================================================
// MemorySaver Tests
// ============================================================================

describe("MemorySaver", () => {
  let saver: MemorySaver;

  beforeEach(() => {
    saver = new MemorySaver();
  });

  describe("save and load", () => {
    test("saves and loads a checkpoint", async () => {
      const state = createTestState("exec-1", { node1: "result1" });

      await saver.save("exec-1", state, "step_1");
      const loaded = await saver.load("exec-1");

      expect(loaded).not.toBeNull();
      expect(loaded?.executionId).toBe("exec-1");
      expect(loaded?.outputs).toEqual({ node1: "result1" });
    });

    test("returns null for non-existent execution", async () => {
      const loaded = await saver.load("non-existent");
      expect(loaded).toBeNull();
    });

    test("loads the most recent checkpoint", async () => {
      const state1 = createTestState("exec-1", { step: 1 });
      const state2 = createTestState("exec-1", { step: 2 });
      const state3 = createTestState("exec-1", { step: 3 });

      await saver.save("exec-1", state1, "step_1");
      await saver.save("exec-1", state2, "step_2");
      await saver.save("exec-1", state3, "step_3");

      const loaded = await saver.load("exec-1");
      expect(loaded?.outputs).toEqual({ step: 3 });
    });

    test("uses structuredClone to prevent mutation", async () => {
      const state = createTestState("exec-1", { data: { nested: "value" } });

      await saver.save("exec-1", state);

      // Mutate original state
      (state.outputs as Record<string, unknown>).data = { nested: "mutated" };

      const loaded = await saver.load("exec-1");
      expect((loaded?.outputs as Record<string, unknown>).data).toEqual({ nested: "value" });
    });

    test("generates default label if not provided", async () => {
      const state = createTestState("exec-1");

      await saver.save("exec-1", state);

      const labels = await saver.list("exec-1");
      expect(labels.length).toBe(1);
      expect(labels[0]).toMatch(/^checkpoint_\d+$/);
    });
  });

  describe("loadByLabel", () => {
    test("loads a specific checkpoint by label", async () => {
      const state1 = createTestState("exec-1", { step: 1 });
      const state2 = createTestState("exec-1", { step: 2 });

      await saver.save("exec-1", state1, "step_1");
      await saver.save("exec-1", state2, "step_2");

      const loaded = await saver.loadByLabel("exec-1", "step_1");
      expect(loaded?.outputs).toEqual({ step: 1 });
    });

    test("returns null for non-existent label", async () => {
      const state = createTestState("exec-1");
      await saver.save("exec-1", state, "step_1");

      const loaded = await saver.loadByLabel("exec-1", "non-existent");
      expect(loaded).toBeNull();
    });

    test("returns null for non-existent execution", async () => {
      const loaded = await saver.loadByLabel("non-existent", "step_1");
      expect(loaded).toBeNull();
    });
  });

  describe("list", () => {
    test("lists all checkpoint labels", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");
      await saver.save("exec-1", createTestState("exec-1"), "step_3");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["step_1", "step_2", "step_3"]);
    });

    test("returns empty array for non-existent execution", async () => {
      const labels = await saver.list("non-existent");
      expect(labels).toEqual([]);
    });
  });

  describe("delete", () => {
    test("deletes all checkpoints for an execution", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");

      await saver.delete("exec-1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual([]);
    });

    test("deletes a specific checkpoint", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");

      await saver.delete("exec-1", "step_1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["step_2"]);
    });

    test("handles deletion of non-existent execution", async () => {
      await expect(saver.delete("non-existent")).resolves.toBeUndefined();
    });

    test("handles deletion of non-existent label", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");

      await expect(saver.delete("exec-1", "non-existent")).resolves.toBeUndefined();
      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["step_1"]);
    });
  });

  describe("clear", () => {
    test("clears all checkpoints", () => {
      // Sync method, just verify it doesn't throw
      saver.clear();
      expect(true).toBe(true);
    });

    test("clears checkpoints across multiple executions", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-2", createTestState("exec-2"), "step_1");

      saver.clear();

      expect(await saver.list("exec-1")).toEqual([]);
      expect(await saver.list("exec-2")).toEqual([]);
    });
  });

  describe("count", () => {
    test("returns checkpoint count for an execution", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");

      expect(saver.count("exec-1")).toBe(2);
    });

    test("returns 0 for non-existent execution", () => {
      expect(saver.count("non-existent")).toBe(0);
    });
  });
});

// ============================================================================
// FileSaver Tests
// ============================================================================

describe("FileSaver", () => {
  let tempDir: string;
  let saver: FileSaver;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `atomic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    saver = new FileSaver(tempDir);
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("save and load", () => {
    test("saves and loads a checkpoint", async () => {
      const state = createTestState("exec-1", { node1: "result1" });

      await saver.save("exec-1", state, "step_1");
      const loaded = await saver.load("exec-1");

      expect(loaded).not.toBeNull();
      expect(loaded?.executionId).toBe("exec-1");
      expect(loaded?.outputs).toEqual({ node1: "result1" });
    });

    test("returns null for non-existent execution", async () => {
      const loaded = await saver.load("non-existent");
      expect(loaded).toBeNull();
    });

    test("creates proper file structure", async () => {
      const state = createTestState("exec-1");
      await saver.save("exec-1", state, "step_1");

      const filePath = join(tempDir, "exec-1", "step_1.json");
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content);

      expect(data.label).toBe("step_1");
      expect(data.timestamp).toBeDefined();
      expect(data.state.executionId).toBe("exec-1");
    });

    test("sanitizes label for filename", async () => {
      const state = createTestState("exec-1");
      await saver.save("exec-1", state, "step/with:special*chars");

      const labels = await saver.list("exec-1");
      expect(labels[0]).toBe("step_with_special_chars");
    });
  });

  describe("loadByLabel", () => {
    test("loads a specific checkpoint by label", async () => {
      const state1 = createTestState("exec-1", { step: 1 });
      const state2 = createTestState("exec-1", { step: 2 });

      await saver.save("exec-1", state1, "step_1");
      await saver.save("exec-1", state2, "step_2");

      const loaded = await saver.loadByLabel("exec-1", "step_1");
      expect(loaded?.outputs).toEqual({ step: 1 });
    });

    test("returns null for non-existent label", async () => {
      const state = createTestState("exec-1");
      await saver.save("exec-1", state, "step_1");

      const loaded = await saver.loadByLabel("exec-1", "non-existent");
      expect(loaded).toBeNull();
    });
  });

  describe("list", () => {
    test("lists all checkpoint labels sorted", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_3");
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["step_1", "step_2", "step_3"]);
    });

    test("returns empty array for non-existent execution", async () => {
      const labels = await saver.list("non-existent");
      expect(labels).toEqual([]);
    });
  });

  describe("delete", () => {
    test("deletes all checkpoints for an execution", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");

      await saver.delete("exec-1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual([]);
    });

    test("deletes a specific checkpoint", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");

      await saver.delete("exec-1", "step_1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["step_2"]);
    });

    test("handles deletion of non-existent execution", async () => {
      await expect(saver.delete("non-existent")).resolves.toBeUndefined();
    });
  });
});

// ============================================================================
// ResearchDirSaver Tests
// ============================================================================

describe("ResearchDirSaver", () => {
  let tempDir: string;
  let saver: ResearchDirSaver;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `atomic-research-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    saver = new ResearchDirSaver(tempDir);
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("save and load", () => {
    test("saves and loads a checkpoint", async () => {
      const state = createTestState("exec-1", { node1: "result1" });

      await saver.save("exec-1", state, "step_1");
      const loaded = await saver.load("exec-1");

      expect(loaded).not.toBeNull();
      expect(loaded?.executionId).toBe("exec-1");
      expect(loaded?.outputs).toEqual({ node1: "result1" });
    });

    test("returns null for non-existent execution", async () => {
      const loaded = await saver.load("non-existent");
      expect(loaded).toBeNull();
    });

    test("uses YAML frontmatter format", async () => {
      const state = createTestState("exec-1", { test: "data" });
      await saver.save("exec-1", state, "step_1");

      const filePath = join(tempDir, "checkpoints", "exec-1", "step_1.md");
      const content = await readFile(filePath, "utf-8");

      // Verify YAML frontmatter structure
      expect(content).toMatch(/^---\n/);
      expect(content).toMatch(/executionId: exec-1/);
      expect(content).toMatch(/label: step_1/);
      expect(content).toMatch(/timestamp: \d{4}-\d{2}-\d{2}T/);
      expect(content).toMatch(/nodeCount: \d+/);
      expect(content).toMatch(/\n---\n/);

      // Verify JSON body
      expect(content).toContain('"executionId": "exec-1"');
    });
  });

  describe("loadByLabel", () => {
    test("loads a specific checkpoint by label", async () => {
      const state1 = createTestState("exec-1", { step: 1 });
      const state2 = createTestState("exec-1", { step: 2 });

      await saver.save("exec-1", state1, "step_1");
      await saver.save("exec-1", state2, "step_2");

      const loaded = await saver.loadByLabel("exec-1", "step_1");
      expect(loaded?.outputs).toEqual({ step: 1 });
    });

    test("returns null for non-existent label", async () => {
      const state = createTestState("exec-1");
      await saver.save("exec-1", state, "step_1");

      const loaded = await saver.loadByLabel("exec-1", "non-existent");
      expect(loaded).toBeNull();
    });
  });

  describe("list", () => {
    test("lists all checkpoint labels", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");
      await saver.save("exec-1", createTestState("exec-1"), "step_3");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["step_1", "step_2", "step_3"]);
    });

    test("returns empty array for non-existent execution", async () => {
      const labels = await saver.list("non-existent");
      expect(labels).toEqual([]);
    });
  });

  describe("delete", () => {
    test("deletes all checkpoints for an execution", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");

      await saver.delete("exec-1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual([]);
    });

    test("deletes a specific checkpoint", async () => {
      await saver.save("exec-1", createTestState("exec-1"), "step_1");
      await saver.save("exec-1", createTestState("exec-1"), "step_2");

      await saver.delete("exec-1", "step_1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["step_2"]);
    });
  });

  describe("getMetadata", () => {
    test("returns metadata without loading full state", async () => {
      const state = createTestState("exec-1", { large: "data".repeat(1000) });
      await saver.save("exec-1", state, "step_1");

      const metadata = await saver.getMetadata("exec-1", "step_1");

      expect(metadata).not.toBeNull();
      expect(metadata?.executionId).toBe("exec-1");
      expect(metadata?.label).toBe("step_1");
      expect(metadata?.timestamp).toBeDefined();
      expect(metadata?.nodeCount).toBe(1);
    });

    test("returns null for non-existent checkpoint", async () => {
      const metadata = await saver.getMetadata("exec-1", "non-existent");
      expect(metadata).toBeNull();
    });
  });
});

// ============================================================================
// SessionDirSaver Tests
// ============================================================================

describe("SessionDirSaver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `atomic-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, "checkpoints"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("save and load with static session directory", () => {
    test("saves and loads a checkpoint", async () => {
      const saver = new SessionDirSaver(tempDir);
      const state = createTestState("exec-1", { node1: "result1" });

      await saver.save("exec-1", state, "step_1");
      const loaded = await saver.load("exec-1");

      expect(loaded).not.toBeNull();
      expect(loaded?.executionId).toBe("exec-1");
      expect(loaded?.outputs).toEqual({ node1: "result1" });
    });

    test("returns null for non-existent execution", async () => {
      const saver = new SessionDirSaver(tempDir);
      const loaded = await saver.load("non-existent");
      expect(loaded).toBeNull();
    });

    test("uses sequential naming when label not provided", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1", { step: 1 }));
      await saver.save("exec-1", createTestState("exec-1", { step: 2 }));
      await saver.save("exec-1", createTestState("exec-1", { step: 3 }));

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["node-001", "node-002", "node-003"]);
    });

    test("loads the most recent checkpoint", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1", { step: 1 }), "node-001");
      await saver.save("exec-1", createTestState("exec-1", { step: 2 }), "node-002");
      await saver.save("exec-1", createTestState("exec-1", { step: 3 }), "node-003");

      const loaded = await saver.load("exec-1");
      expect(loaded?.outputs).toEqual({ step: 3 });
    });

    test("creates proper file structure in checkpoints directory", async () => {
      const saver = new SessionDirSaver(tempDir);
      const state = createTestState("exec-1");
      await saver.save("exec-1", state, "node-001");

      const filePath = join(tempDir, "checkpoints", "node-001.json");
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content);

      expect(data.label).toBe("node-001");
      expect(data.executionId).toBe("exec-1");
      expect(data.timestamp).toBeDefined();
      expect(data.checkpointNumber).toBeDefined();
      expect(data.state.executionId).toBe("exec-1");
    });
  });

  describe("save and load with dynamic session directory", () => {
    interface TestSessionState extends BaseState {
      ralphSessionDir: string;
    }

    function createSessionTestState(executionId: string, sessionDir: string): TestSessionState {
      return {
        executionId,
        lastUpdated: new Date().toISOString(),
        outputs: {},
        ralphSessionDir: sessionDir,
      };
    }

    test("saves checkpoint using dynamic session directory from state", async () => {
      const saver = new SessionDirSaver<TestSessionState>((state) => state.ralphSessionDir);
      const state = createSessionTestState("exec-1", tempDir);

      await saver.save("exec-1", state, "node-001");

      // Verify the file was created in the correct location
      const filePath = join(tempDir, "checkpoints", "node-001.json");
      const content = await readFile(filePath, "utf-8");
      const data = JSON.parse(content);

      expect(data.label).toBe("node-001");
      expect(data.state.ralphSessionDir).toBe(tempDir);
    });

    test("throws error when loading without state for dynamic directory", async () => {
      const saver = new SessionDirSaver<TestSessionState>((state) => state.ralphSessionDir);

      await expect(saver.load("exec-1")).rejects.toThrow(
        "SessionDirSaver.load() requires a static session directory"
      );
    });

    test("can load from session directory using loadFromSessionDir", async () => {
      const saver = new SessionDirSaver<TestSessionState>((state) => state.ralphSessionDir);
      const state = createSessionTestState("exec-1", tempDir);

      await saver.save("exec-1", state, "node-001");

      const loaded = await saver.loadFromSessionDir(tempDir, "exec-1");
      expect(loaded).not.toBeNull();
      expect(loaded?.executionId).toBe("exec-1");
      expect(loaded?.ralphSessionDir).toBe(tempDir);
    });
  });

  describe("loadByLabel", () => {
    test("loads a specific checkpoint by label", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1", { step: 1 }), "node-001");
      await saver.save("exec-1", createTestState("exec-1", { step: 2 }), "node-002");

      const loaded = await saver.loadByLabel("exec-1", "node-001");
      expect(loaded?.outputs).toEqual({ step: 1 });
    });

    test("returns null for non-existent label", async () => {
      const saver = new SessionDirSaver(tempDir);
      await saver.save("exec-1", createTestState("exec-1"), "node-001");

      const loaded = await saver.loadByLabel("exec-1", "non-existent");
      expect(loaded).toBeNull();
    });
  });

  describe("list", () => {
    test("lists all checkpoint labels sorted", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1"), "node-003");
      await saver.save("exec-1", createTestState("exec-1"), "node-001");
      await saver.save("exec-1", createTestState("exec-1"), "node-002");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["node-001", "node-002", "node-003"]);
    });

    test("returns empty array for non-existent checkpoints directory", async () => {
      const nonExistentDir = join(tmpdir(), "non-existent-session");
      const saver = new SessionDirSaver(nonExistentDir);

      const labels = await saver.list("exec-1");
      expect(labels).toEqual([]);
    });
  });

  describe("delete", () => {
    test("deletes all checkpoints", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1"), "node-001");
      await saver.save("exec-1", createTestState("exec-1"), "node-002");

      await saver.delete("exec-1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual([]);
    });

    test("deletes a specific checkpoint", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1"), "node-001");
      await saver.save("exec-1", createTestState("exec-1"), "node-002");

      await saver.delete("exec-1", "node-001");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["node-002"]);
    });

    test("resets counter when deleting all checkpoints", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1"));
      await saver.save("exec-1", createTestState("exec-1"));
      expect(saver.getCheckpointCount()).toBe(2);

      await saver.delete("exec-1");
      expect(saver.getCheckpointCount()).toBe(0);
    });
  });

  describe("checkpoint counter", () => {
    test("getCheckpointCount returns the current counter value", async () => {
      const saver = new SessionDirSaver(tempDir);

      expect(saver.getCheckpointCount()).toBe(0);

      await saver.save("exec-1", createTestState("exec-1"));
      expect(saver.getCheckpointCount()).toBe(1);

      await saver.save("exec-1", createTestState("exec-1"));
      expect(saver.getCheckpointCount()).toBe(2);
    });

    test("resetCounter resets the counter to 0", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1"));
      await saver.save("exec-1", createTestState("exec-1"));
      expect(saver.getCheckpointCount()).toBe(2);

      saver.resetCounter();
      expect(saver.getCheckpointCount()).toBe(0);
    });

    test("loading a checkpoint restores the counter", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1"));
      await saver.save("exec-1", createTestState("exec-1"));

      // Reset counter
      saver.resetCounter();
      expect(saver.getCheckpointCount()).toBe(0);

      // Load the latest checkpoint
      await saver.load("exec-1");
      expect(saver.getCheckpointCount()).toBe(2);
    });
  });

  describe("resumption from checkpoint", () => {
    test("supports resumption from any checkpoint", async () => {
      const saver = new SessionDirSaver(tempDir);

      await saver.save("exec-1", createTestState("exec-1", { step: 1 }), "node-001");
      await saver.save("exec-1", createTestState("exec-1", { step: 2 }), "node-002");
      await saver.save("exec-1", createTestState("exec-1", { step: 3 }), "node-003");

      // Resume from middle checkpoint
      const resumedState = await saver.loadByLabel("exec-1", "node-002");
      expect(resumedState?.outputs).toEqual({ step: 2 });

      // After loading node-002, counter should be at 2
      expect(saver.getCheckpointCount()).toBe(2);

      // Continue saving - should get node-003 (not node-001)
      await saver.save("exec-1", createTestState("exec-1", { step: 4 }));
      const labels = await saver.list("exec-1");
      expect(labels).toContain("node-003");
      expect(saver.getCheckpointCount()).toBe(3);
    });
  });
});

// ============================================================================
// createCheckpointer Factory Tests
// ============================================================================

describe("createCheckpointer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `atomic-factory-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("creates MemorySaver for 'memory' type", () => {
    const saver = createCheckpointer("memory");
    expect(saver).toBeInstanceOf(MemorySaver);
  });

  test("creates FileSaver for 'file' type", () => {
    const saver = createCheckpointer("file", { baseDir: tempDir });
    expect(saver).toBeInstanceOf(FileSaver);
  });

  test("throws error for 'file' type without baseDir", () => {
    expect(() => createCheckpointer("file")).toThrow("FileSaver requires baseDir option");
  });

  test("creates ResearchDirSaver for 'research' type", () => {
    const saver = createCheckpointer("research", { researchDir: tempDir });
    expect(saver).toBeInstanceOf(ResearchDirSaver);
  });

  test("uses default 'research' directory for ResearchDirSaver", () => {
    const saver = createCheckpointer("research");
    expect(saver).toBeInstanceOf(ResearchDirSaver);
  });

  test("throws error for unknown type", () => {
    expect(() => createCheckpointer("unknown" as CheckpointerType)).toThrow(
      "Unknown checkpointer type: unknown"
    );
  });

  test("created checkpointers implement Checkpointer interface", async () => {
    const memory = createCheckpointer("memory");
    const file = createCheckpointer("file", { baseDir: tempDir });
    const research = createCheckpointer("research", { researchDir: tempDir });
    const session = createCheckpointer("session", { sessionDir: tempDir });

    // All should have the required methods
    for (const saver of [memory, file, research, session]) {
      expect(typeof saver.save).toBe("function");
      expect(typeof saver.load).toBe("function");
      expect(typeof saver.list).toBe("function");
      expect(typeof saver.delete).toBe("function");
    }
  });

  test("creates SessionDirSaver for 'session' type with static path", () => {
    const saver = createCheckpointer("session", { sessionDir: tempDir });
    expect(saver).toBeInstanceOf(SessionDirSaver);
  });

  test("creates SessionDirSaver for 'session' type with dynamic getter", () => {
    interface TestState extends BaseState {
      ralphSessionDir: string;
    }
    const saver = createCheckpointer<TestState>("session", {
      sessionDir: (state) => state.ralphSessionDir,
    });
    expect(saver).toBeInstanceOf(SessionDirSaver);
  });

  test("throws error for 'session' type without sessionDir", () => {
    expect(() => createCheckpointer("session")).toThrow(
      "SessionDirSaver requires sessionDir option"
    );
  });
});
