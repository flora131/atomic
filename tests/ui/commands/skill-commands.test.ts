/**
 * Tests for Skill Commands
 *
 * Verifies skill command registration and execution behavior.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  SKILL_DEFINITIONS,
  skillCommands,
  registerSkillCommands,
  getSkillMetadata,
  isRalphSkill,
  getRalphSkills,
  getCoreSkills,
  type SkillMetadata,
} from "../../../src/ui/commands/skill-commands.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
} from "../../../src/ui/commands/registry.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock CommandContext for testing.
 */
function createMockContext(
  options: {
    session?: object | null;
    stateOverrides?: Partial<CommandContextState>;
  } = {}
): CommandContext {
  const messages: Array<{ role: string; content: string }> = [];
  return {
    session: options.session ?? null,
    state: {
      isStreaming: false,
      messageCount: 0,
      ...options.stateOverrides,
    },
    addMessage: (role, content) => {
      messages.push({ role, content });
    },
    setStreaming: () => {},
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("SKILL_DEFINITIONS", () => {
  test("contains core skills", () => {
    const coreSkillNames = ["commit", "research-codebase", "create-spec", "create-feature-list", "implement-feature", "create-gh-pr", "explain-code"];

    for (const name of coreSkillNames) {
      const skill = SKILL_DEFINITIONS.find((s) => s.name === name);
      expect(skill).toBeDefined();
      expect(skill?.description.length).toBeGreaterThan(0);
    }
  });

  test("contains ralph skills", () => {
    const ralphSkillNames = ["ralph:ralph-loop", "ralph:cancel-ralph", "ralph:ralph-help"];

    for (const name of ralphSkillNames) {
      const skill = SKILL_DEFINITIONS.find((s) => s.name === name);
      expect(skill).toBeDefined();
      expect(skill?.description.length).toBeGreaterThan(0);
    }
  });

  test("commit skill has correct aliases", () => {
    const commit = SKILL_DEFINITIONS.find((s) => s.name === "commit");
    expect(commit?.aliases).toContain("ci");
  });

  test("research-codebase skill has correct aliases", () => {
    const research = SKILL_DEFINITIONS.find((s) => s.name === "research-codebase");
    expect(research?.aliases).toContain("research");
  });

  test("create-spec skill has correct aliases", () => {
    const spec = SKILL_DEFINITIONS.find((s) => s.name === "create-spec");
    expect(spec?.aliases).toContain("spec");
  });

  test("ralph:ralph-loop skill has correct aliases", () => {
    const ralphLoop = SKILL_DEFINITIONS.find((s) => s.name === "ralph:ralph-loop");
    expect(ralphLoop?.aliases).toContain("ralph-loop");
    // Note: "loop" alias is reserved for atomic workflow to avoid conflicts
  });
});

describe("skillCommands", () => {
  test("has correct number of commands", () => {
    expect(skillCommands.length).toBe(SKILL_DEFINITIONS.length);
  });

  test("all commands have skill category", () => {
    for (const cmd of skillCommands) {
      expect(cmd.category).toBe("skill");
    }
  });

  test("commit command requires session", () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = commitCmd!.execute("", context);

    expect(result.success).toBe(false);
    expect(result.message).toContain("No active session");
  });

  test("commit command succeeds with session", () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: { id: "test-session" } });
    const result = commitCmd!.execute("", context);

    expect(result.success).toBe(true);
    expect(result.message).toContain("commit");
    expect(result.message).toContain("invoked");
  });

  test("skill command passes arguments", () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const messages: Array<{ role: string; content: string }> = [];
    const context: CommandContext = {
      session: { id: "test-session" } as any,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: (role, content) => {
        messages.push({ role, content });
      },
      setStreaming: () => {},
    };

    commitCmd!.execute("-m 'Fix bug'", context);

    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("commit");
    expect(messages[0]?.content).toContain("-m 'Fix bug'");
  });

  test("skill command sets streaming state", () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: { id: "test-session" } });
    const result = commitCmd!.execute("", context);

    expect(result.stateUpdate?.isStreaming).toBe(true);
  });

  test("hidden skill is created with hidden flag", () => {
    const antiPatterns = skillCommands.find((c) => c.name === "testing-anti-patterns");
    expect(antiPatterns).toBeDefined();
    expect(antiPatterns?.hidden).toBe(true);
  });
});

describe("registerSkillCommands", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  afterEach(() => {
    globalRegistry.clear();
  });

  test("registers all skill commands", () => {
    registerSkillCommands();

    expect(globalRegistry.has("commit")).toBe(true);
    expect(globalRegistry.has("research-codebase")).toBe(true);
    expect(globalRegistry.has("create-spec")).toBe(true);
    expect(globalRegistry.has("ralph:ralph-loop")).toBe(true);
  });

  test("registers skill aliases", () => {
    registerSkillCommands();

    expect(globalRegistry.has("ci")).toBe(true); // commit alias
    expect(globalRegistry.has("research")).toBe(true); // research-codebase alias
    expect(globalRegistry.has("spec")).toBe(true); // create-spec alias
    expect(globalRegistry.has("ralph-loop")).toBe(true); // ralph:ralph-loop alias
  });

  test("is idempotent", () => {
    registerSkillCommands();
    registerSkillCommands();

    // Should not throw and should still have correct count
    expect(globalRegistry.size()).toBe(SKILL_DEFINITIONS.length);
  });

  test("commands are executable after registration", () => {
    registerSkillCommands();

    const commitCmd = globalRegistry.get("commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: { id: "test-session" } });
    const result = commitCmd!.execute("", context);

    expect(result.success).toBe(true);
  });

  test("commands can be looked up by alias after registration", () => {
    registerSkillCommands();

    const byCi = globalRegistry.get("ci");
    const byCommit = globalRegistry.get("commit");

    expect(byCi?.name).toBe("commit");
    expect(byCommit?.name).toBe("commit");
  });
});

describe("getSkillMetadata", () => {
  test("finds skill by name", () => {
    const metadata = getSkillMetadata("commit");
    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe("commit");
  });

  test("finds skill by alias", () => {
    const byCi = getSkillMetadata("ci");
    const byResearch = getSkillMetadata("research");

    expect(byCi?.name).toBe("commit");
    expect(byResearch?.name).toBe("research-codebase");
  });

  test("is case-insensitive", () => {
    expect(getSkillMetadata("COMMIT")?.name).toBe("commit");
    expect(getSkillMetadata("Commit")?.name).toBe("commit");
    expect(getSkillMetadata("CI")?.name).toBe("commit");
  });

  test("returns undefined for unknown skill", () => {
    expect(getSkillMetadata("unknown")).toBeUndefined();
    expect(getSkillMetadata("")).toBeUndefined();
  });

  test("finds ralph skills", () => {
    const ralphLoop = getSkillMetadata("ralph:ralph-loop");
    const byAlias = getSkillMetadata("ralph-loop");

    expect(ralphLoop?.name).toBe("ralph:ralph-loop");
    expect(byAlias?.name).toBe("ralph:ralph-loop");
  });
});

describe("isRalphSkill", () => {
  test("returns true for ralph skills", () => {
    expect(isRalphSkill("ralph:ralph-loop")).toBe(true);
    expect(isRalphSkill("ralph:cancel-ralph")).toBe(true);
    expect(isRalphSkill("ralph:ralph-help")).toBe(true);
  });

  test("returns false for non-ralph skills", () => {
    expect(isRalphSkill("commit")).toBe(false);
    expect(isRalphSkill("research-codebase")).toBe(false);
    expect(isRalphSkill("create-spec")).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(isRalphSkill("RALPH:ralph-loop")).toBe(true);
    expect(isRalphSkill("Ralph:Ralph-Loop")).toBe(true);
  });
});

describe("getRalphSkills", () => {
  test("returns only ralph skills", () => {
    const ralphSkills = getRalphSkills();

    expect(ralphSkills.length).toBeGreaterThanOrEqual(3);
    for (const skill of ralphSkills) {
      expect(skill.name.toLowerCase().startsWith("ralph:")).toBe(true);
    }
  });

  test("includes all ralph skills", () => {
    const ralphSkills = getRalphSkills();
    const names = ralphSkills.map((s) => s.name);

    expect(names).toContain("ralph:ralph-loop");
    expect(names).toContain("ralph:cancel-ralph");
    expect(names).toContain("ralph:ralph-help");
  });
});

describe("getCoreSkills", () => {
  test("returns only non-ralph skills", () => {
    const coreSkills = getCoreSkills();

    for (const skill of coreSkills) {
      expect(skill.name.toLowerCase().startsWith("ralph:")).toBe(false);
    }
  });

  test("includes core skills", () => {
    const coreSkills = getCoreSkills();
    const names = coreSkills.map((s) => s.name);

    expect(names).toContain("commit");
    expect(names).toContain("research-codebase");
    expect(names).toContain("create-spec");
    expect(names).toContain("explain-code");
  });

  test("does not include ralph skills", () => {
    const coreSkills = getCoreSkills();
    const names = coreSkills.map((s) => s.name);

    expect(names).not.toContain("ralph:ralph-loop");
    expect(names).not.toContain("ralph:cancel-ralph");
  });
});

describe("SkillMetadata interface", () => {
  test("each definition has required fields", () => {
    for (const def of SKILL_DEFINITIONS) {
      expect(typeof def.name).toBe("string");
      expect(def.name.length).toBeGreaterThan(0);
      expect(typeof def.description).toBe("string");
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  test("each definition has valid aliases if present", () => {
    for (const def of SKILL_DEFINITIONS) {
      if (def.aliases) {
        expect(Array.isArray(def.aliases)).toBe(true);
        for (const alias of def.aliases) {
          expect(typeof alias).toBe("string");
          expect(alias.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
