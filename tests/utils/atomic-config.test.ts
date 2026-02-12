import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  readAtomicConfig,
  saveAtomicConfig,
  getSelectedScm,
  type AtomicConfig,
} from "../../src/utils/atomic-config";

describe("atomic-config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("readAtomicConfig", () => {
    test("returns null when config file does not exist", async () => {
      const result = await readAtomicConfig(tempDir);
      expect(result).toBeNull();
    });

    test("returns null when config file is invalid JSON", async () => {
      await writeFile(join(tempDir, ".atomic.json"), "not valid json", "utf-8");
      const result = await readAtomicConfig(tempDir);
      expect(result).toBeNull();
    });

    test("returns parsed config when file exists", async () => {
      const config: AtomicConfig = {
        version: 1,
        agent: "claude",
        scm: "github",
        lastUpdated: "2026-02-12T12:00:00.000Z",
      };
      await writeFile(
        join(tempDir, ".atomic.json"),
        JSON.stringify(config),
        "utf-8"
      );

      const result = await readAtomicConfig(tempDir);
      expect(result).toEqual(config);
    });

    test("returns partial config when only some fields are set", async () => {
      const config = { scm: "sapling-phabricator" };
      await writeFile(
        join(tempDir, ".atomic.json"),
        JSON.stringify(config),
        "utf-8"
      );

      const result = await readAtomicConfig(tempDir);
      expect(result).toEqual(config);
    });
  });

  describe("saveAtomicConfig", () => {
    test("creates new config file when none exists", async () => {
      await saveAtomicConfig(tempDir, { scm: "github", agent: "claude" });

      const content = await readFile(join(tempDir, ".atomic.json"), "utf-8");
      const config = JSON.parse(content);

      expect(config.scm).toBe("github");
      expect(config.agent).toBe("claude");
      expect(config.version).toBe(1);
      expect(config.lastUpdated).toBeDefined();
    });

    test("merges updates with existing config", async () => {
      // Create initial config
      await saveAtomicConfig(tempDir, { agent: "claude" });

      // Update with scm
      await saveAtomicConfig(tempDir, { scm: "sapling-phabricator" });

      const config = await readAtomicConfig(tempDir);
      expect(config?.agent).toBe("claude");
      expect(config?.scm).toBe("sapling-phabricator");
    });

    test("overwrites existing fields when updated", async () => {
      await saveAtomicConfig(tempDir, { scm: "github" });
      await saveAtomicConfig(tempDir, { scm: "sapling-phabricator" });

      const config = await readAtomicConfig(tempDir);
      expect(config?.scm).toBe("sapling-phabricator");
    });

    test("always sets version to 1", async () => {
      await saveAtomicConfig(tempDir, { scm: "github" });

      const config = await readAtomicConfig(tempDir);
      expect(config?.version).toBe(1);
    });

    test("always updates lastUpdated timestamp", async () => {
      await saveAtomicConfig(tempDir, { scm: "github" });
      const config1 = await readAtomicConfig(tempDir);

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      await saveAtomicConfig(tempDir, { agent: "opencode" });
      const config2 = await readAtomicConfig(tempDir);

      expect(config1?.lastUpdated).toBeDefined();
      expect(config2?.lastUpdated).toBeDefined();
      expect(config1?.lastUpdated).not.toBe(config2?.lastUpdated);
    });

    test("formats JSON with indentation and trailing newline", async () => {
      await saveAtomicConfig(tempDir, { scm: "github" });

      const content = await readFile(join(tempDir, ".atomic.json"), "utf-8");
      expect(content.endsWith("\n")).toBe(true);
      expect(content.includes("  ")).toBe(true); // Has indentation
    });
  });

  describe("getSelectedScm", () => {
    test("returns null when config file does not exist", async () => {
      const result = await getSelectedScm(tempDir);
      expect(result).toBeNull();
    });

    test("returns null when scm is not set in config", async () => {
      await saveAtomicConfig(tempDir, { agent: "claude" });

      const result = await getSelectedScm(tempDir);
      expect(result).toBeNull();
    });

    test("returns scm when set to github", async () => {
      await saveAtomicConfig(tempDir, { scm: "github" });

      const result = await getSelectedScm(tempDir);
      expect(result).toBe("github");
    });

    test("returns scm when set to sapling-phabricator", async () => {
      await saveAtomicConfig(tempDir, { scm: "sapling-phabricator" });

      const result = await getSelectedScm(tempDir);
      expect(result).toBe("sapling-phabricator");
    });
  });
});
