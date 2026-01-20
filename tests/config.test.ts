import { test, expect, describe } from "bun:test";
import {
  AGENT_CONFIG,
  isValidAgent,
  getAgentConfig,
  getAgentKeys,
} from "../src/config";

describe("AGENT_CONFIG", () => {
  test("all agents have required name field", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.name).toBeDefined();
      expect(typeof config.name).toBe("string");
      expect(config.name.length).toBeGreaterThan(0);
    }
  });

  test("all agents have required cmd field", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.cmd).toBeDefined();
      expect(typeof config.cmd).toBe("string");
      expect(config.cmd.length).toBeGreaterThan(0);
    }
  });

  test("all agents have required folder field", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.folder).toBeDefined();
      expect(typeof config.folder).toBe("string");
      expect(config.folder.length).toBeGreaterThan(0);
    }
  });

  test("all agents have valid install_url (starts with https://)", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.install_url).toBeDefined();
      expect(config.install_url.startsWith("https://")).toBe(true);
    }
  });

  test("all agents have exclude as array", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.exclude).toBeDefined();
      expect(Array.isArray(config.exclude)).toBe(true);
    }
  });

  test("all agents have additional_files as array", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.additional_files).toBeDefined();
      expect(Array.isArray(config.additional_files)).toBe(true);
    }
  });

  test("all agents have additional_flags as array", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.additional_flags).toBeDefined();
      expect(Array.isArray(config.additional_flags)).toBe(true);
    }
  });

  test("all agents have preserve_files as array", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.preserve_files).toBeDefined();
      expect(Array.isArray(config.preserve_files)).toBe(true);
    }
  });

  test("all agents have merge_files as array", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.merge_files).toBeDefined();
      expect(Array.isArray(config.merge_files)).toBe(true);
    }
  });

  test("claude-code preserves CLAUDE.md and merges .mcp.json", () => {
    const config = getAgentConfig("claude-code");
    expect(config.preserve_files).toContain("CLAUDE.md");
    expect(config.preserve_files).not.toContain(".mcp.json");
    expect(config.merge_files).toContain(".mcp.json");
  });

  test("opencode preserves AGENTS.md", () => {
    const config = getAgentConfig("opencode");
    expect(config.preserve_files).toContain("AGENTS.md");
    expect(config.merge_files).toHaveLength(0);
  });

  test("copilot-cli preserves AGENTS.md", () => {
    const config = getAgentConfig("copilot-cli");
    expect(config.preserve_files).toContain("AGENTS.md");
    expect(config.merge_files).toHaveLength(0);
  });
});

describe("isValidAgent", () => {
  test("returns true for valid agent keys", () => {
    expect(isValidAgent("claude-code")).toBe(true);
    expect(isValidAgent("opencode")).toBe(true);
    expect(isValidAgent("copilot-cli")).toBe(true);
  });

  test("returns false for invalid agent keys", () => {
    expect(isValidAgent("invalid")).toBe(false);
    expect(isValidAgent("")).toBe(false);
    expect(isValidAgent("Claude-Code")).toBe(false);
  });
});

describe("getAgentConfig", () => {
  test("returns config for valid agent", () => {
    const config = getAgentConfig("claude-code");
    expect(config.name).toBe("Claude Code");
    expect(config.cmd).toBe("claude");
  });
});

describe("getAgentKeys", () => {
  test("returns all agent keys", () => {
    const keys = getAgentKeys();
    expect(keys).toContain("claude-code");
    expect(keys).toContain("opencode");
    expect(keys).toContain("copilot-cli");
    expect(keys.length).toBe(3);
  });
});
