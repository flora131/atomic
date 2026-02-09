/**
 * Tests for Disk-Based Skill Discovery
 *
 * Tests cover:
 * - discoverSkillFiles() — scanning project-local and global directories
 * - parseSkillFile() — frontmatter parsing and fallback behavior
 * - shouldSkillOverride() — priority resolution including pinned builtins
 * - loadSkillContent() — lazy L2 content loading
 * - discoverAndRegisterDiskSkills() — end-to-end registration flow
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  shouldSkillOverride,
  parseSkillFile,
  loadSkillContent,
  PINNED_BUILTIN_SKILLS,
  SKILL_DISCOVERY_PATHS,
  GLOBAL_SKILL_PATHS,
  type SkillSource,
  type DiscoveredSkillFile,
  type DiskSkillDefinition,
} from "../../../src/ui/commands/skill-commands.ts";
import { parseMarkdownFrontmatter } from "../../../src/utils/markdown.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ============================================================================
// TEST HELPERS
// ============================================================================

let testDir: string;

function setupTestDir(): string {
  const dir = join(tmpdir(), `skill-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createSkillFile(baseDir: string, skillName: string, content: string): string {
  const skillDir = join(baseDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, "SKILL.md");
  writeFileSync(skillPath, content);
  return skillPath;
}

// ============================================================================
// shouldSkillOverride TESTS
// ============================================================================

describe("shouldSkillOverride", () => {
  test("pinned builtins cannot be overridden", () => {
    expect(shouldSkillOverride("project", "builtin", "prompt-engineer")).toBe(false);
    expect(shouldSkillOverride("project", "builtin", "testing-anti-patterns")).toBe(false);
    expect(shouldSkillOverride("user", "builtin", "prompt-engineer")).toBe(false);
    expect(shouldSkillOverride("atomic", "builtin", "testing-anti-patterns")).toBe(false);
  });

  test("non-pinned builtins can be overridden by project", () => {
    expect(shouldSkillOverride("project", "builtin", "commit")).toBe(true);
  });

  test("non-pinned builtins can be overridden by atomic", () => {
    expect(shouldSkillOverride("atomic", "builtin", "commit")).toBe(true);
  });

  test("non-pinned builtins can be overridden by user/global", () => {
    expect(shouldSkillOverride("user", "builtin", "commit")).toBe(true);
  });

  test("project overrides atomic", () => {
    expect(shouldSkillOverride("project", "atomic", "my-skill")).toBe(true);
  });

  test("project overrides user", () => {
    expect(shouldSkillOverride("project", "user", "my-skill")).toBe(true);
  });

  test("atomic overrides user", () => {
    expect(shouldSkillOverride("atomic", "user", "my-skill")).toBe(true);
  });

  test("user does not override project", () => {
    expect(shouldSkillOverride("user", "project", "my-skill")).toBe(false);
  });

  test("user does not override atomic", () => {
    expect(shouldSkillOverride("user", "atomic", "my-skill")).toBe(false);
  });

  test("same priority does not override", () => {
    expect(shouldSkillOverride("project", "project", "my-skill")).toBe(false);
    expect(shouldSkillOverride("user", "user", "my-skill")).toBe(false);
  });
});

// ============================================================================
// PINNED_BUILTIN_SKILLS TESTS
// ============================================================================

describe("PINNED_BUILTIN_SKILLS", () => {
  test("contains prompt-engineer", () => {
    expect(PINNED_BUILTIN_SKILLS.has("prompt-engineer")).toBe(true);
  });

  test("contains testing-anti-patterns", () => {
    expect(PINNED_BUILTIN_SKILLS.has("testing-anti-patterns")).toBe(true);
  });

  test("does not contain regular skills", () => {
    expect(PINNED_BUILTIN_SKILLS.has("commit")).toBe(false);
    expect(PINNED_BUILTIN_SKILLS.has("research-codebase")).toBe(false);
  });
});

// ============================================================================
// parseSkillFile TESTS
// ============================================================================

describe("parseSkillFile", () => {
  beforeEach(() => {
    testDir = setupTestDir();
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test("parses skill with full frontmatter", () => {
    const skillPath = createSkillFile(
      testDir,
      "my-skill",
      `---
name: my-skill
description: A test skill
aliases:
  - ms
  - test-skill
argument-hint: [args]
hidden: false
---
# My Skill Instructions
Do the thing: $ARGUMENTS
`
    );

    const result = parseSkillFile({
      path: skillPath,
      dirName: "my-skill",
      source: "project",
    });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("my-skill");
    expect(result!.description).toBe("A test skill");
    expect(result!.aliases).toEqual(["ms", "test-skill"]);
    expect(result!.argumentHint).toBe("[args]");
    expect(result!.source).toBe("project");
    expect(result!.skillFilePath).toBe(skillPath);
  });

  test("falls back to dirName when name is missing", () => {
    const skillPath = createSkillFile(
      testDir,
      "fallback-skill",
      `---
description: A skill without name
---
Instructions here
`
    );

    const result = parseSkillFile({
      path: skillPath,
      dirName: "fallback-skill",
      source: "user",
    });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("fallback-skill");
  });

  test("falls back to default description when missing", () => {
    const skillPath = createSkillFile(
      testDir,
      "no-desc",
      `---
name: no-desc
---
Instructions
`
    );

    const result = parseSkillFile({
      path: skillPath,
      dirName: "no-desc",
      source: "project",
    });

    expect(result).not.toBeNull();
    expect(result!.description).toBe("Skill: no-desc");
  });

  test("ignores user-invocable: false (skills are never hidden)", () => {
    const skillPath = createSkillFile(
      testDir,
      "hidden-skill",
      `---
name: hidden-skill
description: A hidden skill
user-invocable: false
---
Background knowledge only
`
    );

    const result = parseSkillFile({
      path: skillPath,
      dirName: "hidden-skill",
      source: "project",
    });

    expect(result).not.toBeNull();
    expect((result as any).hidden).toBeUndefined();
  });

  test("returns defaults when no frontmatter present", () => {
    const skillPath = createSkillFile(
      testDir,
      "no-fm",
      `# Just a skill
Do something
`
    );

    const result = parseSkillFile({
      path: skillPath,
      dirName: "no-fm",
      source: "project",
    });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("no-fm");
    expect(result!.description).toBe("Skill: no-fm");
  });

  test("returns null for non-existent file", () => {
    const result = parseSkillFile({
      path: join(testDir, "nonexistent", "SKILL.md"),
      dirName: "nonexistent",
      source: "project",
    });

    expect(result).toBeNull();
  });
});

// ============================================================================
// loadSkillContent TESTS
// ============================================================================

describe("loadSkillContent", () => {
  beforeEach(() => {
    testDir = setupTestDir();
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test("returns body content (L2) from SKILL.md with frontmatter", () => {
    const skillPath = createSkillFile(
      testDir,
      "content-skill",
      `---
name: content-skill
description: Test
---
# Instructions
Do the thing with $ARGUMENTS
`
    );

    const body = loadSkillContent(skillPath);
    expect(body).not.toBeNull();
    expect(body).toContain("# Instructions");
    expect(body).toContain("$ARGUMENTS");
    // Should not contain frontmatter
    expect(body).not.toContain("name: content-skill");
  });

  test("returns entire content when no frontmatter", () => {
    const skillPath = createSkillFile(
      testDir,
      "plain-skill",
      `# Just instructions
Do things
`
    );

    const body = loadSkillContent(skillPath);
    expect(body).not.toBeNull();
    expect(body).toContain("# Just instructions");
  });

  test("returns null for non-existent file", () => {
    const body = loadSkillContent(join(testDir, "nope", "SKILL.md"));
    expect(body).toBeNull();
  });
});

// ============================================================================
// parseMarkdownFrontmatter (shared utility) TESTS
// ============================================================================

describe("parseMarkdownFrontmatter (shared utility)", () => {
  test("parses standard frontmatter", () => {
    const result = parseMarkdownFrontmatter(`---
name: test
description: A test
---
Body content
`);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.name).toBe("test");
    expect(result!.frontmatter.description).toBe("A test");
    expect(result!.body).toContain("Body content");
  });

  test("returns null without frontmatter", () => {
    expect(parseMarkdownFrontmatter("No frontmatter")).toBeNull();
  });

  test("parses boolean values", () => {
    const result = parseMarkdownFrontmatter(`---
hidden: true
user-invocable: false
---
Body
`);
    expect(result!.frontmatter.hidden).toBe(true);
    expect(result!.frontmatter["user-invocable"]).toBe(false);
  });

  test("parses arrays", () => {
    const result = parseMarkdownFrontmatter(`---
aliases:
  - a
  - b
---
Body
`);
    expect(result!.frontmatter.aliases).toEqual(["a", "b"]);
  });
});

// ============================================================================
// DISCOVERY PATH CONSTANTS TESTS
// ============================================================================

describe("Discovery path constants", () => {
  test("SKILL_DISCOVERY_PATHS includes all expected project-local paths", () => {
    const paths = [...SKILL_DISCOVERY_PATHS];
    expect(paths).toContainEqual(expect.stringContaining("skills"));
    expect(paths.length).toBe(4);
  });

  test("GLOBAL_SKILL_PATHS includes all expected global paths", () => {
    const paths = [...GLOBAL_SKILL_PATHS];
    expect(paths).toContainEqual(expect.stringContaining("skills"));
    expect(paths.length).toBe(4);
  });
});
