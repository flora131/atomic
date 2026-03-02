import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = process.cwd();

const MIGRATION_TARGET_FILES = [
  ".claude/agents/codebase-online-researcher.md",
  ".claude/agents/debugger.md",
  ".claude/agents/reviewer.md",
  ".github/agents/codebase-online-researcher.md",
  ".github/agents/debugger.md",
  ".opencode/agents/codebase-online-researcher.md",
  ".opencode/agents/debugger.md",
  ".claude/skills/research-codebase/SKILL.md",
  ".claude/skills/explain-code/SKILL.md",
  ".github/skills/research-codebase/SKILL.md",
  ".github/skills/explain-code/SKILL.md",
  ".opencode/skills/research-codebase/SKILL.md",
  ".opencode/skills/explain-code/SKILL.md",
  "src/sdk/clients/claude.ts",
  ".opencode/opencode.json",
] as const;

const LEGACY_WEB_TOKENS = ["WebFetch", "WebSearch", "webfetch"] as const;

const GITHUB_AGENT_FILES = [
  ".github/agents/codebase-online-researcher.md",
  ".github/agents/debugger.md",
] as const;

const EXPLAIN_SKILL_FILES = [
  ".claude/skills/explain-code/SKILL.md",
  ".github/skills/explain-code/SKILL.md",
  ".opencode/skills/explain-code/SKILL.md",
] as const;

const RESEARCH_SKILL_FILES = [
  ".claude/skills/research-codebase/SKILL.md",
  ".github/skills/research-codebase/SKILL.md",
  ".opencode/skills/research-codebase/SKILL.md",
] as const;

const PLAYWRIGHT_SKILL_FILES = [
  ".claude/skills/playwright-cli/SKILL.md",
  ".github/skills/playwright-cli/SKILL.md",
  ".opencode/skills/playwright-cli/SKILL.md",
] as const;

function readProjectFile(relativePath: string): string {
  return readFileSync(join(PROJECT_ROOT, relativePath), "utf-8");
}

describe("Playwright web-tool migration verification", () => {
  test("tracks exactly 15 migration target files", () => {
    expect(MIGRATION_TARGET_FILES).toHaveLength(15);

    for (const relativePath of MIGRATION_TARGET_FILES) {
      expect(readProjectFile(relativePath).length).toBeGreaterThan(0);
    }
  });

  test("removes legacy web-tool references from all migration target files", () => {
    for (const relativePath of MIGRATION_TARGET_FILES) {
      const content = readProjectFile(relativePath);

      for (const token of LEGACY_WEB_TOKENS) {
        expect(content.includes(token)).toBe(false);
      }
    }

    for (const relativePath of GITHUB_AGENT_FILES) {
      const content = readProjectFile(relativePath);
      expect(content.includes('"web"')).toBe(false);
    }
  });

  test("keeps playwright-cli guidance in migrated agent and skill files", () => {
    expect(readProjectFile(".opencode/agents/codebase-online-researcher.md")).toContain(
      "Playwright CLI"
    );
    expect(readProjectFile(".opencode/agents/debugger.md")).toContain("Playwright CLI");

    for (const relativePath of EXPLAIN_SKILL_FILES) {
      const content = readProjectFile(relativePath);
      expect(content).toContain("`playwright-cli`");
    }

    for (const relativePath of RESEARCH_SKILL_FILES) {
      const content = readProjectFile(relativePath);
      expect(content).toContain("playwright-cli");
    }
  });
});

describe("Skill file parity", () => {
  test("keeps explain-code SKILL.md identical across SDK directories", () => {
    const canonical = readProjectFile(EXPLAIN_SKILL_FILES[0]);

    for (const relativePath of EXPLAIN_SKILL_FILES.slice(1)) {
      expect(readProjectFile(relativePath)).toBe(canonical);
    }
  });

  test("keeps research-codebase SKILL.md identical across SDK directories", () => {
    const canonical = readProjectFile(RESEARCH_SKILL_FILES[0]);

    for (const relativePath of RESEARCH_SKILL_FILES.slice(1)) {
      expect(readProjectFile(relativePath)).toBe(canonical);
    }
  });

  test("keeps playwright-cli SKILL.md identical across SDK directories", () => {
    const canonical = readProjectFile(PLAYWRIGHT_SKILL_FILES[0]);

    for (const relativePath of PLAYWRIGHT_SKILL_FILES.slice(1)) {
      expect(readProjectFile(relativePath)).toBe(canonical);
    }
  });
});
