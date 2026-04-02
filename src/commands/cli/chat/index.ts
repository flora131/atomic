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
import type { ChatUIConfig } from "@/app.tsx";
import { getModelPreference, getReasoningEffortPreference } from "@/services/config/settings.ts";
import { ADDITIONAL_ENHANCED_INSTRUCTIONS } from "@/services/agents/additional-enhanced-instructions.ts";
// initCommand is lazy-loaded only when auto-init is needed
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
    return ADDITIONAL_ENHANCED_INSTRUCTIONS;
  }

  return `${ADDITIONAL_ENHANCED_INSTRUCTIONS}\n\n${trimmedAdditionalInstructions}`;
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
    initialPrompt,
    additionalInstructions,
  } = options;

  if (!agentType) {
    throw new Error("agentType is required. Start chat with `atomic chat -a <agent>`.");
  }

  // Kick off the heavy app.tsx import early — it takes ~90ms (OpenTUI dlopen,
  // React, yoga-layout WASM) and doesn't depend on any config/SDK work below.
  // We await the result only when startChatUI() is needed.
  const appModulePromise = import("@/app.tsx");

  const agentName = getAgentDisplayName(agentType);
  const projectRoot = process.cwd();
  const configRoot = getConfigRoot();
  const installType = detectInstallationType();

  const providerDiscoveryPlan = buildChatStartupDiscoveryPlan(agentType, {
    projectRoot,
    homeDir: process.env.HOME,
    xdgConfigHome: process.env.XDG_CONFIG_HOME,
  });
  startProviderDiscoverySessionCache({
    projectRoot,
    startupPlan: providerDiscoveryPlan,
  });
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

  // Run all async config reads and global config sync in parallel
  const [resolvedModel, effectiveReasoningEffort, selectedScm] = await Promise.all([
    getModelPreference(agentType),
    getReasoningEffortPreference(agentType),
    getSelectedScm(projectRoot),
    ensureAtomicGlobalAgentConfigsForInstallType(installType, configRoot),
  ]);
  const effectiveModel = model ?? resolvedModel;
  const resolvedAdditionalInstructions = resolveChatAdditionalInstructions({ additionalInstructions });

  // Auto-init when project SCM skills are missing or out of sync
  if (await shouldAutoInitChat(agentType, projectRoot, { selectedScm, configRoot })) {
    const configNotFoundMessage =
      `Source control skills are missing or out of sync for ${agentName}. Starting setup...`;

    const { initCommand, InitCancelledError } = await import("@/commands/cli/init.ts");
    try {
      await initCommand({
        showBanner: false,
        preSelectedAgent: agentType,
        preSelectedScm: selectedScm ?? undefined,
        configNotFoundMessage,
        callerHandlesExit: true,
      });
    } catch (error) {
      if (error instanceof InitCancelledError) {
        // User cancelled auto-init — exit gracefully without starting chat
        return 0;
      }
      throw error;
    }
  }

  console.log(`Starting ${agentName} chat interface...`);
  console.log("");

  // Lazy-load SDK tools and create client in parallel — the tools import
  // and SDK client creation are independent of each other.
  const [{ createTodoWriteTool }, { registerCustomTools, cleanupTempToolFiles }, { createTaskListTool }, client] = await Promise.all([
    import("@/services/agents/tools/todo-write.ts"),
    import("@/services/agents/tools/index.ts"),
    import("@/services/agents/tools/task-list.ts"),
    createClientForAgentType(agentType),
  ]);

  // Register TodoWrite tool for agents that don't have it built-in
  if (agentType === "copilot") {
    client.registerTool(createTodoWriteTool());
  }

  // Register task_list tool for all agents — provides persistent CRUD task
  // management backed by SQLite, available in main chat sessions (not just
  // workflow sessions).
  const { join } = await import("path");
  const { homedir } = await import("os");
  const { ensureDirSync } = await import("@/services/system/copy.ts");
  const chatSessionId = crypto.randomUUID();
  const chatSessionDir = join(homedir(), ".atomic", "sessions", "chat", chatSessionId);
  ensureDirSync(chatSessionDir);
  const taskListTool = createTaskListTool({
    workflowName: "chat",
    sessionId: chatSessionId,
    sessionDir: chatSessionDir,
  });
  client.registerTool(taskListTool);

  // Discover and register custom tools before starting the client
  await registerCustomTools(client);

  // Pre-initialize the session log directory before client.start() so that
  // SDK options builders (e.g. Copilot OTel trace file config) can read it
  // via getActiveSessionLogDir(). The full debug subscriber is attached
  // later in startChatUI → createChatUIRuntimeState and reuses this dir.
  try {
    const { isPipelineDebug } = await import("@/services/events/pipeline-logger.ts");
    if (isPipelineDebug()) {
      const {
        resolveStreamDebugLogConfig,
        setActiveSessionLogDir,
        DEFAULT_LOG_DIR,
        buildLogSessionName,
      } = await import("@/services/events/debug-subscriber/config.ts");
      const debugConfig = resolveStreamDebugLogConfig();
      if (debugConfig.enabled) {
        const { join } = await import("path");
        const { ensureDir } = await import("@/services/system/copy.ts");
        const logDir = debugConfig.logDir ?? DEFAULT_LOG_DIR;
        await ensureDir(logDir);
        const sessionName = buildLogSessionName();
        const logDirPath = join(logDir, sessionName);
        await ensureDir(logDirPath);
        setActiveSessionLogDir(logDirPath);
      }
    }
  } catch {
    // Debug session-dir pre-init is non-critical; if it fails (e.g.
    // permissions, disk full), skip it and let the chat session proceed.
    // attachDebugSubscriber will attempt its own initialization later.
  }

  try {
    // Start client and discover MCP configs in parallel.
    // app.tsx import was kicked off at the top of chatCommand() — await it here.
    const [{ discoverMcpConfigs }, { trackAtomicCommand }, { startChatUI }] = await Promise.all([
      import("@/services/config/mcp-config.ts"),
      import("@/services/telemetry/index.ts"),
      appModulePromise,
    ]);

    // Start client and run MCP discovery concurrently
    const clientStartPromise = client.start();
    const mcpDiscoveryPromise = discoverMcpConfigs();

    await clientStartPromise;

    const [modelDisplayInfo, mcpServers] = await Promise.all([
      client.getModelDisplayInfo(effectiveModel),
      mcpDiscoveryPromise,
    ]);

    // For providers with explicit reasoning effort selection, prefer the
    // persisted user choice and fall back to the SDK-reported default.
    const resolvedReasoningEffort =
      agentType === "copilot" || agentType === "claude"
        ? (
          modelDisplayInfo.supportsReasoning
            ? (effectiveReasoningEffort ?? modelDisplayInfo.defaultReasoningEffort)
            : undefined
        )
        : agentType === "opencode"
          ? (
            effectiveReasoningEffort
              && modelDisplayInfo.supportedReasoningEfforts?.includes(effectiveReasoningEffort)
              ? effectiveReasoningEffort
              : undefined
          )
          : effectiveReasoningEffort;

    // For providers with explicit reasoning effort selection, append the selected level.
    let displayModelName = modelDisplayInfo.model;
    if (
      (agentType === "copilot" || agentType === "opencode" || agentType === "claude")
      && resolvedReasoningEffort
      && modelDisplayInfo.supportsReasoning
    ) {
      displayModelName += ` (${resolvedReasoningEffort})`;
    }

    // Build chat UI configuration
    const chatConfig: ChatUIConfig = {
      sessionConfig: {
        model: effectiveModel,
        reasoningEffort: resolvedReasoningEffort,
        mcpServers,
        additionalInstructions: resolvedAdditionalInstructions,
        excludedTools: ["report_intent"],
      },
      theme: await getTheme(theme),
      version: VERSION,
      model: displayModelName,
      tier: modelDisplayInfo.tier,
      workingDir: projectRoot,
      agentType,
      initialPrompt,
      clientStartPromise,
      providerDiscoveryPlan,
    };

    // Start standard chat
    await startChatUI(client, chatConfig);
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
    taskListTool.close();
    await client.stop();
    cleanupTempToolFiles();
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
