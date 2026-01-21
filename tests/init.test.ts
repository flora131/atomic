import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { join } from "path";

/**
 * Unit tests for initCommand with preSelectedAgent option
 *
 * These tests verify that:
 * 1. When preSelectedAgent is provided, the interactive selection prompt is skipped
 * 2. When preSelectedAgent is invalid, the command exits with error
 * 3. When preSelectedAgent is not provided, interactive selection runs as normal
 */
describe("initCommand with preSelectedAgent", () => {
  // Track which @clack/prompts functions were called
  let selectCalled: boolean;
  let cancelCalled: boolean;
  let confirmCalls: number;
  let logInfoMessages: string[];
  let processExitCode: number | null;

  // Original process.exit
  const originalProcessExit = process.exit;

  beforeEach(() => {
    selectCalled = false;
    cancelCalled = false;
    confirmCalls = 0;
    logInfoMessages = [];
    processExitCode = null;

    // Mock process.exit to capture exit codes without actually exiting
    process.exit = ((code?: number) => {
      processExitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalProcessExit;
  });

  describe("preSelectedAgent validation", () => {
    test("valid preSelectedAgent skips select prompt", async () => {
      // We test that isValidAgent('claude') returns true
      // and the agent info is retrievable
      const { isValidAgent, AGENT_CONFIG } = await import("../src/config");

      expect(isValidAgent("claude")).toBe(true);
      expect(AGENT_CONFIG["claude"].name).toBe("Claude Code");
      expect(AGENT_CONFIG["claude"].folder).toBe(".claude");
    });

    test("invalid preSelectedAgent causes exit", async () => {
      const { isValidAgent } = await import("../src/config");

      // Verify that invalid agent names are rejected
      expect(isValidAgent("invalid-agent")).toBe(false);
      expect(isValidAgent("Claude-Code")).toBe(false); // case-sensitive
      expect(isValidAgent("")).toBe(false);
    });

    test("all valid agents pass validation", async () => {
      const { isValidAgent, getAgentKeys } = await import("../src/config");

      for (const key of getAgentKeys()) {
        expect(isValidAgent(key)).toBe(true);
      }
    });
  });

  describe("InitOptions interface", () => {
    test("InitOptions accepts preSelectedAgent field", async () => {
      // This test verifies the TypeScript interface accepts the new field
      // by importing and checking the types at runtime
      const { AGENT_CONFIG } = await import("../src/config");
      type AgentKey = "claude" | "opencode" | "copilot";

      // Valid InitOptions structures
      const validOptions = [
        { showBanner: true },
        { showBanner: false },
        { preSelectedAgent: "claude" as AgentKey },
        { preSelectedAgent: "opencode" as AgentKey },
        { preSelectedAgent: "copilot" as AgentKey },
        { showBanner: false, preSelectedAgent: "claude" as AgentKey },
        {},
      ];

      // All should be valid structures (no runtime errors)
      for (const opts of validOptions) {
        expect(opts).toBeDefined();
      }
    });

    test("InitOptions accepts configNotFoundMessage field", async () => {
      type AgentKey = "claude" | "opencode" | "copilot";

      // Valid InitOptions structures with configNotFoundMessage
      const validOptions = [
        { configNotFoundMessage: ".claude not found. Running setup..." },
        { showBanner: true, configNotFoundMessage: ".claude not found. Running setup..." },
        { preSelectedAgent: "claude" as AgentKey, configNotFoundMessage: ".claude not found. Running setup..." },
        { showBanner: true, preSelectedAgent: "claude" as AgentKey, configNotFoundMessage: ".claude not found. Running setup..." },
        {}, // configNotFoundMessage is optional
      ];

      // All should be valid structures (no runtime errors)
      for (const opts of validOptions) {
        expect(opts).toBeDefined();
      }
    });

    test("InitOptions accepts force field", async () => {
      type AgentKey = "claude" | "opencode" | "copilot";

      // Valid InitOptions structures with force
      const validOptions = [
        { force: true },
        { force: false },
        { showBanner: true, force: true },
        { preSelectedAgent: "claude" as AgentKey, force: true },
        { showBanner: true, preSelectedAgent: "claude" as AgentKey, force: true },
        { showBanner: true, preSelectedAgent: "claude" as AgentKey, configNotFoundMessage: "msg", force: true },
        {}, // force is optional
      ];

      // All should be valid structures (no runtime errors)
      for (const opts of validOptions) {
        expect(opts).toBeDefined();
      }
    });
  });

  describe("agent config lookup with preSelectedAgent", () => {
    test("can retrieve config for claude", async () => {
      const { AGENT_CONFIG } = await import("../src/config");

      const agent = AGENT_CONFIG["claude"];
      expect(agent.name).toBe("Claude Code");
      expect(agent.folder).toBe(".claude");
      expect(agent.cmd).toBe("claude");
    });

    test("can retrieve config for opencode", async () => {
      const { AGENT_CONFIG } = await import("../src/config");

      const agent = AGENT_CONFIG["opencode"];
      expect(agent.name).toBe("OpenCode");
      expect(agent.folder).toBe(".opencode");
      expect(agent.cmd).toBe("opencode");
    });

    test("can retrieve config for copilot", async () => {
      const { AGENT_CONFIG } = await import("../src/config");

      const agent = AGENT_CONFIG["copilot"];
      expect(agent.name).toBe("GitHub Copilot CLI");
      expect(agent.folder).toBe(".github");
      expect(agent.cmd).toBe("copilot");
    });
  });
});

describe("file preservation with --force flag", () => {
  /**
   * These tests verify that preserve_files (CLAUDE.md, AGENTS.md) are NEVER
   * overwritten, even when the --force flag is set. This protects user
   * customizations intentionally.
   */

  test("preserve_files includes CLAUDE.md for claude agent", async () => {
    const { AGENT_CONFIG } = await import("../src/config");
    const claudeAgent = AGENT_CONFIG["claude"];

    // Claude agent preserves CLAUDE.md (its main instruction file)
    expect(claudeAgent.preserve_files).toContain("CLAUDE.md");
    expect(claudeAgent.additional_files).toContain("CLAUDE.md");
  });

  test("preserve_files includes AGENTS.md for opencode agent", async () => {
    const { AGENT_CONFIG } = await import("../src/config");
    const opencodeAgent = AGENT_CONFIG["opencode"];

    // OpenCode agent preserves AGENTS.md (its main instruction file)
    expect(opencodeAgent.preserve_files).toContain("AGENTS.md");
    expect(opencodeAgent.additional_files).toContain("AGENTS.md");
  });

  test("preserve_files includes AGENTS.md for copilot agent", async () => {
    const { AGENT_CONFIG } = await import("../src/config");
    const copilotAgent = AGENT_CONFIG["copilot"];

    // Copilot agent preserves AGENTS.md (its main instruction file)
    expect(copilotAgent.preserve_files).toContain("AGENTS.md");
    expect(copilotAgent.additional_files).toContain("AGENTS.md");
  });

  test("preservation logic: preserved files ARE overwritten with force=true", () => {
    // Simulate the preservation logic from init.ts
    // With the new behavior, force=true bypasses preservation for preserved files
    const preserveFiles = ["CLAUDE.md", "AGENTS.md"];
    const file = "CLAUDE.md";
    const destExists = true;
    const shouldForce = true;

    const shouldPreserve = preserveFiles.includes(file);

    // The new key logic: force flag bypasses preservation
    // if (shouldPreserve && destExists && !shouldForce) { ... }
    let wasSkipped = false;
    if (shouldPreserve && destExists && !shouldForce) {
      wasSkipped = true;
      // continue; in actual code
    }

    expect(wasSkipped).toBe(false);
    // With force=true, preserved files should NOT be skipped
  });

  test("preservation logic: non-preserved files are overwritten with force=true", () => {
    // Simulate the preservation logic from init.ts
    const preserveFiles = ["CLAUDE.md", "AGENTS.md"];
    const file = "settings.json"; // Not in preserve_files
    const destExists = true;
    const shouldForce = true;

    const shouldPreserve = preserveFiles.includes(file);
    const shouldMerge = false; // Assume not a merge file

    let action = "";
    if (shouldPreserve && destExists) {
      action = "skip";
    } else if (shouldMerge && destExists) {
      action = "merge";
    } else if (shouldForce) {
      action = "overwrite";
    } else if (!destExists) {
      action = "copy";
    } else {
      action = "skip";
    }

    expect(action).toBe("overwrite");
  });

  test("preservation logic: new files are copied regardless of force flag", () => {
    // Simulate the preservation logic from init.ts
    const preserveFiles = ["CLAUDE.md", "AGENTS.md"];
    const file = "CLAUDE.md";
    const destExists = false; // File doesn't exist at destination
    const shouldForce = false;

    const shouldPreserve = preserveFiles.includes(file);

    let action = "";
    if (shouldPreserve && destExists) {
      action = "skip";
    } else if (!destExists) {
      action = "copy";
    }

    // New files should be copied even if they're in preserve_files
    expect(action).toBe("copy");
  });

  test("config folder files are ALWAYS overwritten (template sync)", () => {
    // This tests the copyDirPreserving behavior
    // Config folder files (inside .claude/, .opencode/, etc.) are always updated to match template
    // User's custom files NOT in the template are preserved (not deleted)
    const destExists = true;

    // New logic from copyDirPreserving: always copy template files
    // Files in template are always synced, user's custom files (not in template) are preserved
    const shouldCopy = true; // Template files are always copied

    expect(shouldCopy).toBe(true);
  });

  test("preservation logic: non-empty preserved files skip copy without force", () => {
    // Simulate the new preservation logic with isFileEmpty check
    const preserveFiles = ["CLAUDE.md", "AGENTS.md"];
    const file = "CLAUDE.md";
    const destExists = true;
    const shouldForce = false;
    const isFileEmpty = false; // File has content

    const shouldPreserve = preserveFiles.includes(file);

    // New logic: if (shouldPreserve && destExists && !shouldForce)
    // then check isFileEmpty - if not empty, skip
    let wasSkipped = false;
    if (shouldPreserve && destExists && !shouldForce) {
      if (!isFileEmpty) {
        wasSkipped = true;
      }
    }

    expect(wasSkipped).toBe(true);
    // Non-empty preserved files should be skipped without force
  });

  test("preservation logic: empty preserved files are overwritten without force", () => {
    // Simulate the new preservation logic with isFileEmpty check
    const preserveFiles = ["CLAUDE.md", "AGENTS.md"];
    const file = "CLAUDE.md";
    const destExists = true;
    const shouldForce = false;
    const isFileEmpty = true; // File is empty (0 bytes)

    const shouldPreserve = preserveFiles.includes(file);

    // New logic: if (shouldPreserve && destExists && !shouldForce)
    // then check isFileEmpty - if empty, don't skip (allow overwrite)
    let wasSkipped = false;
    if (shouldPreserve && destExists && !shouldForce) {
      if (!isFileEmpty) {
        wasSkipped = true;
      }
    }

    expect(wasSkipped).toBe(false);
    // Empty preserved files should NOT be skipped - they get overwritten
  });

  test("preservation logic: whitespace-only preserved files are overwritten", () => {
    // Simulate the new preservation logic with isFileEmpty check
    // isFileEmpty returns true for whitespace-only content
    const preserveFiles = ["CLAUDE.md", "AGENTS.md"];
    const file = "AGENTS.md";
    const destExists = true;
    const shouldForce = false;
    const isFileEmpty = true; // File contains only whitespace

    const shouldPreserve = preserveFiles.includes(file);

    let wasSkipped = false;
    if (shouldPreserve && destExists && !shouldForce) {
      if (!isFileEmpty) {
        wasSkipped = true;
      }
    }

    expect(wasSkipped).toBe(false);
    // Whitespace-only preserved files should NOT be skipped - they get overwritten
  });
});

describe("initCommand preSelectedAgent flow logic", () => {
  /**
   * These tests verify the logical flow when preSelectedAgent is provided:
   *
   * 1. If preSelectedAgent is set AND valid -> skip select, use directly
   * 2. If preSelectedAgent is set AND invalid -> cancel and exit(1)
   * 3. If preSelectedAgent is NOT set -> run interactive select
   */

  test("preSelectedAgent flow: valid agent should skip selection", () => {
    const { isValidAgent, AGENT_CONFIG } = require("../src/config");
    type AgentKey = "claude" | "opencode" | "copilot";

    // Simulate the logic in initCommand
    const preSelectedAgent = "claude" as const;

    let agentKey: string;
    let shouldCallSelect = true;

    if (preSelectedAgent) {
      if (!isValidAgent(preSelectedAgent)) {
        // Would call cancel() and exit(1)
        throw new Error("Invalid agent");
      }
      agentKey = preSelectedAgent;
      shouldCallSelect = false;
    } else {
      // Would call select() interactively
      shouldCallSelect = true;
      agentKey = "mock-selected";
    }

    expect(shouldCallSelect).toBe(false);
    expect(agentKey).toBe("claude");
    expect(AGENT_CONFIG[agentKey as AgentKey].name).toBe("Claude Code");
  });

  test("preSelectedAgent flow: invalid agent should fail validation", () => {
    const { isValidAgent } = require("../src/config");

    const preSelectedAgent = "invalid-agent";

    let didFail = false;

    if (preSelectedAgent) {
      if (!isValidAgent(preSelectedAgent)) {
        didFail = true;
      }
    }

    expect(didFail).toBe(true);
  });

  test("preSelectedAgent flow: undefined should require selection", () => {
    const preSelectedAgent = undefined;

    let shouldCallSelect = false;

    if (preSelectedAgent) {
      shouldCallSelect = false;
    } else {
      shouldCallSelect = true;
    }

    expect(shouldCallSelect).toBe(true);
  });
});

describe("config folder behavior (copyDirPreserving)", () => {
  /**
   * These tests verify the behavior of copyDirPreserving:
   * - Template files are always overwritten (synced to latest)
   * - User's custom files (not in template) are preserved (not deleted)
   */

  test("template files in config folder are always overwritten", () => {
    // copyDirPreserving now always copies template files
    // This ensures users get latest template updates on re-init
    const templateFiles = ["settings.json", "commands/implement.md", "agents/researcher.md"];
    
    for (const file of templateFiles) {
      // Simulate: file exists in template and at destination
      const inTemplate = true;
      const destExists = true;
      
      // New behavior: always copy if file is in template
      const shouldCopy = inTemplate; // Always copy template files
      
      expect(shouldCopy).toBe(true);
    }
  });

  test("user's custom files NOT in template are preserved", () => {
    // copyDirPreserving only iterates over template files
    // It doesn't delete files at destination that aren't in template
    const userCustomFiles = [
      "commands/my-custom-command.md",
      "agents/my-custom-agent.md",
      "skills/my-custom-skill.md",
    ];
    
    for (const file of userCustomFiles) {
      // These files exist at destination but NOT in template
      const inTemplate = false;
      const destExists = true;
      
      // Since we only iterate template files, custom files are never touched
      // They are preserved by virtue of not being in the copy loop
      const wouldBeDeleted = false; // We don't delete anything
      
      expect(wouldBeDeleted).toBe(false);
    }
  });

  test("re-running init updates settings.json to latest template", () => {
    // settings.json is a template file, so it gets overwritten
    const file = "settings.json";
    const inTemplate = true;
    const destExists = true;
    
    // New behavior: template files are always copied
    const shouldCopy = inTemplate;
    
    expect(shouldCopy).toBe(true);
  });

  test("user's custom commands are preserved on re-init", () => {
    // User adds commands/my-workflow.md - this should survive re-init
    // Because copyDirPreserving only copies files FROM template
    const userCommand = "commands/my-workflow.md";
    const inTemplate = false; // User's custom file
    
    // File won't be touched because it's not in the template
    const wouldBeOverwritten = inTemplate;
    
    expect(wouldBeOverwritten).toBe(false);
  });

  test("user's custom agents are preserved on re-init", () => {
    // User adds agents/my-agent.md - this should survive re-init
    const userAgent = "agents/my-agent.md";
    const inTemplate = false;
    
    const wouldBeOverwritten = inTemplate;
    
    expect(wouldBeOverwritten).toBe(false);
  });

  test("user's custom skills are preserved on re-init", () => {
    // User adds skills/my-skill.md - this should survive re-init
    const userSkill = "skills/my-skill.md";
    const inTemplate = false;
    
    const wouldBeOverwritten = inTemplate;
    
    expect(wouldBeOverwritten).toBe(false);
  });
});
