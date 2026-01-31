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

    // All should have the required methods
    for (const saver of [memory, file, research]) {
      expect(typeof saver.save).toBe("function");
      expect(typeof saver.load).toBe("function");
      expect(typeof saver.list).toBe("function");
      expect(typeof saver.delete).toBe("function");
    }
  });
});
