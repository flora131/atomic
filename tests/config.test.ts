import { test, expect, describe } from "bun:test";
import {
  AGENT_CONFIG,
  isValidAgent,
  getAgentConfig,
  getAgentKeys,
  SCM_CONFIG,
  isValidScm,
  getScmConfig,
  getScmKeys,
  SCM_SPECIFIC_COMMANDS,
  type SourceControlType,
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

  test("claude preserves CLAUDE.md and merges .mcp.json", () => {
    const config = getAgentConfig("claude");
    expect(config.preserve_files).toContain("CLAUDE.md");
    expect(config.preserve_files).not.toContain(".mcp.json");
    expect(config.merge_files).toContain(".mcp.json");
  });

  test("opencode preserves AGENTS.md", () => {
    const config = getAgentConfig("opencode");
    expect(config.preserve_files).toContain("AGENTS.md");
    expect(config.merge_files).toHaveLength(0);
  });

  test("copilot preserves AGENTS.md", () => {
    const config = getAgentConfig("copilot");
    expect(config.preserve_files).toContain("AGENTS.md");
    expect(config.merge_files).toHaveLength(0);
  });
});

describe("isValidAgent", () => {
  test("returns true for valid agent keys", () => {
    expect(isValidAgent("claude")).toBe(true);
    expect(isValidAgent("opencode")).toBe(true);
    expect(isValidAgent("copilot")).toBe(true);
  });

  test("returns false for invalid agent keys", () => {
    expect(isValidAgent("invalid")).toBe(false);
    expect(isValidAgent("")).toBe(false);
    expect(isValidAgent("Claude-Code")).toBe(false);
  });
});

describe("getAgentConfig", () => {
  test("returns config for valid agent", () => {
    const config = getAgentConfig("claude");
    expect(config.name).toBe("Claude Code");
    expect(config.cmd).toBe("claude");
  });
});

describe("getAgentKeys", () => {
  test("returns all agent keys", () => {
    const keys = getAgentKeys();
    expect(keys).toContain("claude");
    expect(keys).toContain("opencode");
    expect(keys).toContain("copilot");
    expect(keys.length).toBe(3);
  });
});

// SCM Configuration Tests

describe("SCM_CONFIG", () => {
  test("all SCMs have required name field", () => {
    for (const [key, config] of Object.entries(SCM_CONFIG)) {
      expect(config.name).toBeDefined();
      expect(typeof config.name).toBe("string");
      expect(config.name.length).toBeGreaterThan(0);
    }
  });

  test("all SCMs have required displayName field", () => {
    for (const [key, config] of Object.entries(SCM_CONFIG)) {
      expect(config.displayName).toBeDefined();
      expect(typeof config.displayName).toBe("string");
      expect(config.displayName.length).toBeGreaterThan(0);
    }
  });

  test("all SCMs have required cliTool field", () => {
    for (const [key, config] of Object.entries(SCM_CONFIG)) {
      expect(config.cliTool).toBeDefined();
      expect(typeof config.cliTool).toBe("string");
      expect(config.cliTool.length).toBeGreaterThan(0);
    }
  });

  test("all SCMs have required reviewTool field", () => {
    for (const [key, config] of Object.entries(SCM_CONFIG)) {
      expect(config.reviewTool).toBeDefined();
      expect(typeof config.reviewTool).toBe("string");
      expect(config.reviewTool.length).toBeGreaterThan(0);
    }
  });

  test("all SCMs have required reviewSystem field", () => {
    for (const [key, config] of Object.entries(SCM_CONFIG)) {
      expect(config.reviewSystem).toBeDefined();
      expect(typeof config.reviewSystem).toBe("string");
      expect(config.reviewSystem.length).toBeGreaterThan(0);
    }
  });

  test("all SCMs have required detectDir field", () => {
    for (const [key, config] of Object.entries(SCM_CONFIG)) {
      expect(config.detectDir).toBeDefined();
      expect(typeof config.detectDir).toBe("string");
      expect(config.detectDir.length).toBeGreaterThan(0);
    }
  });

  test("all SCMs have required reviewCommandFile field", () => {
    for (const [key, config] of Object.entries(SCM_CONFIG)) {
      expect(config.reviewCommandFile).toBeDefined();
      expect(typeof config.reviewCommandFile).toBe("string");
      expect(config.reviewCommandFile.endsWith(".md")).toBe(true);
    }
  });

  test("github has correct configuration", () => {
    const config = getScmConfig("github");
    expect(config.name).toBe("github");
    expect(config.displayName).toBe("GitHub / Git");
    expect(config.cliTool).toBe("git");
    expect(config.reviewTool).toBe("gh");
    expect(config.reviewSystem).toBe("github");
    expect(config.detectDir).toBe(".git");
    expect(config.reviewCommandFile).toBe("create-gh-pr.md");
    expect(config.requiredConfigFiles).toBeUndefined();
  });

  test("sapling-phabricator has correct configuration", () => {
    const config = getScmConfig("sapling-phabricator");
    expect(config.name).toBe("sapling-phabricator");
    expect(config.displayName).toBe("Sapling + Phabricator");
    expect(config.cliTool).toBe("sl");
    expect(config.reviewTool).toBe("jf submit");
    expect(config.reviewSystem).toBe("phabricator");
    expect(config.detectDir).toBe(".sl");
    expect(config.reviewCommandFile).toBe("submit-diff.md");
    expect(config.requiredConfigFiles).toEqual([".arcconfig", "~/.arcrc"]);
  });
});

describe("isValidScm", () => {
  test("returns true for valid SCM keys", () => {
    expect(isValidScm("github")).toBe(true);
    expect(isValidScm("sapling-phabricator")).toBe(true);
  });

  test("returns false for invalid SCM keys", () => {
    expect(isValidScm("invalid")).toBe(false);
    expect(isValidScm("")).toBe(false);
    expect(isValidScm("git")).toBe(false);
    expect(isValidScm("sapling")).toBe(false);
    expect(isValidScm("azure-devops")).toBe(false);
  });
});

describe("getScmConfig", () => {
  test("returns config for valid SCM", () => {
    const config = getScmConfig("github");
    expect(config.name).toBe("github");
    expect(config.cliTool).toBe("git");
  });

  test("returns config for sapling-phabricator", () => {
    const config = getScmConfig("sapling-phabricator");
    expect(config.name).toBe("sapling-phabricator");
    expect(config.cliTool).toBe("sl");
  });
});

describe("getScmKeys", () => {
  test("returns all SCM keys", () => {
    const keys = getScmKeys();
    expect(keys).toContain("github");
    expect(keys).toContain("sapling-phabricator");
    expect(keys.length).toBe(2);
  });

  test("returns a new array each time (immutability)", () => {
    const keys1 = getScmKeys();
    const keys2 = getScmKeys();
    expect(keys1).not.toBe(keys2);
    expect(keys1).toEqual(keys2);
  });
});

describe("SCM_SPECIFIC_COMMANDS", () => {
  test("contains commit command", () => {
    expect(SCM_SPECIFIC_COMMANDS).toContain("commit");
  });

  test("is an array", () => {
    expect(Array.isArray(SCM_SPECIFIC_COMMANDS)).toBe(true);
  });
});
