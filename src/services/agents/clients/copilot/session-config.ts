import type {
  SessionConfig as SdkSessionConfig,
  Tool as SdkTool,
} from "@github/copilot-sdk";

import {
  loadCopilotAgents,
  loadCopilotInstructions,
  resolveCopilotDiscoveryPlan,
  resolveCopilotSkillDirectories,
} from "@/services/config/copilot-config.ts";
import {
  BACKGROUND_COMPACTION_THRESHOLD,
  BUFFER_EXHAUSTION_THRESHOLD,
} from "@/services/workflows/graph/types.ts";
import { pathExists } from "@/services/agents/clients/copilot/cli-path.ts";
import type {
  SessionConfig,
  ToolContext,
  ToolDefinition,
} from "@/services/agents/types.ts";

import type { CopilotSessionArtifacts } from "@/services/agents/clients/copilot/types.ts";

export async function loadCopilotSessionArtifacts(
  projectRoot: string,
  options: {
    xdgConfigHome?: string;
    setKnownAgentNames: (names: string[]) => void;
  },
): Promise<CopilotSessionArtifacts> {
  const discoveryPlan = await resolveCopilotDiscoveryPlan(projectRoot, {
    pathExistsFn: pathExists,
    xdgConfigHome: options.xdgConfigHome,
  });
  const [loadedAgents, skillDirectories, instructions] = await Promise.all([
    loadCopilotAgents(projectRoot, undefined, {
      providerDiscoveryPlan: discoveryPlan,
    }),
    resolveCopilotSkillDirectories(projectRoot, {
      providerDiscoveryPlan: discoveryPlan,
      pathExistsFn: pathExists,
    }),
    loadCopilotInstructions(projectRoot, undefined, {
      providerDiscoveryPlan: discoveryPlan,
    }),
  ]);

  options.setKnownAgentNames([
    "general-purpose",
    ...loadedAgents.map((agent) => agent.name),
  ]);

  return {
    customAgents: loadedAgents.length > 0
      ? loadedAgents.map((agent) => ({
          name: agent.name,
          description: agent.description,
          tools: agent.tools ?? null,
          prompt: agent.systemPrompt,
        }))
      : undefined,
    skillDirectories: skillDirectories.length > 0 ? skillDirectories : undefined,
    instructions: instructions?.trim() || undefined,
  };
}

export function buildCopilotSystemMessage(
  config: SessionConfig,
  instructions?: string,
): SdkSessionConfig["systemMessage"] {
  const segments = [instructions?.trim(), config.additionalInstructions?.trim()].filter(
    (segment): segment is string => typeof segment === "string" && segment.length > 0,
  );

  if (segments.length === 0) {
    return undefined;
  }

  return {
    mode: "append",
    content: segments.join("\n\n"),
  };
}

export function buildCopilotSdkMcpServers(
  config: SessionConfig,
): SdkSessionConfig["mcpServers"] | undefined {
  if (!config.mcpServers) {
    return undefined;
  }

  return Object.fromEntries(
    config.mcpServers.map((server) => {
      if (server.url) {
        return [server.name, {
          type: (server.type === "sse" ? "sse" : "http") as "http" | "sse",
          url: server.url,
          headers: server.headers,
          tools: server.tools ?? ["*"],
          timeout: server.timeout,
        }];
      }

      return [server.name, {
        type: "stdio" as const,
        command: server.command ?? "",
        args: server.args ?? [],
        env: server.env,
        cwd: server.cwd,
        tools: server.tools ?? ["*"],
        timeout: server.timeout,
      }];
    }),
  );
}

export function convertCopilotTool(
  tool: ToolDefinition,
  options: {
    getActiveSessionId: () => string;
    cwd?: string;
  },
): SdkTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    handler: async (args) => {
      const context: ToolContext = {
        sessionID: options.getActiveSessionId(),
        messageID: "",
        agent: "copilot",
        directory: options.cwd ?? process.cwd(),
        abort: new AbortController().signal,
      };
      return tool.handler(args as Record<string, unknown>, context);
    },
  };
}

export function buildCopilotSdkSessionConfigBase(args: {
  config: SessionConfig;
  sessionIdForUserInput: string;
  model?: string;
  reasoningEffort?: SdkSessionConfig["reasoningEffort"];
  artifacts?: CopilotSessionArtifacts;
  tools: SdkTool[];
  availableTools?: string[];
  onPermissionRequest: SdkSessionConfig["onPermissionRequest"];
  onUserInputRequest: SdkSessionConfig["onUserInputRequest"];
}): Omit<SdkSessionConfig, "sessionId"> {
  return {
    ...(args.model ? { model: args.model } : {}),
    ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
    systemMessage: buildCopilotSystemMessage(
      args.config,
      args.artifacts?.instructions,
    ),
    availableTools: args.availableTools,
    streaming: true,
    tools: args.tools,
    onPermissionRequest: args.onPermissionRequest,
    onUserInputRequest: args.onUserInputRequest,
    skillDirectories: args.artifacts?.skillDirectories,
    customAgents: args.artifacts?.customAgents,
    infiniteSessions: {
      enabled: true,
      backgroundCompactionThreshold: BACKGROUND_COMPACTION_THRESHOLD,
      bufferExhaustionThreshold: BUFFER_EXHAUSTION_THRESHOLD,
    },
    mcpServers: buildCopilotSdkMcpServers(args.config),
  };
}
