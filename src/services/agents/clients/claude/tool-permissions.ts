import type { HookCallback, HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig } from "@/services/agents/types.ts";
import {
  isToolDisabledBySubagentPolicy,
  resolveSubagentToolPolicy,
} from "@/services/agents/subagent-tool-policy.ts";

function getConfiguredAgent(config: SessionConfig, input: HookInput) {
  const agentType = typeof input.agent_type === "string"
    ? input.agent_type.trim()
    : "";
  if (agentType.length === 0) {
    return null;
  }

  const agents = config.agents;
  if (!agents) {
    return null;
  }

  const direct = agents[agentType];
  if (direct) {
    return { name: agentType };
  }

  const matchedEntry = Object.entries(agents).find(
    ([name]) => name.trim().toLowerCase() === agentType.toLowerCase(),
  );
  if (!matchedEntry) {
    return null;
  }

  return {
    name: matchedEntry[0],
  };
}

export function isToolDisabledForAgent(config: SessionConfig, agentName: string, toolName: string): boolean {
  return isToolDisabledBySubagentPolicy(
    resolveSubagentToolPolicy(config.agents, agentName),
    toolName,
    { treatToolsAsAllowlist: true },
  );
}

export function createClaudeSubagentToolPermissionHook(config: SessionConfig): HookCallback {
  return async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PreToolUse") {
      return { continue: true };
    }

    if (typeof input.agent_id !== "string" || input.agent_id.trim().length === 0) {
      return { continue: true };
    }

    const matchedAgent = getConfiguredAgent(config, input);
    if (!matchedAgent) {
      return { continue: true };
    }

    if (!isToolDisabledForAgent(config, matchedAgent.name, input.tool_name)) {
      return { continue: true };
    }

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Tool ${input.tool_name} is disabled in the ${matchedAgent.name} sub-agent frontmatter.`,
      },
    };
  };
}
