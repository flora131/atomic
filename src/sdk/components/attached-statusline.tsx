/** @jsxImportSource @opentui/react */
/**
 * Footer rendered inside each agent tmux window. Lives in a 1-row bottom
 * pane created by the executor after the agent window is spawned. Mirrors
 * the orchestrator Statusline style — colored badge on the left, dimmed
 * keyboard hints on the right.
 */

import type { GraphTheme } from "./graph-theme.ts";

export function AttachedStatusline({ name, theme }: { name: string; theme: GraphTheme }) {
  return (
    <box height={1} flexDirection="row" backgroundColor={theme.backgroundElement}>
      <box backgroundColor={theme.primary} paddingLeft={1} paddingRight={1} alignItems="center">
        <text fg={theme.backgroundElement}>
          <strong>{name}</strong>
        </text>
      </box>

      <box flexGrow={1} />

      <box paddingRight={2} alignItems="center">
        <text>
          <span fg={theme.text}>ctrl+g</span>
          <span fg={theme.textMuted}> graph</span>
          <span fg={theme.textDim}> {"\u00B7"} </span>
          <span fg={theme.text}>{"ctrl+\\"}</span>
          <span fg={theme.textMuted}> next</span>
        </text>
      </box>
    </box>
  );
}
