import type { SkillInvokedEventData } from "@/services/agents/types.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function extractSkillName(input: Record<string, unknown>): string | undefined {
  const directName = asNonEmptyString(input.name)
    ?? asNonEmptyString(input.skill)
    ?? asNonEmptyString(input.skillName)
    ?? asNonEmptyString(input.skill_name)
    ?? asNonEmptyString(input.slug);
  if (directName) {
    return directName;
  }

  const nestedSkill = asRecord(input.skill);
  return nestedSkill
    ? asNonEmptyString(nestedSkill.name)
      ?? asNonEmptyString(nestedSkill.skill)
      ?? asNonEmptyString(nestedSkill.slug)
    : undefined;
}

function extractSkillPath(input: Record<string, unknown>): string | undefined {
  const directPath = asNonEmptyString(input.path)
    ?? asNonEmptyString(input.skillPath)
    ?? asNonEmptyString(input.skill_path)
    ?? asNonEmptyString(input.filePath)
    ?? asNonEmptyString(input.file_path);
  if (directPath) {
    return directPath;
  }

  const nestedSkill = asRecord(input.skill);
  return nestedSkill
    ? asNonEmptyString(nestedSkill.path)
      ?? asNonEmptyString(nestedSkill.filePath)
    : undefined;
}

export function isSkillToolName(toolName: unknown): boolean {
  return typeof toolName === "string" && toolName.trim().toLowerCase() === "skill";
}

export function extractSkillInvocationFromToolInput(
  toolInput: unknown,
): SkillInvokedEventData | null {
  const directSkillName = asNonEmptyString(toolInput);
  if (directSkillName) {
    return { skillName: directSkillName };
  }

  const input = asRecord(toolInput);
  if (!input) {
    return null;
  }

  const skillName = extractSkillName(input);
  if (!skillName) {
    return null;
  }

  const skillPath = extractSkillPath(input);
  return skillPath ? { skillName, skillPath } : { skillName };
}
