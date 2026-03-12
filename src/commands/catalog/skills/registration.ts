import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "@/commands/tui/registry.ts";
import { globalRegistry } from "@/commands/tui/registry.ts";
import type { ProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import {
  collectDefinitionDiscoveryMatches,
  createAllProviderDiscoveryPlans,
} from "@/commands/tui/definition-integrity.ts";
import { buildRuntimeDiscoveryPlanOptions } from "@/commands/catalog/shared/discovery-paths.ts";
import { buildSkillInvocationMessage, type DiskSkillDefinition } from "./types.ts";
import {
  discoverDiskSkills,
  warnSkippedSkillDefinition,
} from "./discovery.ts";

function dispatchNativeSkillInvocation(
  skillName: string,
  skillArgs: string,
  context: CommandContext,
): CommandResult {
  context.sendSilentMessage(
    buildSkillInvocationMessage(skillName, skillArgs),
    { skillCommand: { name: skillName, args: skillArgs } },
  );
  return { success: true, skillLoaded: skillName };
}

function createDiskSkillCommand(skill: DiskSkillDefinition): CommandDefinition {
  return {
    name: skill.name,
    description: skill.description,
    category: "skill",
    aliases: skill.aliases,
    argumentHint: skill.argumentHint,
    execute: (args: string, context: CommandContext): CommandResult => {
      const skillArgs = args.trim();

      if (skill.requiredArguments?.length && !skillArgs) {
        const argList = skill.requiredArguments
          .map((a) => `<${a}>`)
          .join(" ");
        return {
          success: false,
          message: `Missing required argument.\nUsage: /${skill.name} ${argList}`,
        };
      }

      return dispatchNativeSkillInvocation(
        skill.name,
        skillArgs,
        context,
      );
    },
  };
}

export async function discoverAndRegisterDiskSkills(
  providerDiscoveryPlan?: ProviderDiscoveryPlan,
): Promise<void> {
  const allDiscoveryPlans = createAllProviderDiscoveryPlans(
    buildRuntimeDiscoveryPlanOptions(),
  );
  const activeDiscoveryPlans = providerDiscoveryPlan
    ? [providerDiscoveryPlan]
    : allDiscoveryPlans;
  const resolved = await discoverDiskSkills(providerDiscoveryPlan);

  for (const skill of resolved.values()) {
    const command = createDiskSkillCommand(skill);
    if (globalRegistry.has(skill.name)) {
      const existingCmd = globalRegistry.get(skill.name);
      if (existingCmd) {
        globalRegistry.unregister(skill.name);
        try {
          globalRegistry.register(command);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          warnSkippedSkillDefinition(
            skill.skillFilePath,
            [`Command registration failed: ${message}`],
            {
              reason: "command_registration_failed",
              discoveryMatches: collectDefinitionDiscoveryMatches(
                skill.skillFilePath,
                "skill",
                allDiscoveryPlans,
              ),
              activeDiscoveryPlans,
            },
          );
          try {
            globalRegistry.register(existingCmd);
          } catch {
            // Best effort recovery only.
          }
        }
      }
    } else {
      try {
        globalRegistry.register(command);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        warnSkippedSkillDefinition(
          skill.skillFilePath,
          [`Command registration failed: ${message}`],
          {
            reason: "command_registration_failed",
            discoveryMatches: collectDefinitionDiscoveryMatches(
              skill.skillFilePath,
              "skill",
              allDiscoveryPlans,
            ),
            activeDiscoveryPlans,
          },
        );
      }
    }
  }
}
