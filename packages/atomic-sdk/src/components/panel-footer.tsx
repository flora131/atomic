/** @jsxImportSource @opentui/react */

import { memo } from "react";
import { useGraphTheme } from "./orchestrator-panel-contexts.ts";
import type { SessionData } from "./orchestrator-panel-types.ts";

export interface PanelFooterHint {
  key: string;
  label: string;
  dim?: boolean;
}

export type PanelFooterTone = "info" | "success" | "error";

export interface PanelFooterStatusInput {
  readonly fatalError: string | null;
  readonly completionReached: boolean;
  readonly sessions: readonly Pick<SessionData, "status">[];
}

export function panelFooterToneFromStatus({
  fatalError,
  completionReached,
  sessions,
}: PanelFooterStatusInput): PanelFooterTone {
  if (fatalError !== null || sessions.some((session) => session.status === "error")) {
    return "error";
  }
  if (completionReached) return "success";
  return "info";
}

export interface PanelFooterProps {
  mode: string;
  subject?: string;
  runId?: string;
  tone?: PanelFooterTone;
  hints: readonly PanelFooterHint[];
}

/** OpenTUI-native footer for graph and pane views. */
export const PanelFooter = memo(function PanelFooter({
  mode,
  subject,
  runId,
  tone = "info",
  hints,
}: PanelFooterProps) {
  const theme = useGraphTheme();
  const modeColor = tone === "success" ? theme.success : tone === "error" ? theme.error : theme.info;

  return (
    <box height={1} flexDirection="row" backgroundColor={theme.backgroundElement}>
      <box
        backgroundColor={modeColor}
        paddingLeft={1}
        paddingRight={1}
        alignItems="center"
      >
        <text>
          <span fg={theme.backgroundElement} bg={modeColor}>
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
