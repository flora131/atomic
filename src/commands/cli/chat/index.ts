#!/usr/bin/env bun
/**
 * Chat CLI command for atomic
 *
 * Spawns the native agent CLI as an interactive subprocess.
 * When already inside a tmux/psmux session, the agent spawns inline
 * in the current pane. When outside tmux, it creates a new tmux
 * session and attaches to it.
 *
 * All extra arguments after `-a <agent>` are forwarded to the native CLI.
 *
 * Usage:
 *   atomic chat -a <agent> [native-args...]
 */

import { join } from "path";
import { homedir } from "os";
import { mkdir, writeFile, rm } from "fs/promises";
import { AGENT_CONFIG, type AgentKey } from "@/services/config/index.ts";
import { COLORS } from "@/theme/colors.ts";
import { isCommandInstalled } from "@/services/system/detect.ts";
import {
  ensureAtomicGlobalAgentConfigs,
} from "@/services/config/atomic-global-config.ts";
import { getConfigRoot } from "@/services/config/config-path.ts";
import {
  isInsideTmux,
  isTmuxInstalled,
  resetMuxBinaryCache,
} from "@/sdk/workflows.ts";
import {
  createSession,
  killSession,
  getMuxBinary,
} from "@/sdk/workflows.ts";
import { ensureTmuxInstalled } from "@/lib/spawn.ts";

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

function generateChatId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Escape a string for safe interpolation inside a bash double-quoted string. */
function escBash(s: string): string {
  return s.replace(/[\\"$`!]/g, "\\$&");
}

/** Escape a string for safe interpolation inside a PowerShell double-quoted string. */
function escPwsh(s: string): string {
  return s.replace(/[`"$]/g, "`$&");
}

/**
 * Build a launcher script that preserves cwd and properly quotes args.
 * This avoids shell-injection risks from passthrough args.
 */
function buildLauncherScript(
  cmd: string,
  args: string[],
  projectRoot: string,
  envVars: Record<string, string> = {},
): { script: string; ext: string } {
  const isWin = process.platform === "win32";
  const envEntries = Object.entries(envVars);

  if (isWin) {
    // PowerShell: use array splatting for safe arg passing
    const argList = args.map((a) => `"${escPwsh(a)}"`).join(", ");
    const envLines = envEntries.map(
      ([key, value]) => `$env:${key} = "${escPwsh(value)}"`,
    );
    const script = [
      `Set-Location "${escPwsh(projectRoot)}"`,
      ...envLines,
      argList.length > 0
        ? `& "${escPwsh(cmd)}" @(${argList})`
        : `& "${escPwsh(cmd)}"`,
    ].join("\n");
    return { script, ext: "ps1" };
  }

  // Bash: use proper quoting for each arg
  const quotedArgs = args
    .map((a) => `"${escBash(a)}"`)
    .join(" ");
  const envLines = envEntries.map(
    ([key, value]) => `export ${key}="${escBash(value)}"`,
  );
  const script = [
    "#!/bin/bash",
    `cd "${escBash(projectRoot)}"`,
    ...envLines,
    `exec "${escBash(cmd)}" ${quotedArgs}`,
  ].join("\n");
  return { script, ext: "sh" };
}

// ============================================================================
// Chat Command Implementation
// ============================================================================

/**
 * Spawn the native agent CLI as an interactive subprocess.
 *
 * When running inside a tmux/psmux session, the agent spawns inline
 * in the current pane with inherited stdio.
 *
 * When running outside tmux, a new tmux session is created and
 * attached so the agent benefits from multiplexer features.
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

  await ensureAtomicGlobalAgentConfigs(configRoot);

  // ── Build argv ──
  const args = buildAgentArgs(agentType, passthroughArgs);
  const cmd = [config.cmd, ...args];
  const envVars = config.env_vars;

  // ── Inside tmux: spawn inline in the current pane ──
  if (isInsideTmux()) {
    return spawnDirect(cmd, projectRoot, envVars);
  }

  // ── No TTY: tmux attach requires a real terminal ──
  if (!process.stdin.isTTY) {
    return spawnDirect(cmd, projectRoot, envVars);
  }

  // ── Ensure tmux is available ──
  if (!isTmuxInstalled()) {
    console.log("Terminal multiplexer not found. Installing...");
    try {
      await ensureTmuxInstalled();
      resetMuxBinaryCache();
    } catch {
      // Fall through to check below
    }
    if (!isTmuxInstalled()) {
      // No tmux available — fall back to direct spawn
      return spawnDirect(cmd, projectRoot, envVars);
    }
  }

  // ── Build launcher script for safe arg/cwd handling ──
  const chatId = generateChatId();
  const windowName = `atomic-chat-${chatId}`;

  const sessionsDir = join(homedir(), ".atomic", "sessions", "chat");
  await mkdir(sessionsDir, { recursive: true });
  const { script, ext } = buildLauncherScript(
    config.cmd,
    args,
    projectRoot,
    envVars,
  );
  const launcherPath = join(sessionsDir, `${windowName}.${ext}`);
  await writeFile(launcherPath, script, { mode: 0o755 });

  const shellCmd = process.platform === "win32"
    ? `pwsh -NoProfile -File "${launcherPath}"`
    : `bash "${launcherPath}"`;

  // ── Outside tmux: create a new session and attach ──
  try {
    createSession(windowName, shellCmd, undefined, projectRoot);

    const muxBinary = getMuxBinary() ?? "tmux";
    const attachProc = Bun.spawn([muxBinary, "attach-session", "-t", windowName], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exitCode = await attachProc.exited;

    // Clean up launcher
    try { await rm(launcherPath, { force: true }); } catch {}

    // If tmux attach itself failed (e.g. lost TTY), clean up and fall back
    if (exitCode !== 0) {
      try { killSession(windowName); } catch {}
      return spawnDirect(cmd, projectRoot, envVars);
    }

    return exitCode;
  } catch (error) {
    try { await rm(launcherPath, { force: true }); } catch {}
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `${COLORS.yellow}Warning: Failed to create tmux session (${message}). Falling back to direct spawn.${COLORS.reset}`
    );
    return spawnDirect(cmd, projectRoot, envVars);
  }
}

/**
 * Spawn the agent CLI directly with inherited stdio.
 * Used when not inside tmux.
 */
async function spawnDirect(
  cmd: string[],
  projectRoot: string,
  envVars: Record<string, string> = {},
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    stdio: ["inherit", "inherit", "inherit"],
    cwd: projectRoot,
    env: { ...process.env, ...envVars },
  });

  return await proc.exited;
}
