import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMarkdownFrontmatter } from "@/lib/markdown.ts";
import type { ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import {
  emitDiscoveryEvent,
  isDiscoveryDebugLoggingEnabled,
} from "@/services/config/discovery-events.ts";
import {
  collectDefinitionDiscoveryMatches,
  createAllProviderDiscoveryPlans,
  filterDefinitionMatchesByRuntimeCompatibility,
  getCommandIdentifierPatternDescription,
  getRuntimeCompatibilitySelection,
  isValidCommandIdentifier,
  validateDefinitionCompatibility,
  type DefinitionDiscoveryMatch,
} from "@/commands/tui/definition-integrity.ts";
import { buildRuntimeDiscoveryPlanOptions } from "@/commands/catalog/shared/discovery-paths.ts";
import {
  type DiskSkillDefinition,
  type DiscoveredSkillFile,
  type SkillDefinitionIntegrityResult,
  type SkillFileParseResult,
} from "./types.ts";
import {
  discoverSkillFiles,
  getRuntimeCompatibleSkillDiscoveryPaths,
  shouldSkillOverride,
} from "./discovery-paths.ts";

export function warnSkippedSkillDefinition(
  skillFilePath: string,
  issues: readonly string[],
  options: {
    discoveryMatches?: readonly DefinitionDiscoveryMatch[];
    activeDiscoveryPlans?: readonly ProviderDiscoveryPlan[];
    reason: string;
  },
): void {
  if (issues.length === 0) {
    return;
  }

  const providerTags = new Set(
    (options.activeDiscoveryPlans ?? []).map((plan) => plan.provider),
  );

  if (providerTags.size === 0) {
    for (const match of options.discoveryMatches ?? []) {
      providerTags.add(match.provider);
    }
  }

  for (const provider of providerTags) {
    const providerMatch = options.discoveryMatches?.find(
      (match) => match.provider === provider,
    );
    emitDiscoveryEvent("discovery.definition.skipped", {
      level: "warn",
      tags: {
        provider,
        path: resolve(skillFilePath),
        rootId: providerMatch?.rootId,
        rootTier: providerMatch?.tier,
        rootCompatibility: providerMatch?.compatibility,
      },
      data: {
        kind: "skill",
        reason: options.reason,
        issueCount: issues.length,
        issues,
      },
    });
  }

  if (isDiscoveryDebugLoggingEnabled()) {
    console.warn(
      `[skill-commands] Skipping skill definition at ${skillFilePath}: ${issues.join(
        " ",
      )}`,
    );
  }
}

function emitSkillCompatibilityFilteredEvent(
  skillFilePath: string,
  discoveryMatches: readonly DefinitionDiscoveryMatch[],
  runtimeCompatibleMatches: readonly DefinitionDiscoveryMatch[],
  activeDiscoveryPlans: readonly ProviderDiscoveryPlan[],
): void {
  const runtimeCompatibleMatchKeys = new Set(
    runtimeCompatibleMatches.map(
      (match) => `${match.provider}:${match.rootId}:${match.rootPath}`,
    ),
  );

  for (const activePlan of activeDiscoveryPlans) {
    const providerMatches = discoveryMatches.filter(
      (match) => match.provider === activePlan.provider,
    );
    const providerFilteredMatches = providerMatches.filter(
      (match) =>
        !runtimeCompatibleMatchKeys.has(
          `${match.provider}:${match.rootId}:${match.rootPath}`,
        ),
    );
    const pathContextMatch =
      providerFilteredMatches[0] ?? providerMatches[0];

    emitDiscoveryEvent("discovery.compatibility.filtered", {
      level: "warn",
      tags: {
        provider: activePlan.provider,
        path: resolve(skillFilePath),
        rootId: pathContextMatch?.rootId,
        rootTier: pathContextMatch?.tier,
        rootCompatibility: pathContextMatch?.compatibility,
      },
      data: {
        kind: "skill",
        runtimeCompatibilitySelection:
          getRuntimeCompatibilitySelection(activePlan),
        providerMatchCount: providerMatches.length,
        filteredMatchCount: providerFilteredMatches.length,
      },
    });
  }
}

export function validateDiskSkillDefinitionIntegrity(
  skill: DiskSkillDefinition,
  options: {
    discoveryPlans?: readonly ProviderDiscoveryPlan[];
  } = {},
): SkillDefinitionIntegrityResult {
  const issues: string[] = [];
  const plans = options.discoveryPlans ?? createAllProviderDiscoveryPlans();

  if (!skill.skillFilePath.endsWith("SKILL.md")) {
    issues.push(
      `Skill file must point to SKILL.md, received: ${skill.skillFilePath}`,
    );
  }

  if (!isValidCommandIdentifier(skill.name)) {
    issues.push(
      `Invalid skill name "${skill.name}". Use ${getCommandIdentifierPatternDescription()}.`,
    );
  }

  if (skill.description.trim().length === 0) {
    issues.push(
      `Skill "${skill.name}" must include a non-empty description.`,
    );
  }

  if (skill.aliases) {
    const seenAliases = new Set<string>();
    for (const alias of skill.aliases) {
      if (!isValidCommandIdentifier(alias)) {
        issues.push(
          `Invalid alias "${alias}" for skill "${skill.name}". Use ${getCommandIdentifierPatternDescription()}.`,
        );
        continue;
      }

      const normalizedAlias = alias.toLowerCase();
      if (normalizedAlias === skill.name.toLowerCase()) {
        issues.push(
          `Alias "${alias}" duplicates the skill name "${skill.name}".`,
        );
        continue;
      }

      if (seenAliases.has(normalizedAlias)) {
        issues.push(
          `Alias "${alias}" is duplicated in skill "${skill.name}".`,
        );
        continue;
      }

      seenAliases.add(normalizedAlias);
    }
  }

  if (
    skill.argumentHint !== undefined &&
    skill.argumentHint.trim().length === 0
  ) {
    issues.push(`Skill "${skill.name}" has an empty argument-hint value.`);
  }

  if (skill.requiredArguments) {
    for (const requiredArgument of skill.requiredArguments) {
      if (requiredArgument.trim().length === 0) {
        issues.push(
          `Skill "${skill.name}" includes an empty required-arguments entry.`,
        );
        continue;
      }

      if (/\s/.test(requiredArgument)) {
        issues.push(
          `Required argument "${requiredArgument}" for skill "${skill.name}" must not contain spaces.`,
        );
      }
    }
  }

  const compatibilityValidation = validateDefinitionCompatibility(
    skill.skillFilePath,
    "skill",
    plans,
  );
  issues.push(...compatibilityValidation.issues);

  return {
    valid: issues.length === 0,
    issues,
    discoveryMatches: compatibilityValidation.matches,
  };
}

function parseSkillFile(file: DiscoveredSkillFile): SkillFileParseResult {
  const issues: string[] = [];

  try {
    const content = readFileSync(file.path, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);

    if (content.trimStart().startsWith("---") && !parsed) {
      return {
        skill: null,
        issues: [
          "Invalid markdown frontmatter block. Ensure SKILL.md starts with a valid '---' header and closing delimiter.",
        ],
      };
    }

    const body = parsed ? parsed.body : content;
    if (body.trim().length === 0) {
      return {
        skill: null,
        issues: [
          "Skill instructions are empty. Add instructions below the frontmatter block.",
        ],
      };
    }

    if (!parsed) {
      const fallbackName = file.dirName.trim();
      if (fallbackName.length === 0) {
        return {
          skill: null,
          issues: [
            "Skill directory name is empty. Rename the skill directory to a valid command identifier.",
          ],
        };
      }

      return {
        skill: {
          name: fallbackName,
          description: `Skill: ${fallbackName}`,
          skillFilePath: file.path,
          source: file.source,
        },
        issues: [],
      };
    }

    const fm = parsed.frontmatter;
    let name = file.dirName.trim();

    if ("name" in fm) {
      if (typeof fm.name !== "string" || fm.name.trim().length === 0) {
        issues.push(
          "frontmatter.name must be a non-empty string when provided.",
        );
      } else {
        name = fm.name.trim();
      }
    }

    if (name.length === 0) {
      issues.push(
        "Skill name resolved to an empty value. Provide frontmatter.name or a non-empty skill directory name.",
      );
    }

    let description = `Skill: ${name}`;
    if ("description" in fm) {
      if (
        typeof fm.description !== "string" ||
        fm.description.trim().length === 0
      ) {
        issues.push(
          "frontmatter.description must be a non-empty string when provided.",
        );
      } else {
        description = fm.description.trim();
      }
    }

    let aliases: string[] | undefined;
    if ("aliases" in fm) {
      if (!Array.isArray(fm.aliases)) {
        issues.push("frontmatter.aliases must be an array of strings.");
      } else {
        const normalizedAliases = fm.aliases.map((alias) =>
          typeof alias === "string" ? alias.trim() : "",
        );
        if (normalizedAliases.some((alias) => alias.length === 0)) {
          issues.push(
            "frontmatter.aliases must contain non-empty string values only.",
          );
        } else {
          aliases = normalizedAliases;
        }
      }
    }

    let argumentHint: string | undefined;
    if ("argument-hint" in fm) {
      if (
        typeof fm["argument-hint"] !== "string" ||
        fm["argument-hint"].trim().length === 0
      ) {
        issues.push(
          "frontmatter.argument-hint must be a non-empty string when provided.",
        );
      } else {
        argumentHint = fm["argument-hint"].trim();
      }
    }

    let requiredArguments: string[] | undefined;
    if ("required-arguments" in fm) {
      if (!Array.isArray(fm["required-arguments"])) {
        issues.push(
          "frontmatter.required-arguments must be an array of strings.",
        );
      } else {
        const normalizedRequiredArgs = fm["required-arguments"].map(
          (argument) =>
            typeof argument === "string" ? argument.trim() : "",
        );
        if (
          normalizedRequiredArgs.some(
            (argument) => argument.length === 0,
          )
        ) {
          issues.push(
            "frontmatter.required-arguments must contain non-empty string values only.",
          );
        } else {
          requiredArguments = normalizedRequiredArgs;
        }
      }
    }

    if (issues.length > 0) {
      return {
        skill: null,
        issues,
      };
    }

    return {
      skill: {
        name,
        description,
        skillFilePath: file.path,
        source: file.source,
        aliases,
        argumentHint,
        requiredArguments,
      },
      issues: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      skill: null,
      issues: [`Unable to read skill file: ${message}`],
    };
  }
}

export async function discoverDiskSkills(
  providerDiscoveryPlan?: ProviderDiscoveryPlan,
): Promise<Map<string, DiskSkillDefinition>> {
  const allDiscoveryPlans = createAllProviderDiscoveryPlans(
    buildRuntimeDiscoveryPlanOptions(),
  );
  const activeDiscoveryPlans = providerDiscoveryPlan
    ? [providerDiscoveryPlan]
    : allDiscoveryPlans;
  const discoverySearchPaths =
    getRuntimeCompatibleSkillDiscoveryPaths(activeDiscoveryPlans);
  const files = discoverSkillFiles({
    searchPaths:
      discoverySearchPaths.length > 0 ? discoverySearchPaths : undefined,
  });
  const activeRuntimeProviders = activeDiscoveryPlans
    .map((plan) => plan.provider)
    .join(", ");

  const resolved = new Map<string, DiskSkillDefinition>();
  for (const file of files) {
    const parsed = parseSkillFile(file);
    if (!parsed.skill) {
      warnSkippedSkillDefinition(file.path, parsed.issues, {
        reason: "parse_failed",
        discoveryMatches: collectDefinitionDiscoveryMatches(
          file.path,
          "skill",
          allDiscoveryPlans,
        ),
        activeDiscoveryPlans,
      });
      continue;
    }

    const integrity = validateDiskSkillDefinitionIntegrity(parsed.skill, {
      discoveryPlans: allDiscoveryPlans,
    });
    if (!integrity.valid) {
      warnSkippedSkillDefinition(file.path, integrity.issues, {
        reason: "integrity_validation_failed",
        discoveryMatches: integrity.discoveryMatches,
        activeDiscoveryPlans,
      });
      continue;
    }

    const runtimeCompatibleMatches =
      filterDefinitionMatchesByRuntimeCompatibility(
        integrity.discoveryMatches,
        activeDiscoveryPlans,
      );
    if (runtimeCompatibleMatches.length === 0) {
      emitSkillCompatibilityFilteredEvent(
        file.path,
        integrity.discoveryMatches,
        runtimeCompatibleMatches,
        activeDiscoveryPlans,
      );
      warnSkippedSkillDefinition(
        file.path,
        [
          `Definition is not compatible with active provider runtime(s): ${activeRuntimeProviders}.`,
        ],
        {
          reason: "runtime_incompatible",
          discoveryMatches: integrity.discoveryMatches,
          activeDiscoveryPlans,
        },
      );
      continue;
    }

    const skill = parsed.skill;
    const existing = resolved.get(skill.name);
    if (!existing || shouldSkillOverride(skill.source, existing.source)) {
      resolved.set(skill.name, skill);
    }
  }

  return resolved;
}
