import { homedir } from "node:os";
import { join } from "node:path";
import type { DefinitionDiscoveryMatch } from "@/commands/tui/definition-integrity.ts";

export function buildSkillInvocationMessage(skillName: string, args: string): string {
  const trimmedArgs = args.trim();
  return trimmedArgs.length > 0
    ? `/${skillName} ${trimmedArgs}`
    : `/${skillName}`;
}

export const HOME = homedir();

export const SKILL_DISCOVERY_PATHS = [
  join(".claude", "skills"),
  join(".opencode", "skills"),
  join(".github", "skills"),
] as const;

export type SkillSource = "project" | "user";

export interface DiscoveredSkillFile {
  path: string;
  dirName: string;
  source: SkillSource;
}

export interface DiskSkillDefinition {
  name: string;
  description: string;
  skillFilePath: string;
  source: SkillSource;
  aliases?: string[];
  argumentHint?: string;
  requiredArguments?: string[];
}

export interface BuiltinSkillDefinition {
  name: string;
  description: string;
  aliases?: string[];
  argumentHint?: string;
  requiredArguments?: string[];
}

export interface SkillFileParseResult {
  skill: DiskSkillDefinition | null;
  issues: readonly string[];
}

export interface SkillDefinitionIntegrityResult {
  valid: boolean;
  issues: readonly string[];
  discoveryMatches: readonly DefinitionDiscoveryMatch[];
}
