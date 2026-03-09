#!/usr/bin/env bun
/**
 * Chat CLI command for atomic
 *
 * Provides a simple chat interface with SDK clients.
 *
 * Usage:
 *   atomic chat -a <agent>           Start chat with specified agent
 *   atomic chat --theme <name>       Use specified theme (dark/light)
 *
 * Reference: Feature 30 - Chat interface with SDK clients
 */

import type { AgentType } from "@/services/telemetry/types.ts";
import type { CodingAgentClient } from "@/services/agents/types.ts";
import type { ChatUIConfig, Theme } from "@/app.tsx";
import type {
  ProviderDiscoveryPlan,
  ProviderDiscoveryPlanOptions,
} from "@/services/config/provider-discovery-plan.ts";
import { getModelPreference, getReasoningEffortPreference } from "@/services/config/settings.ts";
import { ENHANCED_SYSTEM_PROMPT } from "@/services/agents/enhanced-system-prompt.ts";
import { AGENT_CONFIG, type SourceControlType } from "@/services/config/index.ts";
// initCommand is lazy-loaded only when auto-init is needed
import { join } from "path";
import {
  ensureAtomicGlobalAgentConfigsForInstallType,
} from "@/services/config/atomic-global-config.ts";
import {
  clearProviderDiscoverySessionCache,
  startProviderDiscoverySessionCache,
} from "@/services/config/provider-discovery-cache.ts";
import { emitDiscoveryEvent } from "@/services/config/discovery-events.ts";
import { detectInstallationType, getConfigRoot } from "@/services/config/config-path.ts";
import { getSelectedScm } from "@/services/config/atomic-config.ts";
import { VERSION } from "@/version.ts";
import {
  createClientForAgentType,
  getAgentDisplayName,
  getTheme,
} from "./client.ts";
import {
  buildChatStartupDiscoveryPlan,
  buildProviderDiscoveryPlanDebugOutput,
  logActiveProviderDiscoveryPlan,
  type ProviderDiscoveryPlanDebugOutput,
} from "./discovery-debug.ts";
import {
  hasProjectScmSkills,
  hasProjectScmSkillsInSync,
  shouldAutoInitChat,
} from "./auto-init.ts";
import {
  handleThemeCommand,
  isSlashCommand,
  parseSlashCommand,
} from "./slash-commands.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the chat command.
 */
export interface ChatCommandOptions {
  /** Agent type to use (claude, opencode, copilot) */
  agentType?: AgentType;
  /** Theme to use (dark/light) */
  theme?: "dark" | "light";
  /** Session configuration options */
  model?: string;
  /** Enable graph workflow mode */
  workflow?: boolean;
  /** Initial prompt to send on session start */
  initialPrompt?: string;
  /** Extra instructions appended to the enhanced system prompt for the session */
  additionalInstructions?: string;
}

export {
  buildChatStartupDiscoveryPlan,
  buildProviderDiscoveryPlanDebugOutput,
  logActiveProviderDiscoveryPlan,
} from "./discovery-debug.ts";
export {
  hasProjectScmSkills,
  hasProjectScmSkillsInSync,
  shouldAutoInitChat,
} from "./auto-init.ts";

export function resolveChatAdditionalInstructions(
  options: Pick<ChatCommandOptions, "additionalInstructions">
): string {
  const trimmedAdditionalInstructions = options.additionalInstructions?.trim();
  if (!trimmedAdditionalInstructions) {
    return ENHANCED_SYSTEM_PROMPT;
  }

  return `${ENHANCED_SYSTEM_PROMPT}\n\n${trimmedAdditionalInstructions}`;
}

// ============================================================================
// Chat Command Implementation
// ============================================================================

/**
 * Start the chat interface with the specified options.
 *
 * @param options - Chat command configuration options
 * @returns Exit code (0 for success)
 */
export async function chatCommand(options: ChatCommandOptions = {}): Promise<number> {
  const {
    agentType,
    theme = "dark",
    model,
    workflow = false,
    initialPrompt,
    additionalInstructions,
  } = options;

  if (!agentType) {
    throw new Error("agentType is required. Start chat with `atomic chat -a <agent>`.");
  }

  // Read settings asynchronously in parallel
  const [resolvedModel, effectiveReasoningEffort] = await Promise.all([
    getModelPreference(agentType),
    getReasoningEffortPreference(agentType),
  ]);
  const effectiveModel = model ?? resolvedModel;

  const agentName = getAgentDisplayName(agentType);
  const projectRoot = process.cwd();
  const providerDiscoveryPlan = buildChatStartupDiscoveryPlan(agentType, {
    projectRoot,
    homeDir: process.env.HOME,
    xdgConfigHome: process.env.XDG_CONFIG_HOME,
  });
  startProviderDiscoverySessionCache({
    projectRoot,
    startupPlan: providerDiscoveryPlan,
  });
  const configRoot = getConfigRoot();
  const installType = detectInstallationType();
  const highestPrecedenceRoot =
    providerDiscoveryPlan.rootsInPrecedenceOrder[
      providerDiscoveryPlan.rootsInPrecedenceOrder.length - 1
    ];
  emitDiscoveryEvent("discovery.plan.generated", {
    tags: {
      provider: providerDiscoveryPlan.provider,
      installType,
      path: highestPrecedenceRoot?.resolvedPath ?? projectRoot,
      rootId: highestPrecedenceRoot?.id,
      rootTier: highestPrecedenceRoot?.tier,
      rootCompatibility: highestPrecedenceRoot?.compatibility,
    },
    data: {
      runtimeMode: providerDiscoveryPlan.runtime.mode,
      rootCount: providerDiscoveryPlan.rootsInPrecedenceOrder.length,
      existingRootCount: providerDiscoveryPlan.existingRoots.length,
      projectRoot,
    },
  });
  logActiveProviderDiscoveryPlan(providerDiscoveryPlan, { projectRoot });
  const selectedScm = await getSelectedScm(projectRoot);
  const resolvedAdditionalInstructions = resolveChatAdditionalInstructions({ additionalInstructions });

  const ensureGlobalConfigsPromise = ensureAtomicGlobalAgentConfigsForInstallType(
    installType,
    configRoot,
  );
  await ensureGlobalConfigsPromise;

  // Auto-init when project SCM skills are missing or out of sync
  if (await shouldAutoInitChat(agentType, projectRoot, { selectedScm, configRoot })) {
    const configNotFoundMessage =
      `Source control skills are missing or out of sync for ${agentName}. Starting setup...`;

    const { initCommand } = await import("@/commands/cli/init.ts");
    await initCommand({
      showBanner: false,
      preSelectedAgent: agentType,
      preSelectedScm: selectedScm ?? undefined,
      configNotFoundMessage,
    });
  }

  console.log(`Starting ${agentName} chat interface...`);
  console.log("");

  // Lazy-load SDK tools and create client
  const [{ createTodoWriteTool }, { registerCustomTools }] = await Promise.all([
    import("@/services/agents/tools/todo-write.ts"),
    import("@/services/agents/tools/index.ts"),
  ]);

  const client = await createClientForAgentType(agentType);

  // Register TodoWrite tool for agents that don't have it built-in
  if (agentType === "copilot") {
    client.registerTool(createTodoWriteTool());
  }

  // Discover and register custom tools before starting the client
  await registerCustomTools(client);

  try {
    // Start client and discover MCP configs in parallel
    const [{ discoverMcpConfigs }, { trackAtomicCommand }, { startChatUI }] = await Promise.all([
      import("@/services/config/mcp-config.ts"),
      import("@/services/telemetry/index.ts"),
      import("@/app.tsx"),
    ]);

    // Start client and run MCP discovery concurrently
    const clientStartPromise = client.start();
    const mcpDiscoveryPromise = discoverMcpConfigs();

    await clientStartPromise;

    const [modelDisplayInfo, mcpServers] = await Promise.all([
      client.getModelDisplayInfo(effectiveModel),
      mcpDiscoveryPromise,
    ]);

    // For Copilot, show explicit reasoning effort when available:
    // user preference first, otherwise SDK-reported model default.
    const resolvedReasoningEffort =
      agentType === "copilot"
        ? (
            modelDisplayInfo.supportsReasoning
              ? (effectiveReasoningEffort ?? modelDisplayInfo.defaultReasoningEffort)
              : undefined
          )
        : effectiveReasoningEffort;

    // For copilot, append reasoning effort to model display if the model supports it
    let displayModelName = modelDisplayInfo.model;
    if (agentType === "copilot" && resolvedReasoningEffort && modelDisplayInfo.supportsReasoning) {
      displayModelName += ` (${resolvedReasoningEffort})`;
    }

    // Build chat UI configuration
    const chatConfig: ChatUIConfig = {
      sessionConfig: {
        model: effectiveModel,
        reasoningEffort: resolvedReasoningEffort,
        mcpServers,
        additionalInstructions: resolvedAdditionalInstructions,
      },
      theme: await getTheme(theme),
      title: `Chat - ${agentName}`,
      placeholder: "Type a message...",
      version: VERSION,
      model: displayModelName,
      tier: modelDisplayInfo.tier,
      workingDir: projectRoot,
      suggestion: 'Try "fix typecheck errors"',
      agentType,
      initialPrompt,
      workflowEnabled: workflow,
      clientStartPromise,
      providerDiscoveryPlan,
    };

    // Start standard chat
    const result = await startChatUI(client, chatConfig);
    console.log(`\nChat ended. ${result.messageCount} messages exchanged.`);
    trackAtomicCommand("chat", agentType, true);
    return 0;
  } catch (error) {
    const { trackAtomicCommand } = await import("@/services/telemetry/index.ts");
    trackAtomicCommand("chat", agentType, false);
    const message = error instanceof Error ? error.message : String(error);
    emitDiscoveryEvent("discovery.runtime.startup_error", {
      level: "error",
      tags: {
        provider: providerDiscoveryPlan.provider,
        installType,
        path: projectRoot,
      },
      data: {
        stage: "chatCommand",
        reason: "chat_startup_failed",
        message,
      },
    });
    console.error("Chat error:", error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await client.stop();
    clearProviderDiscoverySessionCache();
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  createClientForAgentType,
  getAgentDisplayName,
  getTheme,
  isSlashCommand,
  parseSlashCommand,
  handleThemeCommand,
};
