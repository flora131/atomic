/** @jsxImportSource @opentui/react */

import { useStore, useGraphTheme, useStoreVersion } from "./orchestrator-panel-contexts.ts";
import { statusIcon, statusColor } from "./status-helpers.ts";
import type { LayoutNode } from "./layout.ts";

export function Statusline({
  focusedNode,
  attachMsg,
}: {
  focusedNode: LayoutNode | undefined;
  attachMsg: string;
}) {
  const store = useStore();
  const theme = useGraphTheme();
  useStoreVersion(store);

  return (
    <box height={1} flexDirection="row" backgroundColor={theme.backgroundElement}>
      {/* Mode badge — always GRAPH since this bar is only visible in the orchestrator window */}
      <box backgroundColor={theme.primary} paddingLeft={1} paddingRight={1} alignItems="center">
        <text fg={theme.backgroundElement}>
          <strong>GRAPH</strong>
        </text>
      </box>

      {/* Focused node info */}
      {focusedNode ? (
        <box backgroundColor="transparent" paddingLeft={1} alignItems="center">
          <text>
            <span fg={statusColor(focusedNode.status, theme)}>{statusIcon(focusedNode.status)} </span>
            <span fg={theme.text}>{focusedNode.name}</span>
            {focusedNode.error ? (
              <span fg={theme.error}> {"\u00B7"} {focusedNode.error}</span>
            ) : null}
          </text>
        </box>
      ) : null}

      <box flexGrow={1} />

      {/* Navigation hints — always graph-mode (tmux status bar handles attached-mode hints) */}
      <box paddingRight={2} alignItems="center">
        {attachMsg ? (
          <text fg={theme.text}>
            <strong>{attachMsg}</strong>
          </text>
        ) : (
          <text>
            <span fg={theme.text}>{"\u2191\u2193\u2190\u2192"}</span>
            <span fg={theme.textMuted}> navigate</span>
            <span fg={theme.textDim}> {"\u00B7"} </span>
            <span fg={theme.text}>{"\u21B5"}</span>
            <span fg={theme.textMuted}> attach</span>
            <span fg={theme.textDim}> {"\u00B7"} </span>
            <span fg={theme.text}>/</span>
            <span fg={theme.textMuted}> agents</span>
            <span fg={theme.textDim}> {"\u00B7"} </span>
            <span fg={theme.text}>q</span>
            <span fg={theme.textMuted}> quit</span>
          </text>
        )}
      </box>
    </box>
  );
}
