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
  let projectDir: string;
  let globalHome: string;
  const originalSettingsHome = process.env.ATOMIC_SETTINGS_HOME;

  beforeEach(() => {
    projectDir = `${tmpdir()}/atomic-config-project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    globalHome = `${tmpdir()}/atomic-config-home-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(globalHome, { recursive: true });
    process.env.ATOMIC_SETTINGS_HOME = globalHome;
  });

  afterEach(() => {
    if (originalSettingsHome === undefined) {
      delete process.env.ATOMIC_SETTINGS_HOME;
    } else {
      process.env.ATOMIC_SETTINGS_HOME = originalSettingsHome;
    }
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalHome, { recursive: true, force: true });
  });

  const localSettingsPath = () => join(projectDir, ".atomic", "settings.json");
  const globalSettingsPath = () => join(globalHome, ".atomic", "settings.json");

  describe("readAtomicConfig", () => {
    test("returns null when no config exists", async () => {
      await expect(readAtomicConfig(projectDir)).resolves.toBeNull();
    });

    test("falls back to global ~/.atomic/settings.json", async () => {
      mkdirSync(join(globalHome, ".atomic"), { recursive: true });
      writeFileSync(
        globalSettingsPath(),
        JSON.stringify({ agent: "opencode", scm: "sapling", model: { claude: "sonnet" } }),
        "utf-8"
      );

      await expect(readAtomicConfig(projectDir)).resolves.toEqual({
        agent: "opencode",
        scm: "sapling",
      });
    });

    test("uses local .atomic/settings.json as override over global", async () => {
      mkdirSync(join(globalHome, ".atomic"), { recursive: true });
      writeFileSync(globalSettingsPath(), JSON.stringify({ agent: "claude", scm: "github" }), "utf-8");

      mkdirSync(join(projectDir, ".atomic"), { recursive: true });
      writeFileSync(localSettingsPath(), JSON.stringify({ scm: "sapling" }), "utf-8");

      await expect(readAtomicConfig(projectDir)).resolves.toEqual({
        agent: "claude",
        scm: "sapling",
      });
    });

    test("ignores legacy .atomic.json files", async () => {
      writeFileSync(
        join(projectDir, ".atomic.json"),
        JSON.stringify({ agent: "copilot", scm: "github" }),
        "utf-8"
      );

      await expect(readAtomicConfig(projectDir)).resolves.toBeNull();
    });
  });

  describe("saveAtomicConfig", () => {
    test("writes project config to .atomic/settings.json", async () => {
      await saveAtomicConfig(projectDir, { agent: "copilot", scm: "github" });

      expect(existsSync(localSettingsPath())).toBe(true);
      const saved = JSON.parse(readFileSync(localSettingsPath(), "utf-8")) as AtomicConfig;
      expect(saved.agent).toBe("copilot");
      expect(saved.scm).toBe("github");
      expect(saved.version).toBe(1);
      expect(saved.lastUpdated).toBeDefined();
    });

    test("preserves unrelated settings fields in .atomic/settings.json", async () => {
      mkdirSync(join(projectDir, ".atomic"), { recursive: true });
      writeFileSync(
        localSettingsPath(),
        JSON.stringify({ model: { claude: "opus" }, reasoningEffort: { copilot: "high" } }),
        "utf-8"
      );

      await saveAtomicConfig(projectDir, { scm: "sapling" });

      const saved = JSON.parse(readFileSync(localSettingsPath(), "utf-8")) as Record<string, unknown>;
      expect(saved.model).toEqual({ claude: "opus" });
      expect(saved.reasoningEffort).toEqual({ copilot: "high" });
      expect(saved.scm).toBe("sapling");
    });

    test("formats JSON with 2-space indentation and trailing newline", async () => {
      await saveAtomicConfig(projectDir, { agent: "claude", scm: "github" });

      const content = readFileSync(localSettingsPath(), "utf-8");
      expect(content.endsWith("\n")).toBe(true);
      expect(content).toContain('  "version"');
      expect(content).toContain('  "agent"');
    });
  });

  describe("getSelectedScm", () => {
    test("returns null when scm is not configured anywhere", async () => {
      await expect(getSelectedScm(projectDir)).resolves.toBeNull();
    });

    test("returns scm from local settings", async () => {
      mkdirSync(join(projectDir, ".atomic"), { recursive: true });
      writeFileSync(localSettingsPath(), JSON.stringify({ scm: "github" }), "utf-8");

      await expect(getSelectedScm(projectDir)).resolves.toBe("github");
    });

    test("falls back to global settings scm", async () => {
      mkdirSync(join(globalHome, ".atomic"), { recursive: true });
      writeFileSync(globalSettingsPath(), JSON.stringify({ scm: "sapling" }), "utf-8");

      await expect(getSelectedScm(projectDir)).resolves.toBe("sapling");
    });
  });
});
