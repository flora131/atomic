/**
 * Agent Discovery Service
 *
 * Canonical implementation of agent discovery, extracted from the command
 * layer to break the circular dependency where `services/workflows/`
 * imported `discoverAgentInfos` from `commands/tui/agent-commands.ts`.
 *
 * Both `commands/tui/` and `services/workflows/` now import from this module.
 *
 * NOTE: This module imports validation utilities from
 * `@/commands/tui/definition-integrity.ts`. That module itself only depends
 * on the service layer, so this is a narrow, acyclic cross-layer reference
 * that can be resolved by relocating definition-integrity to services in
 * a future refactor.
 */

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
  discoverAgentFilesWithOptions,
  getRuntimeCompatibleAgentDiscoveryPaths,
} from "@/commands/catalog/agents/discovery-paths.ts";
import type {
  AgentDefinitionIntegrityResult,
  AgentInfo,
  AgentParseResult,
  AgentSource,
  DiscoveredAgentFile,
} from "./types.ts";

export function warnSkippedAgentDefinition(
  filePath: string,
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
        path: resolve(filePath),
        rootId: providerMatch?.rootId,
        rootTier: providerMatch?.tier,
        rootCompatibility: providerMatch?.compatibility,
      },
      data: {
        kind: "agent",
        reason: options.reason,
        issueCount: issues.length,
        issues,
      },
    });
  }

  if (isDiscoveryDebugLoggingEnabled()) {
    console.warn(
      `[agent-discovery] Skipping agent definition at ${filePath}: ${issues.join(" ")}`,
    );
  }
}

function emitAgentCompatibilityFilteredEvent(
  filePath: string,
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
        path: resolve(filePath),
        rootId: pathContextMatch?.rootId,
        rootTier: pathContextMatch?.tier,
        rootCompatibility: pathContextMatch?.compatibility,
      },
      data: {
        kind: "agent",
        runtimeCompatibilitySelection:
          getRuntimeCompatibilitySelection(activePlan),
        providerMatchCount: providerMatches.length,
        filteredMatchCount: providerFilteredMatches.length,
      },
    });
  }
}

export function validateAgentInfoIntegrity(
  agent: AgentInfo,
  options: {
    discoveryPlans?: readonly ProviderDiscoveryPlan[];
  } = {},
): AgentDefinitionIntegrityResult {
  const issues: string[] = [];
  const plans = options.discoveryPlans ?? createAllProviderDiscoveryPlans();

  if (!agent.filePath.endsWith(".md")) {
    issues.push(
      `Agent file must be a markdown file ending in .md, received: ${agent.filePath}`,
    );
  }

  if (!isValidCommandIdentifier(agent.name)) {
    issues.push(
      `Invalid agent name "${agent.name}". Use ${getCommandIdentifierPatternDescription()}.`,
    );
  }

  if (agent.description.trim().length === 0) {
    issues.push(
      `Agent "${agent.name}" must include a non-empty description.`,
    );
  }

  const compatibilityValidation = validateDefinitionCompatibility(
    agent.filePath,
    "agent",
    plans,
  );
  issues.push(...compatibilityValidation.issues);

  return {
    valid: issues.length === 0,
    issues,
    discoveryMatches: compatibilityValidation.matches,
  };
}

function parseAgentInfoWithIssues(file: DiscoveredAgentFile): AgentParseResult {
  const issues: string[] = [];

  try {
    const content = readFileSync(file.path, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);

    if (content.trimStart().startsWith("---") && !parsed) {
      return {
        info: null,
        issues: [
          "Invalid markdown frontmatter block. Ensure the agent file uses a valid '---' header and closing delimiter.",
        ],
      };
    }

    const body = parsed ? parsed.body : content;
    if (body.trim().length === 0) {
      return {
        info: null,
        issues: [
          "Agent instructions are empty. Add prompt content below the frontmatter block.",
        ],
      };
    }

    const frontmatter = parsed?.frontmatter;
    let name = file.filename.trim();
    if (frontmatter && "name" in frontmatter) {
      if (
        typeof frontmatter.name !== "string" ||
        frontmatter.name.trim().length === 0
      ) {
        issues.push(
          "frontmatter.name must be a non-empty string when provided.",
        );
      } else {
        name = frontmatter.name.trim();
      }
    }

    if (name.length === 0) {
      issues.push(
        "Agent name resolved to an empty value. Provide frontmatter.name or a non-empty filename.",
      );
    }

    let description = `Agent: ${name}`;
    if (frontmatter && "description" in frontmatter) {
      if (
        typeof frontmatter.description !== "string" ||
        frontmatter.description.trim().length === 0
      ) {
        issues.push(
          "frontmatter.description must be a non-empty string when provided.",
        );
      } else {
        description = frontmatter.description.trim();
      }
    }

    if (issues.length > 0) {
      return {
        info: null,
        issues,
      };
    }

    return {
      info: {
        name,
        description,
        source: file.source,
        filePath: file.path,
      },
      issues: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      info: null,
      issues: [`Unable to read agent definition: ${message}`],
    };
  }
}

export function parseAgentInfoLight(
  file: DiscoveredAgentFile,
): AgentInfo | null {
  return parseAgentInfoWithIssues(file).info;
}

export function shouldAgentOverride(
  newSource: AgentSource,
  existingSource: AgentSource,
): boolean {
  const priority: Record<AgentSource, number> = {
    project: 2,
    user: 1,
  };

  return priority[newSource] > priority[existingSource];
}

export function discoverAgentInfos(
  options: {
    discoveryPlans?: readonly ProviderDiscoveryPlan[];
  } = {},
): AgentInfo[] {
  const allDiscoveryPlans = createAllProviderDiscoveryPlans(
    buildRuntimeDiscoveryPlanOptions(),
  );
  const activeDiscoveryPlans = options.discoveryPlans ?? allDiscoveryPlans;
  const activeRuntimeProviders = activeDiscoveryPlans
    .map((plan) => plan.provider)
    .join(", ");
  const discoverySearchPaths =
    getRuntimeCompatibleAgentDiscoveryPaths(activeDiscoveryPlans);
  const discoveredFiles = discoverAgentFilesWithOptions({
    searchPaths:
      discoverySearchPaths.length > 0 ? discoverySearchPaths : undefined,
  });
  const agentMap = new Map<string, AgentInfo>();

  for (const file of discoveredFiles) {
    const parsed = parseAgentInfoWithIssues(file);
    if (!parsed.info) {
      warnSkippedAgentDefinition(file.path, parsed.issues, {
        reason: "parse_failed",
        discoveryMatches: collectDefinitionDiscoveryMatches(
          file.path,
          "agent",
          allDiscoveryPlans,
        ),
        activeDiscoveryPlans,
      });
      continue;
    }

    const integrity = validateAgentInfoIntegrity(parsed.info, {
      discoveryPlans: allDiscoveryPlans,
    });
    if (!integrity.valid) {
      warnSkippedAgentDefinition(file.path, integrity.issues, {
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
      emitAgentCompatibilityFilteredEvent(
        file.path,
        integrity.discoveryMatches,
        runtimeCompatibleMatches,
        activeDiscoveryPlans,
      );
      warnSkippedAgentDefinition(
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

    const info = parsed.info;
    const existing = agentMap.get(info.name);
    if (existing) {
      if (shouldAgentOverride(info.source, existing.source)) {
        agentMap.set(info.name, info);
      }
    } else {
      agentMap.set(info.name, info);
    }
  }

  return Array.from(agentMap.values());
}

export function getDiscoveredAgent(name: string): AgentInfo | undefined {
  const agents = discoverAgentInfos();
  const lowerName = name.toLowerCase();
  return agents.find((agent) => agent.name.toLowerCase() === lowerName);
}
