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
import {
  discoverAgentInfos,
  warnSkippedAgentDefinition,
} from "./discovery.ts";
import type { AgentInfo } from "./types.ts";

export function createAgentCommand(agent: AgentInfo): CommandDefinition {
  return {
    name: agent.name,
    description: agent.description,
    category: "agent",
    hidden: false,
    argumentHint: "[task]",
    execute: (args: string, context: CommandContext): CommandResult => {
      const task =
        args.trim() || "Please proceed according to your instructions.";

      if (context.agentType === "opencode") {
        context.sendSilentMessage(task, { agent: agent.name });
      } else if (context.agentType === "claude") {
        const instruction = `Use the ${agent.name} sub-agent to complete the following task: ${task}\n\nAfter the sub-agent completes, provide the output to the user.`;
        context.sendSilentMessage(instruction);
      } else {
        const instruction = `Use the ${agent.name} sub-agent to complete the following task: ${task}\n\nAfter the sub-agent completes, provide the output to the user.`;
        context.sendSilentMessage(instruction);
      }

      return { success: true };
    },
  };
}

export async function registerAgentCommands(
  providerDiscoveryPlan?: ProviderDiscoveryPlan,
): Promise<void> {
  const activeDiscoveryPlans = providerDiscoveryPlan
    ? [providerDiscoveryPlan]
    : createAllProviderDiscoveryPlans();
  const agents = discoverAgentInfos({
    discoveryPlans: activeDiscoveryPlans,
  });

  for (const agent of agents) {
    let existingAgentCommand: CommandDefinition | undefined;

    if (globalRegistry.has(agent.name)) {
      const existing = globalRegistry.get(agent.name);
      if (existing?.category === "agent") {
        existingAgentCommand = existing;
        globalRegistry.unregister(agent.name);
      } else {
        continue;
      }
    }

    const command = createAgentCommand(agent);
    try {
      globalRegistry.register(command);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      warnSkippedAgentDefinition(
        agent.filePath,
        [`Command registration failed: ${message}`],
        {
          reason: "command_registration_failed",
          discoveryMatches: collectDefinitionDiscoveryMatches(
            agent.filePath,
            "agent",
            activeDiscoveryPlans,
          ),
          activeDiscoveryPlans,
        },
      );
      if (existingAgentCommand) {
        try {
          globalRegistry.register(existingAgentCommand);
        } catch {
          // Best effort recovery only.
        }
      }
    }
  }
}
