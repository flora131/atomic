import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readAtomicConfig,
  saveAtomicConfig,
  getSelectedScm,
  type AtomicConfig,
} from "./atomic-config";

describe("atomic-config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = `${tmpdir()}/atomic-config-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("readAtomicConfig", () => {
    test("returns null when config file does not exist", async () => {
      const result = await readAtomicConfig(tempDir);
      expect(result).toBeNull();
    });

    test("returns null when config file contains invalid JSON", async () => {
      const configPath = join(tempDir, ".atomic.json");
      writeFileSync(configPath, "{ invalid json }", "utf-8");

      const result = await readAtomicConfig(tempDir);
      expect(result).toBeNull();
    });

    test("returns parsed config when file exists and is valid", async () => {
      const configPath = join(tempDir, ".atomic.json");
      const config: AtomicConfig = {
        version: 1,
        agent: "claude",
        scm: "github",
        lastUpdated: "2024-01-15T10:00:00.000Z",
      };
      writeFileSync(configPath, JSON.stringify(config), "utf-8");

      const result = await readAtomicConfig(tempDir);
      expect(result).toEqual(config);
    });

    test("returns config with partial fields", async () => {
      const configPath = join(tempDir, ".atomic.json");
      const partialConfig = { agent: "opencode" as const };
      writeFileSync(configPath, JSON.stringify(partialConfig), "utf-8");

      const result = await readAtomicConfig(tempDir);
      expect(result).toEqual(partialConfig);
    });
  });

  describe("saveAtomicConfig", () => {
    test("creates new config file when one does not exist", async () => {
      const configPath = join(tempDir, ".atomic.json");
      expect(existsSync(configPath)).toBe(false);

      await saveAtomicConfig(tempDir, { agent: "copilot" });

      expect(existsSync(configPath)).toBe(true);
      const saved = JSON.parse(readFileSync(configPath, "utf-8")) as AtomicConfig;
      expect(saved.agent).toBe("copilot");
    });

    test("merges updates with existing config", async () => {
      const configPath = join(tempDir, ".atomic.json");
      const existing: AtomicConfig = {
        version: 1,
        agent: "claude",
        scm: "github",
        lastUpdated: "2024-01-15T10:00:00.000Z",
      };
      writeFileSync(configPath, JSON.stringify(existing), "utf-8");

      await saveAtomicConfig(tempDir, { agent: "opencode" });

      const saved = JSON.parse(readFileSync(configPath, "utf-8")) as AtomicConfig;
      expect(saved.agent).toBe("opencode"); // Updated
      expect(saved.scm).toBe("github"); // Preserved
    });

    test("sets version to 1 on save", async () => {
      await saveAtomicConfig(tempDir, { agent: "claude" });

      const configPath = join(tempDir, ".atomic.json");
      const saved = JSON.parse(readFileSync(configPath, "utf-8")) as AtomicConfig;
      expect(saved.version).toBe(1);
    });

    test("sets lastUpdated timestamp on save", async () => {
      const beforeSave = new Date().toISOString();
      await saveAtomicConfig(tempDir, { scm: "github" });
      const afterSave = new Date().toISOString();

      const configPath = join(tempDir, ".atomic.json");
      const saved = JSON.parse(readFileSync(configPath, "utf-8")) as AtomicConfig;
      
      expect(saved.lastUpdated).toBeDefined();
      const savedTime = new Date(saved.lastUpdated!);
      expect(savedTime.getTime()).toBeGreaterThanOrEqual(new Date(beforeSave).getTime());
      expect(savedTime.getTime()).toBeLessThanOrEqual(new Date(afterSave).getTime());
    });

    test("formats JSON with 2-space indentation and trailing newline", async () => {
      await saveAtomicConfig(tempDir, { agent: "claude", scm: "github" });

      const configPath = join(tempDir, ".atomic.json");
      const content = readFileSync(configPath, "utf-8");
      
      // Should have trailing newline
      expect(content.endsWith("\n")).toBe(true);
      
      // Should have proper indentation (check for 2-space indent in formatted output)
      expect(content).toContain('  "version"');
      expect(content).toContain('  "agent"');
    });

    test("overwrites version even if existing had different version", async () => {
      const configPath = join(tempDir, ".atomic.json");
      const existing: AtomicConfig = {
        version: 99,
        agent: "claude",
      };
      writeFileSync(configPath, JSON.stringify(existing), "utf-8");

      await saveAtomicConfig(tempDir, { scm: "sapling-phabricator" });

      const saved = JSON.parse(readFileSync(configPath, "utf-8")) as AtomicConfig;
      expect(saved.version).toBe(1); // Always reset to 1
    });
  });

  describe("getSelectedScm", () => {
    test("returns null when config file does not exist", async () => {
      const result = await getSelectedScm(tempDir);
      expect(result).toBeNull();
    });

    test("returns null when config exists but scm is not set", async () => {
      const configPath = join(tempDir, ".atomic.json");
      const config: AtomicConfig = { agent: "claude" };
      writeFileSync(configPath, JSON.stringify(config), "utf-8");

      const result = await getSelectedScm(tempDir);
      expect(result).toBeNull();
    });

    test("returns scm value when configured", async () => {
      const configPath = join(tempDir, ".atomic.json");
      const config: AtomicConfig = {
        scm: "sapling-phabricator",
      };
      writeFileSync(configPath, JSON.stringify(config), "utf-8");

      const result = await getSelectedScm(tempDir);
      expect(result).toBe("sapling-phabricator");
    });
  });
});
