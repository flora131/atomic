import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ResearchDirSaver } from "@/services/workflows/graph/persistence/checkpointer/research.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";

interface TestState extends BaseState {
  outputs: Record<string, unknown>;
}

function makeState(outputs: Record<string, unknown> = {}): TestState {
  return {
    executionId: "exec-1",
    lastUpdated: new Date().toISOString(),
    outputs,
  };
}

describe("ResearchDirSaver", () => {
  let tmpDir: string;
  let saver: ResearchDirSaver<TestState>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "research-test-"));
    saver = new ResearchDirSaver<TestState>(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("save and load", () => {
    test("save a state then load returns it", async () => {
      const state = makeState({ nodeA: "result-a", nodeB: 42 });

      await saver.save("exec-1", state, "step1");
      const loaded = await saver.load("exec-1");

      expect(loaded).toEqual(state);
    });

    test("save with custom label creates file with that label name", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "my-custom-label");

      const execDir = join(tmpDir, "checkpoints", "exec-1");
      const files = await readdir(execDir);
      expect(files).toContain("my-custom-label.md");
    });

    test("save overwrites existing checkpoint with same label", async () => {
      const stateV1 = makeState({ nodeA: "v1" });
      const stateV2 = makeState({ nodeA: "v2", nodeB: "added" });

      await saver.save("exec-1", stateV1, "latest");
      await saver.save("exec-1", stateV2, "latest");

      const loaded = await saver.loadByLabel("exec-1", "latest");
      expect(loaded).toEqual(stateV2);

      // Only one file should exist
      const files = await saver.list("exec-1");
      expect(files).toEqual(["latest"]);
    });

    test("save without label generates a timestamp-based label", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state);

      const labels = await saver.list("exec-1");
      expect(labels).toHaveLength(1);
      expect(labels[0]).toMatch(/^checkpoint_\d+$/);
    });
  });

  describe("load", () => {
    test("load returns null when no checkpoints exist", async () => {
      const result = await saver.load("nonexistent-exec");
      expect(result).toBeNull();
    });

    test("load returns the last sorted checkpoint", async () => {
      const stateA = makeState({ nodeA: "a" });
      const stateB = makeState({ nodeB: "b" });

      await saver.save("exec-1", stateA, "aaa");
      await saver.save("exec-1", stateB, "zzz");

      const loaded = await saver.load("exec-1");
      // "zzz" sorts after "aaa", so load returns stateB
      expect(loaded).toEqual(stateB);
    });
  });

  describe("loadByLabel", () => {
    test("loadByLabel returns null for missing label", async () => {
      const state = makeState({ nodeA: "value" });
      await saver.save("exec-1", state, "exists");

      const result = await saver.loadByLabel("exec-1", "does-not-exist");
      expect(result).toBeNull();
    });

    test("loadByLabel returns the correct state for a given label", async () => {
      const stateA = makeState({ nodeA: "a" });
      const stateB = makeState({ nodeB: "b" });

      await saver.save("exec-1", stateA, "first");
      await saver.save("exec-1", stateB, "second");

      const loaded = await saver.loadByLabel("exec-1", "first");
      expect(loaded).toEqual(stateA);
    });

    test("loadByLabel returns null for missing execution directory", async () => {
      const result = await saver.loadByLabel("nonexistent", "any-label");
      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    test("list returns sorted labels", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "charlie");
      await saver.save("exec-1", state, "alpha");
      await saver.save("exec-1", state, "bravo");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["alpha", "bravo", "charlie"]);
    });

    test("list returns empty array for missing execution directory", async () => {
      const labels = await saver.list("nonexistent-exec");
      expect(labels).toEqual([]);
    });

    test("list only includes .md files", async () => {
      const state = makeState({});
      await saver.save("exec-1", state, "valid");

      // Write a non-md file into the directory
      const execDir = join(tmpDir, "checkpoints", "exec-1");
      await Bun.write(join(execDir, "not-a-checkpoint.txt"), "noise");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["valid"]);
    });
  });

  describe("delete", () => {
    test("delete single label only removes that file", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "keep");
      await saver.save("exec-1", state, "remove");

      await saver.delete("exec-1", "remove");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["keep"]);
    });

    test("delete without label removes entire execution directory", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "a");
      await saver.save("exec-1", state, "b");

      await saver.delete("exec-1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual([]);
    });

    test("delete without label on missing directory does not throw", async () => {
      await expect(saver.delete("nonexistent")).resolves.toBeUndefined();
    });

    test("delete with label on missing file does not throw", async () => {
      await expect(
        saver.delete("exec-1", "missing-label"),
      ).resolves.toBeUndefined();
    });
  });

  describe("getMetadata", () => {
    test("getMetadata returns frontmatter with executionId, label, timestamp, nodeCount", async () => {
      const state = makeState({ nodeA: "a", nodeB: "b", nodeC: "c" });

      await saver.save("exec-1", state, "step1");

      const metadata = await saver.getMetadata("exec-1", "step1");

      expect(metadata).not.toBeNull();
      expect(metadata!.executionId).toBe("exec-1");
      expect(metadata!.label).toBe("step1");
      expect(metadata!.timestamp).toBeTruthy();
      // Verify timestamp is a valid ISO string
      expect(new Date(metadata!.timestamp).toISOString()).toBe(
        metadata!.timestamp,
      );
      expect(metadata!.nodeCount).toBe(3);
    });

    test("getMetadata returns null for missing label", async () => {
      const result = await saver.getMetadata("exec-1", "nonexistent");
      expect(result).toBeNull();
    });

    test("getMetadata returns null for missing execution directory", async () => {
      const result = await saver.getMetadata("nonexistent", "any-label");
      expect(result).toBeNull();
    });
  });

  describe("special characters in labels", () => {
    test("handles special characters in labels by sanitizing to underscores", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "my label/with:special*chars");

      // The label should be sanitized to underscores in the filename
      const execDir = join(tmpDir, "checkpoints", "exec-1");
      const files = await readdir(execDir);
      expect(files).toContain("my_label_with_special_chars.md");

      // Loading by the sanitized label should work
      const loaded = await saver.loadByLabel(
        "exec-1",
        "my label/with:special*chars",
      );
      expect(loaded).toEqual(state);
    });

    test("labels with dots are sanitized", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "step.1.2");

      const execDir = join(tmpDir, "checkpoints", "exec-1");
      const files = await readdir(execDir);
      expect(files).toContain("step_1_2.md");
    });
  });

  describe("ENOENT handling", () => {
    test("load on missing directory returns null gracefully", async () => {
      const result = await saver.load("completely-missing");
      expect(result).toBeNull();
    });

    test("list on missing directory returns empty array gracefully", async () => {
      const result = await saver.list("completely-missing");
      expect(result).toEqual([]);
    });

    test("delete on missing directory does not throw", async () => {
      await expect(saver.delete("completely-missing")).resolves.toBeUndefined();
    });

    test("delete single label on missing directory does not throw", async () => {
      await expect(
        saver.delete("completely-missing", "some-label"),
      ).resolves.toBeUndefined();
    });
  });

  describe("YAML frontmatter round-trip (via public API)", () => {
    test("file content contains YAML frontmatter delimiters", async () => {
      const state = makeState({ nodeA: "value" });
      await saver.save("exec-1", state, "test-label");

      const filePath = join(
        tmpDir,
        "checkpoints",
        "exec-1",
        "test-label.md",
      );
      const content = await readFile(filePath, "utf-8");

      expect(content).toMatch(/^---\n/);
      expect(content).toMatch(/\n---\n/);
      expect(content).toContain("executionId: exec-1");
      expect(content).toContain("label: test-label");
      expect(content).toContain("nodeCount: 1");
    });

    test("state with nested objects round-trips correctly", async () => {
      const state = makeState({
        nodeA: { nested: { deep: [1, 2, 3] } },
        nodeB: null,
        nodeC: true,
      });

      await saver.save("exec-1", state, "nested");
      const loaded = await saver.loadByLabel("exec-1", "nested");

      expect(loaded).toEqual(state);
    });
  });
});
