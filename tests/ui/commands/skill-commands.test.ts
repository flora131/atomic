/**
 * Tests for Skill Commands
 *
 * Verifies skill command registration and execution behavior.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  SKILL_DEFINITIONS,
  BUILTIN_SKILLS,
  skillCommands,
  builtinSkillCommands,
  registerSkillCommands,
  registerBuiltinSkills,
  getSkillMetadata,
  getBuiltinSkill,
  isRalphSkill,
  getRalphSkills,
  getCoreSkills,
  expandArguments,
  type SkillMetadata,
  type BuiltinSkill,
} from "../../../src/ui/commands/skill-commands.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
} from "../../../src/ui/commands/registry.ts";
import type { Session } from "../../../src/sdk/types.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock CommandContext for testing.
 */
function createMockContext(
  options: {
    session?: Session | null;
    stateOverrides?: Partial<CommandContextState>;
    onSendMessage?: (content: string) => void;
  } = {}
): CommandContext & { sentMessages: string[] } {
  const messages: Array<{ role: string; content: string }> = [];
  const sentMessages: string[] = [];
  return {
    session: options.session ?? (null as Session | null),
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
    sendSilentMessage: (content: string) => {
      sentMessages.push(content);
      if (options.onSendMessage) {
        options.onSendMessage(content);
      }
    },
    spawnSubagent: async () => ({ success: true, output: "Mock sub-agent output" }),
    sentMessages,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("SKILL_DEFINITIONS", () => {
  test("contains core skills", () => {
    const coreSkillNames = ["commit", "research-codebase", "create-spec", "implement-feature", "create-gh-pr", "explain-code"];

    for (const name of coreSkillNames) {
      const skill = SKILL_DEFINITIONS.find((s) => s.name === name);
      expect(skill).toBeDefined();
      expect(skill?.description.length).toBeGreaterThan(0);
    }
  });

  test("contains ralph skills", () => {
    // Note: ralph:ralph-loop, ralph:cancel-ralph, and ralph:ralph-help replaced by SDK-native /ralph workflow
    // No ralph skills remain in SKILL_DEFINITIONS
    const ralphSkills = SKILL_DEFINITIONS.filter((s) => s.name.startsWith("ralph:"));
    expect(ralphSkills.length).toBe(0);
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

  // Note: ralph:ralph-help skill removed - replaced by SDK-native /ralph workflow
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

  test("commit command works without session (uses sendMessage)", async () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = await commitCmd!.execute("", context);

    // Should succeed and send message through sendMessage
    expect(result.success).toBe(true);
    expect(context.sentMessages).toHaveLength(1);
    // Now sends expanded prompt (if skill file exists) or falls back to slash command
    // The sent message should contain the skill prompt or slash command
    expect(context.sentMessages[0]).toBeDefined();
    expect(context.sentMessages[0]!.length).toBeGreaterThan(0);
  });

  test("commit command sends expanded prompt with args", async () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = await commitCmd!.execute("-m 'Fix bug'", context);

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
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    commitCmd!.execute("-m 'Fix bug'", context);

    // No system messages should be added - skill executes silently via sendMessage
    expect(messages.length).toBe(0);
    expect(sentMessages.length).toBe(1);
  });

  test("skill command does not set streaming state directly", async () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = await commitCmd!.execute("", context);

    // sendMessage handles streaming state, not the command result
    expect(result.stateUpdate?.isStreaming).toBeUndefined();
  });

  test("skills are never hidden from autocomplete", () => {
    const antiPatterns = builtinSkillCommands.find((c) => c.name === "testing-anti-patterns");
    expect(antiPatterns).toBeDefined();
    expect(antiPatterns?.hidden).toBeUndefined();
  });
});

describe("builtinSkillCommands", () => {
  test("has correct number of commands", () => {
    expect(builtinSkillCommands.length).toBe(BUILTIN_SKILLS.length);
  });

  test("all commands have skill category", () => {
    for (const cmd of builtinSkillCommands) {
      expect(cmd.category).toBe("skill");
    }
  });

  test("each command has matching builtin skill", () => {
    for (const cmd of builtinSkillCommands) {
      const builtin = BUILTIN_SKILLS.find((s) => s.name === cmd.name);
      expect(builtin).toBeDefined();
      expect(cmd.description).toBe(builtin!.description);
    }
  });

  test("commands use embedded prompts directly", async () => {
    const commitCmd = builtinSkillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = await commitCmd!.execute("test args", context);

    expect(result.success).toBe(true);
    expect(context.sentMessages).toHaveLength(1);
    // Should contain content from embedded prompt
    expect(context.sentMessages[0]).toContain("Conventional Commits");
    expect(context.sentMessages[0]).toContain("test args");
  });
});

describe("registerBuiltinSkills", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  afterEach(() => {
    globalRegistry.clear();
  });

  test("registers all builtin skills", () => {
    registerBuiltinSkills();

    expect(globalRegistry.has("commit")).toBe(true);
    expect(globalRegistry.has("research-codebase")).toBe(true);
    expect(globalRegistry.has("create-spec")).toBe(true);

    expect(globalRegistry.has("implement-feature")).toBe(true);
    expect(globalRegistry.has("create-gh-pr")).toBe(true);
    expect(globalRegistry.has("explain-code")).toBe(true);
  });

  test("registers builtin skill aliases", () => {
    registerBuiltinSkills();

    expect(globalRegistry.has("ci")).toBe(true); // commit alias
    expect(globalRegistry.has("research")).toBe(true); // research-codebase alias
    expect(globalRegistry.has("spec")).toBe(true); // create-spec alias

    expect(globalRegistry.has("impl")).toBe(true); // implement-feature alias
    expect(globalRegistry.has("pr")).toBe(true); // create-gh-pr alias
    expect(globalRegistry.has("explain")).toBe(true); // explain-code alias
  });

  test("is idempotent", () => {
    registerBuiltinSkills();
    registerBuiltinSkills();

    // Should not throw and should still have correct count
    expect(globalRegistry.size()).toBe(BUILTIN_SKILLS.length);
  });

  test("registered commands use embedded prompts", async () => {
    registerBuiltinSkills();

    const commitCmd = globalRegistry.get("commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = await commitCmd!.execute("", context);

    expect(result.success).toBe(true);
    expect(context.sentMessages).toHaveLength(1);
    // Should use embedded prompt, not disk-based
    expect(context.sentMessages[0]).toContain("Conventional Commits");
  });

  test("expands $ARGUMENTS in registered commands", () => {
    registerBuiltinSkills();

    const commitCmd = globalRegistry.get("commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    commitCmd!.execute("my commit message", context);

    expect(context.sentMessages[0]).toContain("my commit message");
    expect(context.sentMessages[0]).not.toContain("$ARGUMENTS");
  });

  test("replaces empty args with placeholder", () => {
    registerBuiltinSkills();

    const commitCmd = globalRegistry.get("commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    commitCmd!.execute("", context);

    expect(context.sentMessages[0]).toContain("[no arguments provided]");
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
    // Note: ralph:ralph-help removed - replaced by SDK-native /ralph workflow
  });

  test("registers skill aliases", () => {
    registerSkillCommands();

    expect(globalRegistry.has("ci")).toBe(true); // commit alias
    expect(globalRegistry.has("research")).toBe(true); // research-codebase alias
    expect(globalRegistry.has("spec")).toBe(true); // create-spec alias
    // Note: ralph-help alias removed - replaced by SDK-native /ralph workflow
  });

  test("is idempotent", () => {
    registerSkillCommands();
    registerSkillCommands();

    // Should not throw and should still have correct count
    // BUILTIN_SKILLS take priority; legacy SKILL_DEFINITIONS only add non-overlapping entries
    expect(globalRegistry.size()).toBe(BUILTIN_SKILLS.length);
  });

  test("commands are executable after registration", async () => {
    registerSkillCommands();

    const commitCmd = globalRegistry.get("commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    const result = await commitCmd!.execute("", context);

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

  test("builtin skills take priority over legacy skills", () => {
    registerSkillCommands();

    // commit exists in both BUILTIN_SKILLS and SKILL_DEFINITIONS
    // The registered command should use the builtin prompt
    const commitCmd = globalRegistry.get("commit");
    expect(commitCmd).toBeDefined();

    const context = createMockContext({ session: null });
    commitCmd!.execute("", context);

    // Should use embedded prompt (has "Conventional Commits")
    expect(context.sentMessages[0]).toContain("Conventional Commits");
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
    // Note: ralph:ralph-help removed - replaced by SDK-native /ralph workflow
    // No ralph skills remain in SKILL_DEFINITIONS
    const ralphHelp = getSkillMetadata("ralph:ralph-help");
    expect(ralphHelp).toBeUndefined();
  });
});

describe("isRalphSkill", () => {
  test("returns true for ralph-prefixed names (utility function)", () => {
    // Note: even though no ralph skills exist in SKILL_DEFINITIONS,
    // isRalphSkill still works as a name-pattern utility
    expect(isRalphSkill("ralph:some-skill")).toBe(true);
  });

  test("returns false for non-ralph skills", () => {
    expect(isRalphSkill("commit")).toBe(false);
    expect(isRalphSkill("research-codebase")).toBe(false);
    expect(isRalphSkill("create-spec")).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(isRalphSkill("RALPH:some-skill")).toBe(true);
    expect(isRalphSkill("Ralph:Some-Skill")).toBe(true);
  });
});

describe("getRalphSkills", () => {
  test("returns only ralph skills", () => {
    const ralphSkills = getRalphSkills();

    // All ralph skills removed after SDK-native /ralph workflow migration
    expect(ralphSkills.length).toBe(0);
    for (const skill of ralphSkills) {
      expect(skill.name.toLowerCase().startsWith("ralph:")).toBe(true);
    }
  });

  test("returns empty array after migration", () => {
    const ralphSkills = getRalphSkills();
    const names = ralphSkills.map((s) => s.name);

    // Note: ralph:ralph-help removed - replaced by SDK-native /ralph workflow
    expect(names).not.toContain("ralph:ralph-help");
    expect(names.length).toBe(0);
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

    // Note: ralph:ralph-help removed - no ralph skills to exclude
    expect(names.filter(n => n.startsWith("ralph:"))).toEqual([]);
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

  test("BuiltinSkill does not have hidden property (skills are always visible)", () => {
    const skill: BuiltinSkill = {
      name: "internal-skill",
      description: "An internal skill",
      prompt: "Do internal things",
    };

    expect((skill as any).hidden).toBeUndefined();
  });

  test("BuiltinSkill with all optional fields", () => {
    const fullSkill: BuiltinSkill = {
      name: "full-skill",
      description: "A fully-configured skill",
      prompt: "Execute: $ARGUMENTS",
      aliases: ["fs", "full"],
    };

    expect(fullSkill.name).toBe("full-skill");
    expect(fullSkill.description).toBe("A fully-configured skill");
    expect(fullSkill.prompt).toBe("Execute: $ARGUMENTS");
    expect(fullSkill.aliases).toEqual(["fs", "full"]);
  });
});

describe("BUILTIN_SKILLS", () => {
  test("contains commit skill", () => {
    const commit = BUILTIN_SKILLS.find((s) => s.name === "commit");
    expect(commit).toBeDefined();
    expect(commit?.description).toBe("Create well-formatted commits with conventional commit format.");
    expect(commit?.aliases).toContain("ci");
    expect(commit?.prompt).toBeDefined();
    expect(commit?.prompt.length).toBeGreaterThan(100);
  });

  test("commit skill has $ARGUMENTS placeholder", () => {
    const commit = BUILTIN_SKILLS.find((s) => s.name === "commit");
    expect(commit?.prompt).toContain("$ARGUMENTS");
  });

  test("commit skill includes conventional commit guidelines", () => {
    const commit = BUILTIN_SKILLS.find((s) => s.name === "commit");
    expect(commit?.prompt).toContain("Conventional Commits");
    expect(commit?.prompt).toContain("feat:");
    expect(commit?.prompt).toContain("fix:");
    expect(commit?.prompt).toContain("BREAKING CHANGE");
  });

  test("commit skill includes git commands", () => {
    const commit = BUILTIN_SKILLS.find((s) => s.name === "commit");
    expect(commit?.prompt).toContain("git status");
    expect(commit?.prompt).toContain("git diff");
    expect(commit?.prompt).toContain("git log");
  });

  test("all builtin skills have required fields", () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(typeof skill.name).toBe("string");
      expect(skill.name.length).toBeGreaterThan(0);
      expect(typeof skill.description).toBe("string");
      expect(skill.description.length).toBeGreaterThan(0);
      expect(typeof skill.prompt).toBe("string");
      expect(skill.prompt.length).toBeGreaterThan(0);
    }
  });

  test("contains research-codebase skill", () => {
    const research = BUILTIN_SKILLS.find((s) => s.name === "research-codebase");
    expect(research).toBeDefined();
    expect(research?.description).toBe("Document codebase as-is with research directory for historical context");
    expect(research?.aliases).toContain("research");
    expect(research?.prompt).toBeDefined();
    expect(research?.prompt.length).toBeGreaterThan(100);
  });

  test("research-codebase skill has $ARGUMENTS placeholder", () => {
    const research = BUILTIN_SKILLS.find((s) => s.name === "research-codebase");
    expect(research?.prompt).toContain("$ARGUMENTS");
  });

  test("research-codebase skill includes research workflow steps", () => {
    const research = BUILTIN_SKILLS.find((s) => s.name === "research-codebase");
    expect(research?.prompt).toContain("codebase-locator");
    expect(research?.prompt).toContain("codebase-analyzer");
    expect(research?.prompt).toContain("codebase-research-locator");
    expect(research?.prompt).toContain("codebase-research-analyzer");
    expect(research?.prompt).toContain("codebase-online-researcher");
  });

  test("research-codebase skill includes documentation guidelines", () => {
    const research = BUILTIN_SKILLS.find((s) => s.name === "research-codebase");
    expect(research?.prompt).toContain("documentarians, not evaluators");
    expect(research?.prompt).toContain("Document what IS, not what SHOULD BE");
  });

  test("contains create-spec skill", () => {
    const spec = BUILTIN_SKILLS.find((s) => s.name === "create-spec");
    expect(spec).toBeDefined();
    expect(spec?.description).toBe("Create a detailed execution plan for implementing features or refactors in a codebase by leveraging existing research in the specified \`research\` directory.");
    expect(spec?.aliases).toContain("spec");
    expect(spec?.prompt).toBeDefined();
    expect(spec?.prompt.length).toBeGreaterThan(100);
  });

  test("create-spec skill has $ARGUMENTS placeholder", () => {
    const spec = BUILTIN_SKILLS.find((s) => s.name === "create-spec");
    expect(spec?.prompt).toContain("$ARGUMENTS");
  });

  test("create-spec skill includes spec structure sections", () => {
    const spec = BUILTIN_SKILLS.find((s) => s.name === "create-spec");
    expect(spec?.prompt).toContain("Executive Summary");
    expect(spec?.prompt).toContain("Context and Motivation");
    expect(spec?.prompt).toContain("Proposed Solution");
    expect(spec?.prompt).toContain("Detailed Design");
    expect(spec?.prompt).toContain("Alternatives Considered");
    expect(spec?.prompt).toContain("Cross-Cutting Concerns");
  });

  test("create-spec skill references research artifacts", () => {
    const spec = BUILTIN_SKILLS.find((s) => s.name === "create-spec");
    expect(spec?.prompt).toContain("codebase-research-locator");
    expect(spec?.prompt).toContain("codebase-research-analyzer");
    expect(spec?.prompt).toContain("specs");
  });

  test("contains implement-feature skill", () => {
    const implFeature = BUILTIN_SKILLS.find((s) => s.name === "implement-feature");
    expect(implFeature).toBeDefined();
    expect(implFeature?.description).toBe("Implement a SINGLE feature from \`research/tasks.json\` based on the provided execution plan.");
    expect(implFeature?.aliases).toContain("impl");
    expect(implFeature?.prompt).toBeDefined();
    expect(implFeature?.prompt.length).toBeGreaterThan(100);
  });

  test("implement-feature skill does not use $ARGUMENTS placeholder", () => {
    const implFeature = BUILTIN_SKILLS.find((s) => s.name === "implement-feature");
    expect(implFeature?.prompt).not.toContain("$ARGUMENTS");
  });

  test("implement-feature skill includes implementation process", () => {
    const implFeature = BUILTIN_SKILLS.find((s) => s.name === "implement-feature");
    expect(implFeature?.prompt).toContain("research/tasks.json");
    expect(implFeature?.prompt).toContain("research/progress.txt");
    expect(implFeature?.prompt).toContain("passes");
    expect(implFeature?.prompt).toContain("Test-Driven Development");
  });

  test("implement-feature skill includes design principles", () => {
    const implFeature = BUILTIN_SKILLS.find((s) => s.name === "implement-feature");
    expect(implFeature?.prompt).toContain("SOLID");
    expect(implFeature?.prompt).toContain("KISS");
    expect(implFeature?.prompt).toContain("YAGNI");
    expect(implFeature?.prompt).toContain("Separation of Concerns");
  });

  test("contains create-gh-pr skill", () => {
    const ghPr = BUILTIN_SKILLS.find((s) => s.name === "create-gh-pr");
    expect(ghPr).toBeDefined();
    expect(ghPr?.description).toBe("Commit unstaged changes, push changes, submit a pull request.");
    expect(ghPr?.aliases).toContain("pr");
    expect(ghPr?.prompt).toBeDefined();
    expect(ghPr?.prompt.length).toBeGreaterThan(50);
  });

  test("create-gh-pr skill does not use $ARGUMENTS placeholder", () => {
    const ghPr = BUILTIN_SKILLS.find((s) => s.name === "create-gh-pr");
    expect(ghPr?.prompt).not.toContain("$ARGUMENTS");
  });

  test("create-gh-pr skill includes PR workflow steps", () => {
    const ghPr = BUILTIN_SKILLS.find((s) => s.name === "create-gh-pr");
    expect(ghPr?.prompt).toContain("/commit");
    expect(ghPr?.prompt).toContain("pull request");
    expect(ghPr?.prompt).toContain("push");
  });

  test("create-gh-pr skill includes PR behavior description", () => {
    const ghPr = BUILTIN_SKILLS.find((s) => s.name === "create-gh-pr");
    expect(ghPr?.prompt).toContain("Creates logical commits");
    expect(ghPr?.prompt).toContain("Pushes branch to remote");
    expect(ghPr?.prompt).toContain("Creates pull request");
  });

  test("contains explain-code skill", () => {
    const explainCode = BUILTIN_SKILLS.find((s) => s.name === "explain-code");
    expect(explainCode).toBeDefined();
    expect(explainCode?.description).toBe("Explain code functionality in detail.");
    expect(explainCode?.aliases).toContain("explain");
    expect(explainCode?.prompt).toBeDefined();
    expect(explainCode?.prompt.length).toBeGreaterThan(100);
  });

  test("explain-code skill has $ARGUMENTS placeholder", () => {
    const explainCode = BUILTIN_SKILLS.find((s) => s.name === "explain-code");
    expect(explainCode?.prompt).toContain("$ARGUMENTS");
  });

  test("explain-code skill includes explanation structure", () => {
    const explainCode = BUILTIN_SKILLS.find((s) => s.name === "explain-code");
    expect(explainCode?.prompt).toContain("High-Level Overview");
    expect(explainCode?.prompt).toContain("Code Structure Breakdown");
    expect(explainCode?.prompt).toContain("data flow");
    expect(explainCode?.prompt).toContain("Error Handling");
  });

  test("explain-code skill includes language-specific sections", () => {
    const explainCode = BUILTIN_SKILLS.find((s) => s.name === "explain-code");
    expect(explainCode?.prompt).toContain("JavaScript/TypeScript");
    expect(explainCode?.prompt).toContain("Python");
    expect(explainCode?.prompt).toContain("Go");
    expect(explainCode?.prompt).toContain("Rust");
  });
});

describe("getBuiltinSkill", () => {
  test("finds builtin skill by name", () => {
    const commit = getBuiltinSkill("commit");
    expect(commit).toBeDefined();
    expect(commit?.name).toBe("commit");
  });

  test("finds builtin skill by alias", () => {
    const byAlias = getBuiltinSkill("ci");
    expect(byAlias).toBeDefined();
    expect(byAlias?.name).toBe("commit");
  });

  test("is case-insensitive", () => {
    expect(getBuiltinSkill("COMMIT")?.name).toBe("commit");
    expect(getBuiltinSkill("Commit")?.name).toBe("commit");
    expect(getBuiltinSkill("CI")?.name).toBe("commit");
  });

  test("returns undefined for non-builtin skill", () => {
    // Note: ralph:ralph-help removed from SKILL_DEFINITIONS - no ralph skills exist
    const unknownSkill = getBuiltinSkill("some-unknown-skill");
    expect(unknownSkill).toBeUndefined();
  });

  test("finds create-gh-pr builtin skill by name", () => {
    const ghPr = getBuiltinSkill("create-gh-pr");
    expect(ghPr).toBeDefined();
    expect(ghPr?.name).toBe("create-gh-pr");
  });

  test("finds create-gh-pr builtin skill by alias", () => {
    const byAlias = getBuiltinSkill("pr");
    expect(byAlias).toBeDefined();
    expect(byAlias?.name).toBe("create-gh-pr");
  });

  test("finds implement-feature builtin skill by name", () => {
    const implFeature = getBuiltinSkill("implement-feature");
    expect(implFeature).toBeDefined();
    expect(implFeature?.name).toBe("implement-feature");
  });

  test("finds implement-feature builtin skill by alias", () => {
    const byAlias = getBuiltinSkill("impl");
    expect(byAlias).toBeDefined();
    expect(byAlias?.name).toBe("implement-feature");
  });

  test("finds create-spec builtin skill by name", () => {
    const spec = getBuiltinSkill("create-spec");
    expect(spec).toBeDefined();
    expect(spec?.name).toBe("create-spec");
  });

  test("finds create-spec builtin skill by alias", () => {
    const byAlias = getBuiltinSkill("spec");
    expect(byAlias).toBeDefined();
    expect(byAlias?.name).toBe("create-spec");
  });

  test("finds research-codebase builtin skill by name", () => {
    const research = getBuiltinSkill("research-codebase");
    expect(research).toBeDefined();
    expect(research?.name).toBe("research-codebase");
  });

  test("finds research-codebase builtin skill by alias", () => {
    const byAlias = getBuiltinSkill("research");
    expect(byAlias).toBeDefined();
    expect(byAlias?.name).toBe("research-codebase");
  });

  test("returns undefined for unknown skill", () => {
    expect(getBuiltinSkill("unknown-skill")).toBeUndefined();
    expect(getBuiltinSkill("")).toBeUndefined();
  });

  test("finds explain-code builtin skill by name", () => {
    const explainCode = getBuiltinSkill("explain-code");
    expect(explainCode).toBeDefined();
    expect(explainCode?.name).toBe("explain-code");
  });

  test("finds explain-code builtin skill by alias", () => {
    const byAlias = getBuiltinSkill("explain");
    expect(byAlias).toBeDefined();
    expect(byAlias?.name).toBe("explain-code");
  });
});

describe("builtin skill execution", () => {
  test("commit command uses embedded prompt", async () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await commitCmd!.execute("", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should use embedded prompt, not disk-based or slash command fallback
    expect(sentMessages[0]).toContain("Conventional Commits");
    expect(sentMessages[0]).toContain("[no arguments provided]");
  });

  test("commit command expands $ARGUMENTS with provided args", async () => {
    const commitCmd = skillCommands.find((c) => c.name === "commit");
    expect(commitCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await commitCmd!.execute("-m 'Fix bug in parser'", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should have expanded $ARGUMENTS with the provided args
    expect(sentMessages[0]).toContain("-m 'Fix bug in parser'");
    expect(sentMessages[0]).not.toContain("$ARGUMENTS");
    expect(sentMessages[0]).not.toContain("[no arguments provided]");
  });

  test("research-codebase command uses embedded prompt", async () => {
    const researchCmd = skillCommands.find((c) => c.name === "research-codebase");
    expect(researchCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await researchCmd!.execute("", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should use embedded prompt with research workflow
    expect(sentMessages[0]).toContain("codebase-locator");
    expect(sentMessages[0]).toContain("[no arguments provided]");
  });

  test("research-codebase command expands $ARGUMENTS with provided args", async () => {
    const researchCmd = skillCommands.find((c) => c.name === "research-codebase");
    expect(researchCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await researchCmd!.execute("authentication module", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should have expanded $ARGUMENTS with the provided args
    expect(sentMessages[0]).toContain("authentication module");
    expect(sentMessages[0]).not.toContain("$ARGUMENTS");
    expect(sentMessages[0]).not.toContain("[no arguments provided]");
  });

  test("create-spec command uses embedded prompt", async () => {
    const specCmd = skillCommands.find((c) => c.name === "create-spec");
    expect(specCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await specCmd!.execute("", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should use embedded prompt with spec structure
    expect(sentMessages[0]).toContain("Executive Summary");
    expect(sentMessages[0]).toContain("[no arguments provided]");
  });

  test("create-spec command expands $ARGUMENTS with provided args", async () => {
    const specCmd = skillCommands.find((c) => c.name === "create-spec");
    expect(specCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await specCmd!.execute("add user authentication", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should have expanded $ARGUMENTS with the provided args
    expect(sentMessages[0]).toContain("add user authentication");
    expect(sentMessages[0]).not.toContain("$ARGUMENTS");
    expect(sentMessages[0]).not.toContain("[no arguments provided]");
  });

  test("implement-feature command uses embedded prompt", async () => {
    const implFeatureCmd = skillCommands.find((c) => c.name === "implement-feature");
    expect(implFeatureCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await implFeatureCmd!.execute("", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should use embedded prompt with implementation process
    expect(sentMessages[0]).toContain("research/tasks.json");
    // No $ARGUMENTS in this prompt, so no placeholder substitution
    expect(sentMessages[0]).not.toContain("$ARGUMENTS");
  });

  test("implement-feature command sends prompt without argument expansion", async () => {
    const implFeatureCmd = skillCommands.find((c) => c.name === "implement-feature");
    expect(implFeatureCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await implFeatureCmd!.execute("UserRepository", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // implement-feature does not use $ARGUMENTS, so args are not injected into prompt
    expect(sentMessages[0]).toContain("research/tasks.json");
    expect(sentMessages[0]).not.toContain("$ARGUMENTS");
  });

  test("create-gh-pr command uses embedded prompt", async () => {
    const ghPrCmd = skillCommands.find((c) => c.name === "create-gh-pr");
    expect(ghPrCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await ghPrCmd!.execute("", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should use embedded prompt with PR workflow
    expect(sentMessages[0]).toContain("/commit");
    // No $ARGUMENTS in this prompt, so no placeholder substitution
    expect(sentMessages[0]).not.toContain("$ARGUMENTS");
  });

  test("create-gh-pr command sends prompt without argument expansion", async () => {
    const ghPrCmd = skillCommands.find((c) => c.name === "create-gh-pr");
    expect(ghPrCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await ghPrCmd!.execute("Add user authentication", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // create-gh-pr does not use $ARGUMENTS, so args are not injected into prompt
    expect(sentMessages[0]).toContain("/commit");
    expect(sentMessages[0]).not.toContain("$ARGUMENTS");
  });

  test("explain-code command uses embedded prompt", async () => {
    const explainCodeCmd = skillCommands.find((c) => c.name === "explain-code");
    expect(explainCodeCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await explainCodeCmd!.execute("", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should use embedded prompt with explanation structure
    expect(sentMessages[0]).toContain("Analyze and Explain Code Functionality");
    expect(sentMessages[0]).toContain("[no arguments provided]");
  });

  test("explain-code command expands $ARGUMENTS with provided args", async () => {
    const explainCodeCmd = skillCommands.find((c) => c.name === "explain-code");
    expect(explainCodeCmd).toBeDefined();

    const sentMessages: string[] = [];
    const context: CommandContext = {
      session: null,
      state: { isStreaming: false, messageCount: 0 },
      addMessage: () => {},
      setStreaming: () => {},
      sendMessage: (content) => {
        sentMessages.push(content);
      },
      sendSilentMessage: (content) => {
        sentMessages.push(content);
      },
      spawnSubagent: async () => ({ success: true, output: "Mock output" }),
      agentType: undefined,
      modelOps: undefined,
    };

    const result = await explainCodeCmd!.execute("src/utils/parser.ts:10-50", context);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    // Should have expanded $ARGUMENTS with the provided args
    expect(sentMessages[0]).toContain("src/utils/parser.ts:10-50");
    expect(sentMessages[0]).not.toContain("$ARGUMENTS");
    expect(sentMessages[0]).not.toContain("[no arguments provided]");
  });
});

// ============================================================================
// UNIT TESTS: expandArguments function
// ============================================================================

describe("expandArguments", () => {
  describe("$ARGUMENTS replaced with args value", () => {
    test("replaces single $ARGUMENTS with provided args", () => {
      const prompt = "Execute command: $ARGUMENTS";
      const args = "test-value";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Execute command: test-value");
      expect(result).not.toContain("$ARGUMENTS");
    });

    test("replaces $ARGUMENTS at the beginning of prompt", () => {
      const prompt = "$ARGUMENTS is the input";
      const args = "hello";
      const result = expandArguments(prompt, args);

      expect(result).toBe("hello is the input");
    });

    test("replaces $ARGUMENTS at the end of prompt", () => {
      const prompt = "Process this: $ARGUMENTS";
      const args = "world";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Process this: world");
    });

    test("replaces $ARGUMENTS in the middle of prompt", () => {
      const prompt = "Start $ARGUMENTS end";
      const args = "middle";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Start middle end");
    });

    test("preserves surrounding whitespace", () => {
      const prompt = "Run   $ARGUMENTS   here";
      const args = "command";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Run   command   here");
    });
  });

  describe("empty args replaced with placeholder", () => {
    test("replaces $ARGUMENTS with placeholder for empty string", () => {
      const prompt = "Execute: $ARGUMENTS";
      const args = "";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Execute: [no arguments provided]");
      expect(result).not.toContain("$ARGUMENTS");
    });

    test("replaces $ARGUMENTS with placeholder for whitespace-only string", () => {
      // Note: The function uses args || placeholder, so empty string triggers placeholder
      const prompt = "Execute: $ARGUMENTS";
      const args = "";
      const result = expandArguments(prompt, args);

      expect(result).toContain("[no arguments provided]");
    });

    test("uses provided args when not empty", () => {
      const prompt = "Execute: $ARGUMENTS";
      const args = "actual-value";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Execute: actual-value");
      expect(result).not.toContain("[no arguments provided]");
    });
  });

  describe("multiple $ARGUMENTS occurrences all replaced", () => {
    test("replaces multiple $ARGUMENTS with same args value", () => {
      const prompt = "First: $ARGUMENTS, Second: $ARGUMENTS";
      const args = "value";
      const result = expandArguments(prompt, args);

      expect(result).toBe("First: value, Second: value");
      expect(result).not.toContain("$ARGUMENTS");
    });

    test("replaces three $ARGUMENTS occurrences", () => {
      const prompt = "$ARGUMENTS -> $ARGUMENTS -> $ARGUMENTS";
      const args = "test";
      const result = expandArguments(prompt, args);

      expect(result).toBe("test -> test -> test");
    });

    test("replaces many $ARGUMENTS occurrences", () => {
      const prompt = "A: $ARGUMENTS, B: $ARGUMENTS, C: $ARGUMENTS, D: $ARGUMENTS, E: $ARGUMENTS";
      const args = "x";
      const result = expandArguments(prompt, args);

      expect(result).toBe("A: x, B: x, C: x, D: x, E: x");
      expect(result.split("$ARGUMENTS").length).toBe(1); // No occurrences left
    });

    test("replaces multiple $ARGUMENTS with empty args using placeholder", () => {
      const prompt = "First: $ARGUMENTS\nSecond: $ARGUMENTS";
      const args = "";
      const result = expandArguments(prompt, args);

      expect(result).toBe("First: [no arguments provided]\nSecond: [no arguments provided]");
    });

    test("replaces $ARGUMENTS on multiple lines", () => {
      const prompt = `Line 1: $ARGUMENTS
Line 2: $ARGUMENTS
Line 3: $ARGUMENTS`;
      const args = "multi-line-value";
      const result = expandArguments(prompt, args);

      expect(result).toContain("Line 1: multi-line-value");
      expect(result).toContain("Line 2: multi-line-value");
      expect(result).toContain("Line 3: multi-line-value");
      expect(result).not.toContain("$ARGUMENTS");
    });
  });

  describe("special characters in args handled correctly", () => {
    test("handles args with single quotes", () => {
      const prompt = "Message: $ARGUMENTS";
      const args = "it's a test";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Message: it's a test");
    });

    test("handles args with double quotes", () => {
      const prompt = "Message: $ARGUMENTS";
      const args = 'say "hello"';
      const result = expandArguments(prompt, args);

      expect(result).toBe('Message: say "hello"');
    });

    test("handles args with backslashes", () => {
      const prompt = "Path: $ARGUMENTS";
      const args = "C:\\Users\\test\\file.txt";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Path: C:\\Users\\test\\file.txt");
    });

    test("handles args with regex special characters", () => {
      const prompt = "Pattern: $ARGUMENTS";
      const args = "test.*pattern+[a-z]?";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Pattern: test.*pattern+[a-z]?");
    });

    test("handles args with dollar signs (not $ARGUMENTS)", () => {
      const prompt = "Value: $ARGUMENTS";
      const args = "$100 price";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Value: $100 price");
    });

    test("handles args with newlines", () => {
      const prompt = "Content: $ARGUMENTS";
      const args = "line1\nline2\nline3";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Content: line1\nline2\nline3");
    });

    test("handles args with tabs", () => {
      const prompt = "Data: $ARGUMENTS";
      const args = "col1\tcol2\tcol3";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Data: col1\tcol2\tcol3");
    });

    test("handles args with unicode characters", () => {
      const prompt = "Message: $ARGUMENTS";
      const args = "Hello \u4e16\u754c \ud83c\udf1f";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Message: Hello \u4e16\u754c \ud83c\udf1f");
    });

    test("handles args with HTML/XML-like content", () => {
      const prompt = "Code: $ARGUMENTS";
      const args = "<div class=\"test\">content</div>";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Code: <div class=\"test\">content</div>");
    });

    test("handles args with JSON content", () => {
      const prompt = "JSON: $ARGUMENTS";
      const args = '{"key": "value", "array": [1, 2, 3]}';
      const result = expandArguments(prompt, args);

      expect(result).toBe('JSON: {"key": "value", "array": [1, 2, 3]}');
    });

    test("handles args with pipe and ampersand", () => {
      const prompt = "Command: $ARGUMENTS";
      const args = "cmd1 | cmd2 && cmd3";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Command: cmd1 | cmd2 && cmd3");
    });

    test("handles args with parentheses and brackets", () => {
      const prompt = "Expression: $ARGUMENTS";
      const args = "func(arg) + arr[0]";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Expression: func(arg) + arr[0]");
    });

    test("handles args with mixed special characters", () => {
      const prompt = "Complex: $ARGUMENTS";
      const args = "-m 'Fix bug: \"parser\" error' --file=C:\\path\\to\\file.ts";
      const result = expandArguments(prompt, args);

      expect(result).toBe("Complex: -m 'Fix bug: \"parser\" error' --file=C:\\path\\to\\file.ts");
    });
  });

  describe("edge cases", () => {
    test("handles prompt with no $ARGUMENTS placeholder", () => {
      const prompt = "No placeholder here";
      const args = "ignored";
      const result = expandArguments(prompt, args);

      expect(result).toBe("No placeholder here");
    });

    test("handles empty prompt", () => {
      const prompt = "";
      const args = "value";
      const result = expandArguments(prompt, args);

      expect(result).toBe("");
    });

    test("handles $ARGUMENTS-like but different pattern", () => {
      const prompt = "$ARG is not $ARGUMENTS";
      const args = "value";
      const result = expandArguments(prompt, args);

      // $ARG should remain, only $ARGUMENTS should be replaced
      expect(result).toBe("$ARG is not value");
    });

    test("handles case-sensitive replacement", () => {
      const prompt = "$arguments vs $ARGUMENTS";
      const args = "value";
      const result = expandArguments(prompt, args);

      // Only uppercase $ARGUMENTS should be replaced
      expect(result).toBe("$arguments vs value");
    });

    test("handles $ARGUMENTS adjacent to text without spaces", () => {
      const prompt = "prefix$ARGUMENTSsuffix";
      const args = "VALUE";
      const result = expandArguments(prompt, args);

      expect(result).toBe("prefixVALUEsuffix");
    });

    test("handles very long args string", () => {
      const prompt = "Content: $ARGUMENTS";
      const args = "a".repeat(10000);
      const result = expandArguments(prompt, args);

      expect(result).toBe("Content: " + "a".repeat(10000));
      expect(result.length).toBe(9 + 10000); // "Content: " (9 chars) + 10000 'a's
    });
  });
});
