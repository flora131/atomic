/**
 * Helper for spawning the attached `atomic _footer` pane inside an agent
 * tmux window.
 *
 * Shared between the workflow executor (per-agent windows) and the chat
 * command (single-agent window). Splits the target pane vertically so the
 * top pane keeps running the agent CLI and the bottom pane hosts the
 * React footer.
 *
 * Resolves the CLI entrypoint relative to this module (runtime/ lives at
 * src/sdk/runtime/, so ../../cli.ts is the CLI). `process.argv[1]` points
 * at the worker entrypoint when called from the orchestrator,
 * so it can't be used here.
 */

import type { AgentType } from "../types.ts";
import { getMuxBinary, tmuxRun } from "./tmux.ts";
import { buildSelfExecCommand, resolveSdkCliPath } from "../lib/self-exec.ts";

/**
 * Rows reserved for the footer pane. Matches the single-row height of
 * `AttachedStatusline` so the agent pane absorbs all remaining space.
 */
const FOOTER_PANE_LINES = 1;

function encodePwshCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function resolveAttachedFooterCliPath(override?: string): string {
  return resolveSdkCliPath({ override });
}

export function buildAttachedFooterCommand({
  runtime,
  cliPath,
  windowName,
  agentType,
  platform = process.platform,
}: {
  runtime: string;
  cliPath: string;
  windowName: string;
  agentType?: AgentType;
  platform?: NodeJS.Platform;
}): string {
  const args: string[] = ["--name", windowName];
  if (agentType) args.push("--agent", agentType);
  const cmd = buildSelfExecCommand({
    runtime,
    cliPath,
    subcommand: "_footer",
    args,
    platform,
  });
  if (platform === "win32") {
    return `pwsh -NoProfile -EncodedCommand ${encodePwshCommand(`& ${cmd}`)}`;
  }
  return cmd;
}

export function buildAttachedFooterCloseHooks(
  agentPaneId: string,
  footerPaneId: string,
  options: { guardAgentPane?: boolean } = {},
): Array<{ event: string; command: string }> {
  const killFooter = `kill-pane -t ${footerPaneId}`;
  const paneExitedCommand = options.guardAgentPane === false
    ? killFooter
    : `if -F '#{==:#{hook_pane},${agentPaneId}}' '${killFooter}'`;

  return [
    { event: "pane-exited", command: paneExitedCommand },
    { event: "after-kill-pane", command: killFooter },
  ];
}

function muxSupportsHookPaneFormat(): boolean {
  const binary = getMuxBinary();
  return binary !== "psmux" && binary !== "pmux";
}

export function spawnAttachedFooter(
  windowName: string,
  paneId: string,
  agentType?: AgentType,
  pathToAtomicExecutable?: string,
): void {
  const cliPath = resolveAttachedFooterCliPath(pathToAtomicExecutable);
  // When `pathToAtomicExecutable` is set, the override IS the runtime (direct
  // exec, mirroring Claude SDK's `pathToClaudeCodeExecutable`). Otherwise
  // `process.execPath` (Bun) runs the SDK's bundled cli.{ts,js}.
  const runtime = pathToAtomicExecutable ? cliPath : process.execPath;
  if (!runtime) return;
  const cmd = buildAttachedFooterCommand({
    runtime,
    cliPath,
    windowName,
    agentType,
  });
  const split = tmuxRun([
    "split-window",
    "-t", paneId,
    "-v", "-l", String(FOOTER_PANE_LINES), "-d",
    "-P", "-F", "#{pane_id}",
    cmd,
  ]);
  if (!split.ok) return;
  const footerPaneId = split.stdout.trim();
  if (!footerPaneId) return;
  tmuxRun(["select-pane", "-t", paneId]);
  for (const hook of buildAttachedFooterCloseHooks(paneId, footerPaneId, {
    guardAgentPane: muxSupportsHookPaneFormat(),
  })) {
    tmuxRun([
      "set-hook",
      "-w", "-t", footerPaneId,
      hook.event,
      hook.command,
    ]);
  }
  // Pin the footer to FOOTER_PANE_LINES on every resize so the agent pane
  // absorbs all new space. Tmux's default proportional redistribution
  // would otherwise grow the footer on larger windows. Window-scoped
  // (`-w`) so other windows (e.g. the orchestrator graph) are unaffected.
  tmuxRun([
    "set-hook",
    "-w", "-t", footerPaneId,
    "window-resized",
    `resize-pane -t ${footerPaneId} -y ${FOOTER_PANE_LINES}`,
  ]);
}
