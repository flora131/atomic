/** @jsxImportSource @opentui/react */

import { useGraphTheme } from "./orchestrator-panel-contexts.ts";
import { statusIcon, statusColor, statusLabel } from "./status-helpers.ts";
import type { LayoutNode } from "./layout.ts";

export function Statusline({
  focusedNode,
  attachMsg,
}: {
  focusedNode: LayoutNode | undefined;
  attachMsg: string;
}) {
  const theme = useGraphTheme();
  const ni = focusedNode ? statusIcon(focusedNode.status) : "";
  const nc = focusedNode ? statusColor(focusedNode.status, theme) : theme.textDim;

  return (
    <box height={1} flexDirection="row" backgroundColor={theme.backgroundElement}>
      <box backgroundColor={theme.primary} paddingLeft={1} paddingRight={1} alignItems="center">
        <text fg={theme.backgroundElement}>
          <strong>GRAPH</strong>
        </text>
      </box>

      {focusedNode ? (
        <box backgroundColor="transparent" paddingLeft={1} paddingRight={1} alignItems="center">
          <text>
            <span fg={nc}>{ni} </span>
            <span fg={theme.text}>{focusedNode.name}</span>
            <span fg={theme.textMuted}> {"\u00B7"} {statusLabel(focusedNode.status)}</span>
            {focusedNode.error ? (
              <span fg={theme.error}> {"\u00B7"} {focusedNode.error}</span>
            ) : null}
          </text>
        </box>
      ) : null}

      <box flexGrow={1} />

      <box paddingRight={2} alignItems="center">
        {attachMsg ? (
          <text fg={theme.text}>
            <strong>{attachMsg}</strong>
          </text>
        ) : (
          <text>
            <span fg={theme.text}>{"\u2191"} {"\u2193"} {"\u2190"} {"\u2192"}</span>
            <span fg={theme.textMuted}> navigate</span>
            <span fg={theme.textDim}> {"\u00B7"} </span>
            <span fg={theme.text}>{"\u21B5"}</span>
            <span fg={theme.textMuted}> attach</span>
            <span fg={theme.textDim}> {"\u00B7"} </span>
            <span fg={theme.text}>q</span>
            <span fg={theme.textMuted}> quit</span>
          </text>
        )}
      </box>
    </box>
  );
}
