import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ResearchDirSaver } from "@/services/workflows/graph/persistence/checkpointer/research.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface TestState extends BaseState {
  outputs: Record<string, unknown>;
}

function makeState(
  outputs: Record<string, unknown> = {},
  executionId = "exec-1",
): TestState {
  return {
    executionId,
    lastUpdated: new Date().toISOString(),
    outputs,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // 1. save + loadByLabel round-trip
  // -----------------------------------------------------------------------
  describe("save + loadByLabel round-trip", () => {
    test("save then loadByLabel returns the same state", async () => {
      const state = makeState({ nodeA: "result-a", nodeB: 42 });

      await saver.save("exec-1", state, "step1");
      const loaded = await saver.loadByLabel("exec-1", "step1");

      expect(loaded).toEqual(state);
    });

    test("round-trip preserves deeply nested state", async () => {
      const state = makeState({
        nodeA: { nested: { deep: [1, 2, 3] } },
        nodeB: null,
        nodeC: true,
      });

      await saver.save("exec-1", state, "nested");
      const loaded = await saver.loadByLabel("exec-1", "nested");

      expect(loaded).toEqual(state);
    });

    test("round-trip preserves state with empty outputs", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "empty-outputs");
      const loaded = await saver.loadByLabel("exec-1", "empty-outputs");

      expect(loaded).toEqual(state);
    });

    test("round-trip preserves string, number, boolean, null, and array output values", async () => {
      const state = makeState({
        str: "hello",
        num: 3.14,
        bool: false,
        nil: null,
        arr: [1, "two", null, true],
      });

      await saver.save("exec-1", state, "types");
      const loaded = await saver.loadByLabel("exec-1", "types");

      expect(loaded).toEqual(state);
    });
  });

  // -----------------------------------------------------------------------
  // 2. save + load (latest checkpoint)
  // -----------------------------------------------------------------------
  describe("save + load (latest checkpoint)", () => {
    test("load returns the last checkpoint by lexicographic sort", async () => {
      const stateA = makeState({ nodeA: "a" });
      const stateB = makeState({ nodeB: "b" });

      await saver.save("exec-1", stateA, "aaa");
      await saver.save("exec-1", stateB, "zzz");

      const loaded = await saver.load("exec-1");
      expect(loaded).toEqual(stateB);
    });

    test("load returns the only checkpoint when there is one", async () => {
      const state = makeState({ nodeA: "only" });

      await saver.save("exec-1", state, "solo");
      const loaded = await saver.load("exec-1");

      expect(loaded).toEqual(state);
    });

    test("save without label generates a timestamp-based label that load can retrieve", async () => {
      const state = makeState({ nodeA: "auto" });

      await saver.save("exec-1", state);
      const loaded = await saver.load("exec-1");

      expect(loaded).toEqual(state);
    });
  });

  // -----------------------------------------------------------------------
  // 3. list returns sorted labels
  // -----------------------------------------------------------------------
  describe("list returns sorted labels", () => {
    test("list returns labels in alphabetical order", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "charlie");
      await saver.save("exec-1", state, "alpha");
      await saver.save("exec-1", state, "bravo");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["alpha", "bravo", "charlie"]);
    });

    test("list only includes .md files and strips the extension", async () => {
      const state = makeState({});
      await saver.save("exec-1", state, "valid");

      // Write a non-md file into the directory
      const execDir = join(tmpDir, "checkpoints", "exec-1");
      await Bun.write(join(execDir, "not-a-checkpoint.txt"), "noise");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["valid"]);
    });

    test("list returns a single label when only one checkpoint exists", async () => {
      await saver.save("exec-1", makeState({}), "only-one");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["only-one"]);
    });
  });

  // -----------------------------------------------------------------------
  // 4. delete single checkpoint
  // -----------------------------------------------------------------------
  describe("delete single checkpoint", () => {
    test("delete with label only removes that file", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "keep");
      await saver.save("exec-1", state, "remove");

      await saver.delete("exec-1", "remove");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["keep"]);
    });

    test("deleted checkpoint cannot be loaded by label", async () => {
      await saver.save("exec-1", makeState({ a: 1 }), "ephemeral");
      await saver.delete("exec-1", "ephemeral");

      const loaded = await saver.loadByLabel("exec-1", "ephemeral");
      expect(loaded).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 5. delete entire execution directory
  // -----------------------------------------------------------------------
  describe("delete entire execution directory", () => {
    test("delete without label removes all checkpoints", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "a");
      await saver.save("exec-1", state, "b");
      await saver.save("exec-1", state, "c");

      await saver.delete("exec-1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual([]);
    });

    test("load returns null after deleting entire execution directory", async () => {
      await saver.save("exec-1", makeState({ a: 1 }), "step1");
      await saver.delete("exec-1");

      const loaded = await saver.load("exec-1");
      expect(loaded).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 6. loadByLabel with nonexistent label -> null
  // -----------------------------------------------------------------------
  describe("loadByLabel with nonexistent label", () => {
    test("returns null when label does not exist but execution directory does", async () => {
      await saver.save("exec-1", makeState({ nodeA: "value" }), "exists");

      const result = await saver.loadByLabel("exec-1", "does-not-exist");
      expect(result).toBeNull();
    });

    test("returns null when execution directory does not exist", async () => {
      const result = await saver.loadByLabel("nonexistent", "any-label");
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 7. load with no checkpoints -> null
  // -----------------------------------------------------------------------
  describe("load with no checkpoints", () => {
    test("returns null for a nonexistent execution ID", async () => {
      const result = await saver.load("nonexistent-exec");
      expect(result).toBeNull();
    });

    test("returns null after all checkpoints are deleted individually", async () => {
      await saver.save("exec-1", makeState({}), "only");
      await saver.delete("exec-1", "only");

      const result = await saver.load("exec-1");
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 8. list with nonexistent execution -> []
  // -----------------------------------------------------------------------
  describe("list with nonexistent execution", () => {
    test("returns empty array for nonexistent execution ID", async () => {
      const labels = await saver.list("nonexistent-exec");
      expect(labels).toEqual([]);
    });

    test("returns empty array after deleting entire execution directory", async () => {
      await saver.save("exec-1", makeState({}), "temp");
      await saver.delete("exec-1");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 9. delete nonexistent -> no error
  // -----------------------------------------------------------------------
  describe("delete nonexistent", () => {
    test("delete without label on missing directory does not throw", async () => {
      await saver.delete("nonexistent");
    });

    test("delete with label on missing file does not throw", async () => {
      await saver.delete("exec-1", "missing-label");
    });

    test("delete with label on missing directory does not throw", async () => {
      await saver.delete("completely-missing", "some-label");
    });
  });

  // -----------------------------------------------------------------------
  // 10. getMetadata returns frontmatter fields
  // -----------------------------------------------------------------------
  describe("getMetadata returns frontmatter fields", () => {
    test("returns executionId, label, timestamp, and nodeCount", async () => {
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

    test("nodeCount is 0 when outputs is empty", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "empty");

      const metadata = await saver.getMetadata("exec-1", "empty");
      expect(metadata).not.toBeNull();
      expect(metadata!.nodeCount).toBe(0);
    });

    test("returns null for missing label", async () => {
      const result = await saver.getMetadata("exec-1", "nonexistent");
      expect(result).toBeNull();
    });

    test("returns null for missing execution directory", async () => {
      const result = await saver.getMetadata("nonexistent", "any-label");
      expect(result).toBeNull();
    });

    test("nodeCount is a number (parsed from YAML frontmatter)", async () => {
      const state = makeState({ a: 1, b: 2 });
      await saver.save("exec-1", state, "check");

      const metadata = await saver.getMetadata("exec-1", "check");
      expect(typeof metadata!.nodeCount).toBe("number");
      expect(metadata!.nodeCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 11. Multiple checkpoints with different labels
  // -----------------------------------------------------------------------
  describe("multiple checkpoints with different labels", () => {
    test("each label stores its own state independently", async () => {
      const stateA = makeState({ nodeA: "a" });
      const stateB = makeState({ nodeB: "b" });
      const stateC = makeState({ nodeC: "c" });

      await saver.save("exec-1", stateA, "first");
      await saver.save("exec-1", stateB, "second");
      await saver.save("exec-1", stateC, "third");

      expect(await saver.loadByLabel("exec-1", "first")).toEqual(stateA);
      expect(await saver.loadByLabel("exec-1", "second")).toEqual(stateB);
      expect(await saver.loadByLabel("exec-1", "third")).toEqual(stateC);
    });

    test("list returns all labels in sorted order", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "zulu");
      await saver.save("exec-1", state, "alpha");
      await saver.save("exec-1", state, "mike");

      const labels = await saver.list("exec-1");
      expect(labels).toEqual(["alpha", "mike", "zulu"]);
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

    test("different execution IDs are isolated", async () => {
      const stateA = makeState({ exec: "A" }, "exec-A");
      const stateB = makeState({ exec: "B" }, "exec-B");

      await saver.save("exec-A", stateA, "step1");
      await saver.save("exec-B", stateB, "step1");

      const loadedA = await saver.loadByLabel("exec-A", "step1");
      const loadedB = await saver.loadByLabel("exec-B", "step1");

      expect(loadedA).toEqual(stateA);
      expect(loadedB).toEqual(stateB);
      expect(loadedA).not.toEqual(loadedB);
    });

    test("deleting one execution does not affect another", async () => {
      const state = makeState({});

      await saver.save("exec-A", state, "shared-label");
      await saver.save("exec-B", state, "shared-label");

      await saver.delete("exec-A");

      expect(await saver.list("exec-A")).toEqual([]);
      expect(await saver.list("exec-B")).toEqual(["shared-label"]);
    });
  });

  // -----------------------------------------------------------------------
  // 12. Label sanitization (special chars -> underscores)
  // -----------------------------------------------------------------------
  describe("label sanitization", () => {
    test("spaces are replaced with underscores", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "my label");

      const execDir = join(tmpDir, "checkpoints", "exec-1");
      const files = await readdir(execDir);
      expect(files).toContain("my_label.md");
    });

    test("slashes, colons, and asterisks are replaced with underscores", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "my/label:with*chars");

      const execDir = join(tmpDir, "checkpoints", "exec-1");
      const files = await readdir(execDir);
      expect(files).toContain("my_label_with_chars.md");
    });

    test("dots are replaced with underscores", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "step.1.2");

      const execDir = join(tmpDir, "checkpoints", "exec-1");
      const files = await readdir(execDir);
      expect(files).toContain("step_1_2.md");
    });

    test("hyphens and underscores are preserved", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "my-label_v2");

      const execDir = join(tmpDir, "checkpoints", "exec-1");
      const files = await readdir(execDir);
      expect(files).toContain("my-label_v2.md");
    });

    test("alphanumeric characters are preserved", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "Step3Final");

      const execDir = join(tmpDir, "checkpoints", "exec-1");
      const files = await readdir(execDir);
      expect(files).toContain("Step3Final.md");
    });

    test("sanitized label can be loaded back via the original label", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "my label/with:special*chars");

      const loaded = await saver.loadByLabel(
        "exec-1",
        "my label/with:special*chars",
      );
      expect(loaded).toEqual(state);
    });

    test("sanitized label appears in the list output", async () => {
      const state = makeState({});

      await saver.save("exec-1", state, "a.b.c");

      const labels = await saver.list("exec-1");
      // Labels are read from filenames (sans .md), so sanitized form is returned
      expect(labels).toEqual(["a_b_c"]);
    });

    test("getMetadata stores the original (unsanitized) label in frontmatter", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state, "step.with.dots");

      const metadata = await saver.getMetadata("exec-1", "step.with.dots");
      expect(metadata).not.toBeNull();
      // The label in frontmatter is the original label, not sanitized
      expect(metadata!.label).toBe("step.with.dots");
    });
  });

  // -----------------------------------------------------------------------
  // YAML frontmatter file format
  // -----------------------------------------------------------------------
  describe("YAML frontmatter file format", () => {
    test("file content starts with --- and contains frontmatter fields", async () => {
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

    test("file body is valid JSON representing the state", async () => {
      const state = makeState({ nodeA: "value", nodeB: 42 });
      await saver.save("exec-1", state, "json-check");

      const filePath = join(
        tmpDir,
        "checkpoints",
        "exec-1",
        "json-check.md",
      );
      const content = await readFile(filePath, "utf-8");

      // Extract everything after the second ---
      const secondDelimiterIndex = content.indexOf("---", 3);
      const body = content.slice(secondDelimiterIndex + 4); // skip "---\n"

      const parsed = JSON.parse(body);
      expect(parsed).toEqual(state);
    });

    test("timestamp field in frontmatter is an ISO 8601 string", async () => {
      const state = makeState({});
      await saver.save("exec-1", state, "ts-check");

      const filePath = join(
        tmpDir,
        "checkpoints",
        "exec-1",
        "ts-check.md",
      );
      const content = await readFile(filePath, "utf-8");

      const timestampMatch = content.match(/timestamp: (.+)/);
      expect(timestampMatch).not.toBeNull();
      const ts = timestampMatch![1]!;
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });

  // -----------------------------------------------------------------------
  // Constructor behavior
  // -----------------------------------------------------------------------
  describe("constructor", () => {
    test("default researchDir is 'research' resulting in 'research/checkpoints/'", () => {
      const defaultSaver = new ResearchDirSaver<TestState>();
      // Verify the saver was created (no way to inspect private field,
      // but we can exercise it via save to a different temp location below)
      expect(defaultSaver).toBeInstanceOf(ResearchDirSaver);
    });

    test("custom researchDir is used for checkpoint storage", async () => {
      const state = makeState({ nodeA: "value" });
      await saver.save("exec-1", state, "test");

      // Verify the file was created in tmpDir/checkpoints/
      const execDir = join(tmpDir, "checkpoints", "exec-1");
      const files = await readdir(execDir);
      expect(files).toContain("test.md");
    });
  });

  // -----------------------------------------------------------------------
  // Auto-generated label (save without label)
  // -----------------------------------------------------------------------
  describe("auto-generated label", () => {
    test("generated label matches checkpoint_<timestamp> pattern", async () => {
      const state = makeState({ nodeA: "value" });

      await saver.save("exec-1", state);

      const labels = await saver.list("exec-1");
      expect(labels).toHaveLength(1);
      expect(labels[0]).toMatch(/^checkpoint_\d+$/);
    });

    test("two saves without label create two distinct checkpoints", async () => {
      const stateA = makeState({ nodeA: "a" });
      const stateB = makeState({ nodeB: "b" });

      await saver.save("exec-1", stateA);
      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 5));
      await saver.save("exec-1", stateB);

      const labels = await saver.list("exec-1");
      expect(labels).toHaveLength(2);
      expect(labels[0]).not.toBe(labels[1]);
    });
  });

  // -----------------------------------------------------------------------
  // Checkpointer interface compliance
  // -----------------------------------------------------------------------
  describe("Checkpointer interface compliance", () => {
    test("save returns void (resolves to undefined)", async () => {
      const result = await saver.save("exec-1", makeState({}), "label");
      expect(result).toBeUndefined();
    });

    test("load returns TState or null", async () => {
      const nullResult = await saver.load("missing");
      expect(nullResult).toBeNull();

      const state = makeState({ a: 1 });
      await saver.save("exec-1", state, "label");
      const stateResult = await saver.load("exec-1");
      expect(stateResult).toEqual(state);
    });

    test("list returns string array", async () => {
      const result = await saver.list("missing");
      expect(Array.isArray(result)).toBe(true);
    });

    test("delete returns void (resolves to undefined)", async () => {
      const result = await saver.delete("missing");
      expect(result).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe("edge cases", () => {
    test("save with custom label creates the execution directory", async () => {
      await saver.save("brand-new-exec", makeState({}), "first");

      const execDir = join(tmpDir, "checkpoints", "brand-new-exec");
      const files = await readdir(execDir);
      expect(files).toHaveLength(1);
    });

    test("state with unicode characters in outputs round-trips correctly", async () => {
      const state = makeState({
        nodeA: "Hello \u4e16\u754c \ud83c\udf1f",
        nodeB: { emoji: "\ud83d\ude80", chinese: "\u4f60\u597d" },
      });

      await saver.save("exec-1", state, "unicode");
      const loaded = await saver.loadByLabel("exec-1", "unicode");

      expect(loaded).toEqual(state);
    });

    test("state with large number of outputs round-trips correctly", async () => {
      const outputs: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) {
        outputs[`node_${i}`] = { index: i, data: `value_${i}` };
      }
      const state = makeState(outputs);

      await saver.save("exec-1", state, "large");
      const loaded = await saver.loadByLabel("exec-1", "large");

      expect(loaded).toEqual(state);
    });

    test("getMetadata nodeCount matches outputs key count", async () => {
      const state = makeState({ a: 1, b: 2, c: 3, d: 4, e: 5 });

      await saver.save("exec-1", state, "count-check");
      const metadata = await saver.getMetadata("exec-1", "count-check");

      expect(metadata!.nodeCount).toBe(5);
    });

    test("list returns sanitized filenames not original labels", async () => {
      await saver.save("exec-1", makeState({}), "label.with.dots");
      await saver.save("exec-1", makeState({}), "plain-label");

      const labels = await saver.list("exec-1");
      // "label.with.dots" gets sanitized to "label_with_dots" in the filename
      expect(labels).toContain("label_with_dots");
      expect(labels).toContain("plain-label");
    });
  });
});
