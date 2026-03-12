import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  getModelPreference,
  saveModelPreference,
  getReasoningEffortPreference,
  saveReasoningEffortPreference,
  clearReasoningEffortPreference,
  isTrustedWorkspacePath,
  upsertTrustedWorkspacePath,
} from "@/services/config/settings.ts";

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

describe("settings persistence", () => {
  let root: string;
  let cwdDir: string;
  let homeDir: string;

  beforeEach(() => {
    root = `${tmpdir()}/atomic-settings-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    cwdDir = join(root, "project");
    homeDir = join(root, "home");
    mkdirSync(cwdDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    process.env.ATOMIC_SETTINGS_CWD = cwdDir;
    process.env.ATOMIC_SETTINGS_HOME = homeDir;
  });

  afterEach(() => {
    delete process.env.ATOMIC_SETTINGS_CWD;
    delete process.env.ATOMIC_SETTINGS_HOME;
    rmSync(root, { recursive: true, force: true });
  });

  test("prefers local config over global for model preference", async () => {
    const localPath = join(cwdDir, ".atomic", "settings.json");
    const globalPath = join(homeDir, ".atomic", "settings.json");

    writeJson(globalPath, { model: { claude: "haiku" } });
    writeJson(localPath, { model: { claude: "sonnet" } });

    expect(await getModelPreference("claude")).toBe("sonnet");
  });

  test("sanitizes claude default model to opus when reading", async () => {
    const globalPath = join(homeDir, ".atomic", "settings.json");
    writeJson(globalPath, { model: { claude: "default" } });

    expect(await getModelPreference("claude")).toBe("opus");

    const localPath = join(cwdDir, ".atomic", "settings.json");
    writeJson(localPath, { model: { claude: "anthropic/default" } });

    expect(await getModelPreference("claude")).toBe("opus");
  });

  test("writes model preferences to global only and normalizes claude default", () => {
    const localPath = join(cwdDir, ".atomic", "settings.json");
    const globalPath = join(homeDir, ".atomic", "settings.json");

    writeJson(localPath, { model: { claude: "haiku" } });

    saveModelPreference("claude", "default");

    const globalSettings = JSON.parse(readFileSync(globalPath, "utf-8")) as {
      model?: Record<string, string>;
    };
    const localSettings = JSON.parse(readFileSync(localPath, "utf-8")) as {
      model?: Record<string, string>;
    };

    expect(globalSettings.model?.claude).toBe("opus");
    expect(localSettings.model?.claude).toBe("haiku");
  });

  test("reasoning effort reads local first and writes global", async () => {
    const localPath = join(cwdDir, ".atomic", "settings.json");
    const globalPath = join(homeDir, ".atomic", "settings.json");

    writeJson(globalPath, { reasoningEffort: { copilot: "medium" } });
    writeJson(localPath, { reasoningEffort: { copilot: "high" } });

    expect(await getReasoningEffortPreference("copilot")).toBe("high");

    saveReasoningEffortPreference("copilot", "low");

    const globalSettings = JSON.parse(readFileSync(globalPath, "utf-8")) as {
      reasoningEffort?: Record<string, string>;
    };
    expect(globalSettings.reasoningEffort?.copilot).toBe("low");

    clearReasoningEffortPreference("copilot");
    const clearedSettings = JSON.parse(readFileSync(globalPath, "utf-8")) as {
      reasoningEffort?: Record<string, string>;
    };
    expect(clearedSettings.reasoningEffort?.copilot).toBeUndefined();
    expect(existsSync(localPath)).toBe(true);
  });

  test("getModelPreference returns undefined when no settings exist", async () => {
    // No settings files created
    expect(await getModelPreference("claude")).toBeUndefined();
    expect(await getModelPreference("copilot")).toBeUndefined();
  });

  test("getModelPreference falls back to global when local has no setting", async () => {
    const localPath = join(cwdDir, ".atomic", "settings.json");
    const globalPath = join(homeDir, ".atomic", "settings.json");

    // Local exists but has no model for this agent type
    writeJson(localPath, { model: { opencode: "gpt-4" } });
    writeJson(globalPath, { model: { claude: "sonnet" } });

    expect(await getModelPreference("claude")).toBe("sonnet");
  });

  test("getModelPreference passes through non-claude model IDs unchanged", async () => {
    const globalPath = join(homeDir, ".atomic", "settings.json");
    writeJson(globalPath, { model: { opencode: "custom-model-id" } });

    expect(await getModelPreference("opencode")).toBe("custom-model-id");
  });

  test("getModelPreference normalizes claude model with /default suffix", async () => {
    const globalPath = join(homeDir, ".atomic", "settings.json");
    writeJson(globalPath, { model: { claude: "anthropic/default" } });

    expect(await getModelPreference("claude")).toBe("opus");
  });

  test("saveModelPreference strips Claude provider prefix and stores canonical alias", () => {
    const globalPath = join(homeDir, ".atomic", "settings.json");

    saveModelPreference("claude", "anthropic/sonnet");

    const settings = JSON.parse(readFileSync(globalPath, "utf-8")) as {
      model?: Record<string, string>;
    };
    expect(settings.model?.claude).toBe("sonnet");
  });

  test("getModelPreference trims whitespace from model ID", async () => {
    const globalPath = join(homeDir, ".atomic", "settings.json");
    writeJson(globalPath, { model: { claude: "  sonnet  " } });

    expect(await getModelPreference("claude")).toBe("sonnet");
  });

  test("saveModelPreference creates directory if it does not exist", () => {
    const globalPath = join(homeDir, ".atomic", "settings.json");

    // Directory doesn't exist yet
    expect(existsSync(dirname(globalPath))).toBe(false);

    saveModelPreference("claude", "opus");

    expect(existsSync(dirname(globalPath))).toBe(true);
    expect(existsSync(globalPath)).toBe(true);

    const settings = JSON.parse(readFileSync(globalPath, "utf-8")) as {
      model?: Record<string, string>;
    };
    expect(settings.model?.claude).toBe("opus");
  });

  test("saveModelPreference preserves existing settings", () => {
    const globalPath = join(homeDir, ".atomic", "settings.json");
    writeJson(globalPath, {
      agent: "claude",
      model: { opencode: "gpt-4" },
      reasoningEffort: { copilot: "high" },
    });

    saveModelPreference("claude", "sonnet");

    const settings = JSON.parse(readFileSync(globalPath, "utf-8")) as {
      agent?: string;
      model?: Record<string, string>;
      reasoningEffort?: Record<string, string>;
    };
    expect(settings.agent).toBeUndefined();
    expect(settings.model?.claude).toBe("sonnet");
    expect(settings.model?.opencode).toBe("gpt-4");
    expect(settings.reasoningEffort?.copilot).toBe("high");
  });

  test("getReasoningEffortPreference returns undefined when no settings exist", async () => {
    expect(await getReasoningEffortPreference("claude")).toBeUndefined();
  });

  test("getReasoningEffortPreference falls back to global when local has no setting", async () => {
    const localPath = join(cwdDir, ".atomic", "settings.json");
    const globalPath = join(homeDir, ".atomic", "settings.json");

    writeJson(localPath, { reasoningEffort: { opencode: "medium" } });
    writeJson(globalPath, { reasoningEffort: { copilot: "high" } });

    expect(await getReasoningEffortPreference("copilot")).toBe("high");
  });

  test("clearReasoningEffortPreference is safe when preference does not exist", () => {
    const globalPath = join(homeDir, ".atomic", "settings.json");
    writeJson(globalPath, { reasoningEffort: { opencode: "high" } });

    // Clearing a non-existent preference should not throw
    expect(() => clearReasoningEffortPreference("claude")).not.toThrow();

    const settings = JSON.parse(readFileSync(globalPath, "utf-8")) as {
      reasoningEffort?: Record<string, string>;
    };
    // Other preferences should remain
    expect(settings.reasoningEffort?.opencode).toBe("high");
  });

  test("upsertTrustedWorkspacePath writes to global settings and dedupes by provider and workspace", async () => {
    const globalPath = join(homeDir, ".atomic", "settings.json");
    writeJson(globalPath, {
      model: { claude: "opus" },
      trustedPaths: [{ workspacePath: join(cwdDir, "..", "project"), provider: "claude" }],
    });

    upsertTrustedWorkspacePath(join(cwdDir, "."), "claude");
    upsertTrustedWorkspacePath(cwdDir, "opencode");

    const settings = JSON.parse(readFileSync(globalPath, "utf-8")) as {
      model?: Record<string, string>;
      trustedPaths?: Array<{ workspacePath: string; provider: string }>;
    };

    expect(settings.model?.claude).toBe("opus");
    expect(settings.trustedPaths).toEqual([
      { workspacePath: cwdDir, provider: "claude" },
      { workspacePath: cwdDir, provider: "opencode" },
    ]);
  });

  test("isTrustedWorkspacePath only checks global trusted paths", async () => {
    const localPath = join(cwdDir, ".atomic", "settings.json");
    const globalPath = join(homeDir, ".atomic", "settings.json");

    writeJson(localPath, {
      trustedPaths: [{ workspacePath: cwdDir, provider: "copilot" }],
    });
    writeJson(globalPath, {
      trustedPaths: [{ workspacePath: cwdDir, provider: "claude" }],
    });

    expect(await isTrustedWorkspacePath(cwdDir, "claude")).toBe(true);
    expect(await isTrustedWorkspacePath(cwdDir, "copilot")).toBe(false);
  });
});
