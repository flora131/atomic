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
  type BuiltinSkill,
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
    onSendMessage?: (content: string) => void;
  } = {}
): CommandContext & { sentMessages: string[] } {
  const messages: Array<{ role: string; content: string }> = [];
  const sentMessages: string[] = [];
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
    sendMessage: (content: string) => {
      sentMessages.push(content);
      if (options.onSendMessage) {
        options.onSendMessage(content);
      }
    },
    sentMessages,
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

  test("commit command works without session (uses sendMessage)", () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = commitCmd!.execute("", context);

    // Should succeed and send message through sendMessage
    expect(result.success).toBe(true);
    expect(context.sentMessages).toHaveLength(1);
    // Now sends expanded prompt (if skill file exists) or falls back to slash command
    // The sent message should contain the skill prompt or slash command
    expect(context.sentMessages[0]).toBeDefined();
    expect(context.sentMessages[0]!.length).toBeGreaterThan(0);
  });

  test("commit command sends expanded prompt with args", () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = commitCmd!.execute("-m 'Fix bug'", context);

    expect(result.success).toBe(true);
    expect(context.sentMessages).toHaveLength(1);
    // Should have expanded $ARGUMENTS with the provided args
    // If skill file exists, it expands; otherwise falls back to slash command
    const sentMessage = context.sentMessages[0]!;
    expect(sentMessage.length).toBeGreaterThan(0);
    // If prompt was expanded, it should contain the args or the slash command
    expect(sentMessage.includes("-m 'Fix bug'") || sentMessage.includes("/commit")).toBe(true);
  });

  test("skill command executes without system messages", () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const messages: Array<{ role: string; content: string }> = [];
    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: (role, content) => {
        messages.push({ role, content });
      },
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
    };

    commitCmd!.execute("-m 'Fix bug'", context);

    // No system messages should be added - skill executes silently via sendMessage
    expect(messages.length).toBe(0);
    expect(sentMessages.length).toBe(1);
  });

  test("skill command does not set streaming state directly", () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = commitCmd!.execute("", context);

    // sendMessage handles streaming state, not the command result
    expect(result.stateUpdate?.isStreaming).toBeUndefined();
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

    const context = createMockContext({ session: null });
    const result = commitCmd!.execute("", context);

    expect(result.success).toBe(true);
    // Should send either expanded prompt or slash command fallback
    expect(context.sentMessages).toHaveLength(1);
    expect(context.sentMessages[0]!.length).toBeGreaterThan(0);
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

describe("BuiltinSkill interface", () => {
  test("valid BuiltinSkill has all required fields", () => {
    const skill: BuiltinSkill = {
      name: "test-skill",
      description: "A test skill",
      prompt: "Do something with $ARGUMENTS",
    };

    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A test skill");
    expect(skill.prompt).toContain("$ARGUMENTS");
  });

  test("BuiltinSkill supports optional aliases", () => {
    const skillWithAliases: BuiltinSkill = {
      name: "commit",
      description: "Create a git commit",
      prompt: "Create a commit with message: $ARGUMENTS",
      aliases: ["ci", "co"],
    };

    expect(skillWithAliases.aliases).toBeDefined();
    expect(skillWithAliases.aliases).toContain("ci");
    expect(skillWithAliases.aliases).toContain("co");
  });

  test("BuiltinSkill supports optional hidden flag", () => {
    const hiddenSkill: BuiltinSkill = {
      name: "internal-skill",
      description: "An internal skill",
      prompt: "Do internal things",
      hidden: true,
    };

    expect(hiddenSkill.hidden).toBe(true);

    const visibleSkill: BuiltinSkill = {
      name: "visible-skill",
      description: "A visible skill",
      prompt: "Do visible things",
      hidden: false,
    };

    expect(visibleSkill.hidden).toBe(false);
  });

  test("BuiltinSkill with all optional fields", () => {
    const fullSkill: BuiltinSkill = {
      name: "full-skill",
      description: "A fully-configured skill",
      prompt: "Execute: $ARGUMENTS",
      aliases: ["fs", "full"],
      hidden: false,
    };

    expect(fullSkill.name).toBe("full-skill");
    expect(fullSkill.description).toBe("A fully-configured skill");
    expect(fullSkill.prompt).toBe("Execute: $ARGUMENTS");
    expect(fullSkill.aliases).toEqual(["fs", "full"]);
    expect(fullSkill.hidden).toBe(false);
  });
});
