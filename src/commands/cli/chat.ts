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
import { isTrustedWorkspacePath } from "@/services/config/settings.ts";
import { ENHANCED_SYSTEM_PROMPT } from "@/services/agents/enhanced-system-prompt.ts";
import { pathExists } from "@/services/system/copy.ts";
import { AGENT_CONFIG, type SourceControlType } from "@/services/config/index.ts";
import { hasProjectOnboardingFiles } from "@/commands/cli/init.ts";
// initCommand is lazy-loaded only when auto-init is needed
import { join, relative, resolve, sep } from "path";
import { readdir } from "fs/promises";
import {
  ensureAtomicGlobalAgentConfigsForInstallType,
  getTemplateAgentFolder,
  isManagedScmSkillName,
} from "@/services/config/atomic-global-config.ts";
import {
  clearProviderDiscoverySessionCache,
  startProviderDiscoverySessionCache,
} from "@/services/config/provider-discovery-cache.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import { emitDiscoveryEvent } from "@/services/config/discovery-events.ts";
import { detectInstallationType, getConfigRoot } from "@/services/config/config-path.ts";
import { getSelectedScm } from "@/services/config/atomic-config.ts";
import { supportsTrueColor } from "@/services/system/detect.ts";
import { VERSION } from "@/version.ts";
import { homedir } from "os";

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

// ============================================================================
// Client Factory
// ============================================================================

/**
 * Create an SDK client based on agent type.
 *
 * @param agentType - The type of agent to create a client for
 * @returns A CodingAgentClient instance
 */
async function createClientForAgentType(agentType: AgentType): Promise<CodingAgentClient> {
  switch (agentType) {
    case "claude": {
      const { createClaudeAgentClient } = await import("@/services/agents/clients/claude.ts");
      return createClaudeAgentClient();
    }
    case "opencode": {
      const { createOpenCodeClient } = await import("@/services/agents/clients/opencode.ts");
      return createOpenCodeClient({
        directory: process.cwd(),
        port: 0,
        reuseExistingServer: false,
      });
    }
    case "copilot": {
      const { createCopilotClient } = await import("@/services/agents/clients/copilot.ts");
      return createCopilotClient();
    }
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

/**
 * Get the display name for an agent type.
 */
function getAgentDisplayName(agentType: AgentType): string {
  const names: Record<AgentType, string> = {
    claude: "Claude",
    opencode: "OpenCode",
    copilot: "Copilot",
  };
  return names[agentType] ?? agentType;
}

/**
 * Get theme from name.
 */
async function getTheme(themeName: "dark" | "light"): Promise<Theme> {
  const { darkTheme, lightTheme, darkThemeAnsi, lightThemeAnsi } = await import("@/app.tsx");
  const truecolor = supportsTrueColor();
  if (themeName === "light") {
    return truecolor ? lightTheme : lightThemeAnsi;
  }
  return truecolor ? darkTheme : darkThemeAnsi;
}

export function buildChatStartupDiscoveryPlan(
  agentType: AgentType,
  options: ProviderDiscoveryPlanOptions = {}
): ProviderDiscoveryPlan {
  return buildProviderDiscoveryPlan(agentType, options);
}

interface ProviderDiscoveryPlanDebugOptions {
  projectRoot?: string;
  homeDir?: string;
}

interface ProviderDiscoveryDebugRoot {
  id: string;
  tier: ProviderDiscoveryPlan["rootsInPrecedenceOrder"][number]["tier"];
  compatibility: ProviderDiscoveryPlan["rootsInPrecedenceOrder"][number]["compatibility"];
  precedence: number;
  exists: boolean;
  pathTemplate: string;
  resolvedPath: string;
}

export interface ProviderDiscoveryPlanDebugOutput {
  provider: ProviderDiscoveryPlan["provider"];
  runtime: ProviderDiscoveryPlan["runtime"];
  paths: {
    atomicBaseline: readonly string[];
    userGlobal: readonly string[];
    projectLocal: readonly string[];
  };
  rootsInPrecedenceOrder: readonly ProviderDiscoveryDebugRoot[];
  existingRootIds: readonly string[];
  compatibilitySets: {
    nativeRootIds: readonly string[];
    compatibilityRootIds: readonly string[];
  };
}

function isChatDebugEnabled(): boolean {
  const debugValue = process.env.DEBUG?.trim().toLowerCase();
  return !!debugValue && (debugValue === "1" || debugValue === "true" || debugValue === "on");
}

function isSameOrDescendantPath(pathValue: string, basePath: string): boolean {
  const resolvedPath = resolve(pathValue);
  const resolvedBasePath = resolve(basePath);
  return resolvedPath === resolvedBasePath || resolvedPath.startsWith(`${resolvedBasePath}${sep}`);
}

function normalizeRelativeForDebug(relativePath: string): string {
  return relativePath.split(sep).join("/");
}

function sanitizeDiscoveryPathForDebug(
  pathValue: string,
  options: Required<ProviderDiscoveryPlanDebugOptions>
): string {
  const resolvedPath = resolve(pathValue);

  if (isSameOrDescendantPath(resolvedPath, options.projectRoot)) {
    const projectRelativePath = relative(options.projectRoot, resolvedPath);
    return projectRelativePath.length > 0
      ? `<project>/${normalizeRelativeForDebug(projectRelativePath)}`
      : "<project>";
  }

  if (isSameOrDescendantPath(resolvedPath, options.homeDir)) {
    const homeRelativePath = relative(options.homeDir, resolvedPath);
    return homeRelativePath.length > 0 ? `~/${normalizeRelativeForDebug(homeRelativePath)}` : "~";
  }

  return "<external-path>";
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

export function buildProviderDiscoveryPlanDebugOutput(
  plan: ProviderDiscoveryPlan,
  options: ProviderDiscoveryPlanDebugOptions = {}
): ProviderDiscoveryPlanDebugOutput {
  const context: Required<ProviderDiscoveryPlanDebugOptions> = {
    projectRoot: resolve(options.projectRoot ?? process.cwd()),
    homeDir: resolve(options.homeDir ?? homedir()),
  };

  const sanitizePath = (pathValue: string) => sanitizeDiscoveryPathForDebug(pathValue, context);

  return {
    provider: plan.provider,
    runtime: plan.runtime,
    paths: {
      atomicBaseline: dedupeStrings(plan.paths.atomicBaseline.map(sanitizePath)),
      userGlobal: dedupeStrings(plan.paths.userGlobal.map(sanitizePath)),
      projectLocal: dedupeStrings(plan.paths.projectLocal.map(sanitizePath)),
    },
    rootsInPrecedenceOrder: plan.rootsInPrecedenceOrder.map((root) => ({
      id: root.id,
      tier: root.tier,
      compatibility: root.compatibility,
      precedence: root.precedence,
      exists: root.exists,
      pathTemplate: root.pathTemplate,
      resolvedPath: sanitizePath(root.resolvedPath),
    })),
    existingRootIds: plan.existingRoots.map((root) => root.id),
    compatibilitySets: {
      nativeRootIds: Array.from(plan.compatibilitySets.nativeRootIds),
      compatibilityRootIds: Array.from(plan.compatibilitySets.compatibilityRootIds),
    },
  };
}

export function logActiveProviderDiscoveryPlan(
  plan: ProviderDiscoveryPlan,
  options: ProviderDiscoveryPlanDebugOptions & {
    logFn?: (message: string) => void;
  } = {}
): void {
  if (!isChatDebugEnabled()) {
    return;
  }

  const debugOutput = buildProviderDiscoveryPlanDebugOutput(plan, options);
  const message = `[chat.discovery.plan] ${JSON.stringify(debugOutput, null, 2)}`;
  const logFn = options.logFn ?? ((value: string) => console.debug(value));
  logFn(message);
}

const SCM_PREFIX_BY_TYPE: Record<SourceControlType, "gh-" | "sl-"> = {
  github: "gh-",
  sapling: "sl-",
};

function getScmPrefix(scmType: SourceControlType): "gh-" | "sl-" {
  return SCM_PREFIX_BY_TYPE[scmType];
}

async function listManagedScmSkillNames(skillsDir: string): Promise<Set<string>> {
  if (!(await pathExists(skillsDir))) {
    return new Set();
  }

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return new Set(
      entries
        .filter((entry) => entry.isDirectory() && isManagedScmSkillName(entry.name))
        .map((entry) => entry.name)
    );
  } catch {
    return new Set();
  }
}

/**
 * Determine whether the selected agent already has project-level SCM skills.
 */
export async function hasProjectScmSkills(
  agentType: AgentType,
  projectRoot: string
): Promise<boolean> {
  const skillsDir = join(projectRoot, AGENT_CONFIG[agentType].folder, "skills");
  if (!(await pathExists(skillsDir))) return false;

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries.some(
      (entry) => entry.isDirectory() && isManagedScmSkillName(entry.name)
    );
  } catch {
    return false;
  }
}

/**
 * Determine whether project-local SCM skills include the bundled variants
 * for the selected source control system.
 */
export async function hasProjectScmSkillsInSync(
  agentType: AgentType,
  scmType: SourceControlType,
  projectRoot: string,
  configRoot: string = getConfigRoot()
): Promise<boolean> {
  const sourceSkillsDir = join(configRoot, getTemplateAgentFolder(agentType), "skills");
  const projectSkillsDir = join(projectRoot, AGENT_CONFIG[agentType].folder, "skills");

  const [sourceManagedSkills, projectManagedSkills] = await Promise.all([
    listManagedScmSkillNames(sourceSkillsDir),
    listManagedScmSkillNames(projectSkillsDir),
  ]);

  const selectedPrefix = getScmPrefix(scmType);
  const expectedManagedSkills = Array.from(sourceManagedSkills).filter((name) =>
    name.startsWith(selectedPrefix)
  );

  if (expectedManagedSkills.length === 0) {
    return false;
  }

  for (const skillName of expectedManagedSkills) {
    if (!projectManagedSkills.has(skillName)) {
      return false;
    }
  }

  return true;
}

interface AutoInitCheckOptions {
  selectedScm?: SourceControlType | null;
  configRoot?: string;
}

/**
 * Determine whether chat should auto-run init for the selected agent.
 */
export async function shouldAutoInitChat(
  agentType: AgentType,
  projectRoot: string = process.cwd(),
  options: AutoInitCheckOptions = {}
): Promise<boolean> {
  if (!(await isTrustedWorkspacePath(projectRoot, agentType))) {
    return true;
  }

  if (!(await hasProjectOnboardingFiles(agentType, projectRoot))) {
    return true;
  }

  const selectedScm = options.selectedScm ?? (await getSelectedScm(projectRoot));
  if (!selectedScm) {
    return !(await hasProjectScmSkills(agentType, projectRoot));
  }

  const configRoot = options.configRoot ?? getConfigRoot();
  return !(await hasProjectScmSkillsInSync(agentType, selectedScm, projectRoot, configRoot));
}

// ============================================================================
// Slash Command Handling
// ============================================================================

/**
 * Check if a message is a slash command.
 */
function isSlashCommand(message: string): boolean {
  return message.startsWith("/");
}

/**
 * Parse a slash command.
 */
function parseSlashCommand(message: string): { command: string; args: string } {
  const trimmed = message.slice(1).trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { command: trimmed.toLowerCase(), args: "" };
  }
  return {
    command: trimmed.slice(0, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}

/**
 * Handle the /theme slash command.
 *
 * @returns Theme change message or null if invalid
 */
function handleThemeCommand(args: string): { newTheme: "dark" | "light"; message: string } | null {
  const themeName = args.toLowerCase();
  if (themeName === "dark" || themeName === "light") {
    return {
      newTheme: themeName,
      message: `Theme switched to ${themeName} mode.`,
    };
  }
  return null;
}

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
