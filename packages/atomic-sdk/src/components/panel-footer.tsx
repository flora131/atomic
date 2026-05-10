/** @jsxImportSource @opentui/react */

import { memo } from "react";
import { useGraphTheme } from "./orchestrator-panel-contexts.ts";

export interface PanelFooterHint {
  key: string;
  label: string;
  dim?: boolean;
}

export interface PanelFooterProps {
  mode: string;
  subject?: string;
  runId?: string;
  hints: readonly PanelFooterHint[];
}

/** OpenTUI-native footer for graph and pane views. */
export const PanelFooter = memo(function PanelFooter({
  mode,
  subject,
  runId,
  hints,
}: PanelFooterProps) {
  const theme = useGraphTheme();

  return (
    <box height={1} flexDirection="row" backgroundColor={theme.backgroundElement}>
      <box
        backgroundColor={theme.info}
        paddingLeft={1}
        paddingRight={1}
        alignItems="center"
      >
        <text>
          <span fg={theme.backgroundElement} bg={theme.info}>
            <strong>{mode}</strong>
          </span>
        </text>
      </box>

      {subject ? (
        <box paddingLeft={1} paddingRight={1} alignItems="center">
          <text>
            <span fg={theme.text} bg={theme.backgroundElement}>{subject}</span>
          </text>
        </box>
      ) : null}

      {runId ? (
        <box paddingLeft={1} paddingRight={1} alignItems="center">
          <text>
            <span fg={theme.textDim} bg={theme.backgroundElement}>{runId}</span>
          </text>
        </box>
      ) : null}

      <box flexGrow={1} />

      <box paddingRight={2} alignItems="center" flexDirection="row">
        {hints.map((h, i) => (
          <box key={`${h.key}-${h.label}`} flexDirection="row">
            {i > 0 ? (
              <text>
                <span fg={theme.textDim} bg={theme.backgroundElement}>{"  ·  "}</span>
              </text>
            ) : null}
            <text>
              <span fg={h.dim ? theme.textDim : theme.text} bg={theme.backgroundElement}>{h.key}</span>
              <span fg={h.dim ? theme.textDim : theme.textDim} bg={theme.backgroundElement}>{" " + h.label}</span>
            </text>
          </box>
        ))}
      </box>
    </box>
  );
});
