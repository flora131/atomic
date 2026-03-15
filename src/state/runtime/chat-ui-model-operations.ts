import { UnifiedModelOperations } from "@/services/models/model-operations.ts";
import type { AgentType } from "@/services/models/index.ts";
import type { CodingAgentClient, SessionConfig } from "@/services/agents/types.ts";

export function createChatUIModelOperations(
  client: CodingAgentClient,
  resolvedAgentType: AgentType | undefined,
  sessionConfig?: SessionConfig,
): UnifiedModelOperations | undefined {
  const sdkListModels = resolvedAgentType === "claude"
    && "listSupportedModels" in client
    ? () =>
        (client as import("@/services/agents/clients/index.ts").ClaudeAgentClient)
          .listSupportedModels()
    : undefined;
  const sdkListCopilotModels = resolvedAgentType === "copilot"
    && "listAvailableModels" in client
    ? () =>
        (client as import("@/services/agents/clients/index.ts").CopilotClient)
          .listAvailableModels()
    : undefined;
  const sdkListOpenCodeProviders = resolvedAgentType === "opencode"
    && "listProviderModels" in client
    ? () =>
        (client as import("@/services/agents/clients/index.ts").OpenCodeClient)
          .listProviderModels()
    : undefined;
  const sdkSetModel = resolvedAgentType === "opencode"
    && "setActivePromptModel" in client
    ? async (
        selectedModel: string,
        options?: { reasoningEffort?: string },
      ) => {
        await (
          client as import("@/services/agents/clients/index.ts").OpenCodeClient
        ).setActivePromptModel(selectedModel, options);
      }
    : resolvedAgentType && "setActiveSessionModel" in client
      ? async (
          selectedModel: string,
          options?: { reasoningEffort?: string },
        ) => {
          await client.setActiveSessionModel?.(selectedModel, options);
        }
      : undefined;

  return resolvedAgentType
    ? new UnifiedModelOperations(
        resolvedAgentType,
        sdkSetModel,
        sdkListModels,
        sessionConfig?.model,
        sdkListCopilotModels,
        sdkListOpenCodeProviders,
      )
    : undefined;
}
