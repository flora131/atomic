#!/usr/bin/env bun
/**
 * Chat CLI command for atomic
 *
 * Spawns the native agent CLI as an interactive subprocess.
 * All extra arguments after `-a <agent>` are forwarded to the native CLI.
 *
 * Usage:
 *   atomic chat -a <agent> [native-args...]
 */

import { AGENT_CONFIG, type AgentKey } from "@/services/config/index.ts";
import { COLORS } from "@/theme/colors.ts";
import { isCommandInstalled } from "@/services/system/detect.ts";
import {
  ensureAtomicGlobalAgentConfigsForInstallType,
} from "@/services/config/atomic-global-config.ts";
import { detectInstallationType, getConfigRoot } from "@/services/config/config-path.ts";

// ============================================================================
// Types
// ============================================================================

export type AgentType = AgentKey;

/**
 * Options for the chat command.
 */
export interface ChatCommandOptions {
  /** Agent type to use (claude, opencode, copilot) */
  agentType?: AgentType;
  /** Extra args/options forwarded verbatim to the native agent CLI */
  passthroughArgs?: string[];
}

// ============================================================================
// Helpers
// ============================================================================

export function getAgentDisplayName(agentType: AgentType): string {
  return AGENT_CONFIG[agentType].name;
}

/**
 * Build the argv array for spawning the agent CLI.
 *
 * Starts with the agent's default chat_flags, then appends any
 * extra args the user passed after `-a <agent>`.
 */
export function buildAgentArgs(agentType: AgentType, passthroughArgs: string[] = []): string[] {
  const config = AGENT_CONFIG[agentType];
  return [...config.chat_flags, ...passthroughArgs];
}

// ============================================================================
// Chat Command Implementation
// ============================================================================

/**
 * Spawn the native agent CLI as an interactive subprocess.
 *
 * Runs a small preflight (global config sync) before launching
 * the agent to ensure managed config files are in place.
 *
 * @param options - Chat command configuration options
 * @returns Exit code from the agent process
 */
export async function chatCommand(options: ChatCommandOptions = {}): Promise<number> {
  const { agentType, passthroughArgs } = options;

  if (!agentType) {
    throw new Error("agentType is required. Start chat with `atomic chat -a <agent>`.");
  }

  const config = AGENT_CONFIG[agentType];

  // Check the agent CLI is installed
  if (!isCommandInstalled(config.cmd)) {
    console.error(
      `${COLORS.red}Error: '${config.cmd}' is not installed or not in PATH.${COLORS.reset}`
    );
    console.error(`Install it from: ${config.install_url}`);
    return 1;
  }

  // ── Preflight: global config sync ──
  const projectRoot = process.cwd();
  const configRoot = getConfigRoot();
  const installType = detectInstallationType();

  await ensureAtomicGlobalAgentConfigsForInstallType(installType, configRoot);

  // ── Spawn the native agent CLI ──
  const args = buildAgentArgs(agentType, passthroughArgs);
  const cmd = [config.cmd, ...args];

  const proc = Bun.spawn(cmd, {
    stdio: ["inherit", "inherit", "inherit"],
    cwd: projectRoot,
    env: { ...process.env },
  });

  return await proc.exited;
}
