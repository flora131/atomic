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
 * at the orchestrator's executor-entry.ts when called from the executor,
 * so it can't be used here.
 */

import { join } from "node:path";
import type { AgentType } from "../types.ts";
import { tmuxRun } from "./tmux.ts";

/** Percent of the agent window's vertical space allocated to the footer pane. */
const FOOTER_PANE_PERCENT = 5;

/** Escape a string for safe interpolation inside a bash double-quoted string. */
function escBash(s: string): string {
  return s
    .replace(/\x00/g, "")
    .replace(/[\n\r]+/g, " ")
    .replace(/[\\"$`!]/g, "\\$&");
}

export function spawnAttachedFooter(
  windowName: string,
  paneId: string,
  agentType?: AgentType,
): void {
  const runtime = process.execPath;
  if (!runtime) return;
  const cliPath = join(import.meta.dir, "..", "..", "cli.ts");
  const agentFlag = agentType ? ` --agent "${escBash(agentType)}"` : "";
  const cmd =
    `"${escBash(runtime)}" "${escBash(cliPath)}" _footer ` +
    `--name "${escBash(windowName)}"${agentFlag}`;
  tmuxRun([
    "split-window",
    "-t", paneId,
    "-v", "-l", `${FOOTER_PANE_PERCENT}%`, "-d",
    cmd,
  ]);
}
