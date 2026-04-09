/** @jsxImportSource @opentui/react */

import type { SessionStatus } from "./orchestrator-panel-types.ts";
import { useStore, useGraphTheme } from "./orchestrator-panel-contexts.ts";

export function Header() {
  const store = useStore();
  const theme = useGraphTheme();

  const counts: Record<SessionStatus, number> = { complete: 0, running: 0, pending: 0, error: 0 };
  for (const s of store.sessions) counts[s.status]++;

  const isFailed = store.fatalError !== null;
  const isDone = store.completionInfo !== null;
  const badgeColor = isFailed ? theme.error : isDone ? theme.success : theme.info;
  const badgeText = isFailed
    ? " \u2717 Failed "
    : isDone
      ? ` \u2713 ${store.workflowName} `
      : " Orchestrator ";

  return (
    <box
      height={1}
      backgroundColor={theme.backgroundElement}
      flexDirection="row"
      paddingRight={2}
      alignItems="center"
    >
      <text>
        <span fg={theme.backgroundElement} bg={badgeColor}>
          <strong>{badgeText}</strong>
        </span>
      </text>

      <box flexGrow={1} justifyContent="flex-end" flexDirection="row" gap={2}>
        {counts.complete > 0 ? (
          <text>
            <span fg={theme.success}>{"\u2713"} {counts.complete}</span>
          </text>
        ) : null}
        {counts.running > 0 ? (
          <text>
            <span fg={theme.warning}>{"\u25CF"} {counts.running}</span>
          </text>
        ) : null}
        {counts.pending > 0 ? (
          <text>
            <span fg={theme.textDim}>{"\u25CB"} {counts.pending}</span>
          </text>
        ) : null}
        {counts.error > 0 ? (
          <text>
            <span fg={theme.error}>{"\u2717"} {counts.error}</span>
          </text>
        ) : null}
      </box>
    </box>
  );
}
