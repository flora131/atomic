import { test, expect } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const MAX_SKILL_DESCRIPTION_CHARS = 1024;

type SkillDescriptionViolation = {
  file: string;
  message: string;
};

function extractFrontMatter(content: string): string | null {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  return match?.[1] ?? null;
}

function extractDescription(frontMatter: string): string | null {
  for (const line of frontMatter.split("\n")) {
    const match = /^description:\s*(.*)$/.exec(line);
    if (!match) continue;

    const value = match[1]?.trim() ?? "";
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'");
    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');

    if (isSingleQuoted || isDoubleQuoted) {
      return value.slice(1, -1);
    }

    return value;
  }

  return null;
}

async function collectSkillDescriptionViolations(): Promise<SkillDescriptionViolation[]> {
  const violations: SkillDescriptionViolation[] = [];
  const glob = new Glob(".agents/skills/**/SKILL.md");

  for await (const relPath of glob.scan({ cwd: REPO_ROOT })) {
    const content = readFileSync(join(REPO_ROOT, relPath), "utf-8");
    const frontMatter = extractFrontMatter(content);

    if (!frontMatter) {
      violations.push({ file: relPath, message: "missing YAML front matter" });
      continue;
    }

    const description = extractDescription(frontMatter);

    if (description === null) {
      violations.push({ file: relPath, message: "missing description field" });
      continue;
    }

    if (description.length > MAX_SKILL_DESCRIPTION_CHARS) {
      violations.push({
        file: relPath,
        message: `description is ${description.length} characters (max ${MAX_SKILL_DESCRIPTION_CHARS})`,
      });
    }
  }

  return violations;
}

test("all skill descriptions are at most 1024 characters", async () => {
  const violations = await collectSkillDescriptionViolations();

  if (violations.length === 0) {
    expect(violations).toEqual([]);
    return;
  }

  const message = [
    `Found ${violations.length} invalid skill description(s).`,
    `Skill descriptions must be at most ${MAX_SKILL_DESCRIPTION_CHARS} characters.`,
    "",
    ...violations.map((violation) => `  ${violation.file}: ${violation.message}`),
  ].join("\n");

  expect(violations, message).toEqual([]);
});
