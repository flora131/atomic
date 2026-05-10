/** @jsxImportSource @opentui/react */

import { useMemo } from "react";
import type { SessionStatus } from "./orchestrator-panel-types.ts";
import {
  useStore,
  useGraphTheme,
  useStoreVersion,
} from "./orchestrator-panel-contexts.ts";
import { panelFooterToneFromStatus, type PanelFooterTone } from "./panel-footer.tsx";

function CountBadge({
  color,
  icon,
  count,
  backgroundColor,
}: {
  color: string;
  icon: string;
  count: number;
  backgroundColor: string;
}) {
  if (count <= 0) return null;
  return (
    <text>
      <span fg={color} bg={backgroundColor}>{icon} {count}</span>
    </text>
  );
}

export interface HeaderBadgePresentationInput {
  workflowName: string;
  tone: PanelFooterTone;
}

export function headerBadgePresentation({
  workflowName,
  tone,
}: HeaderBadgePresentationInput): { text: string; tone: PanelFooterTone } {
  if (tone === "error") return { text: " ✗ Failed ", tone };
  if (tone === "success") return { text: ` ✓ ${workflowName || "Orchestrator"} `, tone };
  return { text: " Orchestrator ", tone };
}

function headerToneColor(tone: PanelFooterTone, theme: ReturnType<typeof useGraphTheme>): string {
  if (tone === "error") return theme.error;
  if (tone === "success") return theme.success;
  return theme.info;
}

export function Header() {
  const store = useStore();
  const theme = useGraphTheme();
  const storeVersion = useStoreVersion(store);

  const counts = useMemo(() => {
    const c: Record<SessionStatus, number> = { complete: 0, running: 0, pending: 0, error: 0, awaiting_input: 0 };
    for (const s of store.sessions) c[s.status]++;
    return c;
  }, [storeVersion]);

  const badge = headerBadgePresentation({
    workflowName: store.workflowName,
    tone: panelFooterToneFromStatus(store),
  });
  const badgeColor = headerToneColor(badge.tone, theme);

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
          <strong>{badge.text}</strong>
        </span>
      </text>

      <box flexGrow={1} justifyContent="flex-end" flexDirection="row" gap={2}>
        <CountBadge color={theme.success} backgroundColor={theme.backgroundElement} icon={"\u2713"} count={counts.complete} />
        <CountBadge color={theme.warning} backgroundColor={theme.backgroundElement} icon={"\u25CF"} count={counts.running} />
        <CountBadge color={theme.info} backgroundColor={theme.backgroundElement} icon={"?"} count={counts.awaiting_input} />
        <CountBadge color={theme.textDim} backgroundColor={theme.backgroundElement} icon={"\u25CB"} count={counts.pending} />
        <CountBadge color={theme.error} backgroundColor={theme.backgroundElement} icon={"\u2717"} count={counts.error} />
      </box>
    </box>
  );
}
