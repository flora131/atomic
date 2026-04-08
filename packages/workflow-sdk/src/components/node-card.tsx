/** @jsxImportSource @opentui/react */

import { lerpColor } from "./color-utils.ts";
import { useGraphTheme } from "./orchestrator-panel-contexts.ts";
import { statusColor, fmtDuration } from "./status-helpers.ts";
import { NODE_W, type LayoutNode } from "./layout.ts";

export function NodeCard({
  node,
  focused,
  pulsePhase,
  displayH,
}: {
  node: LayoutNode;
  focused: boolean;
  pulsePhase: number;
  displayH: number;
}) {
  const theme = useGraphTheme();
  const sc = statusColor(node.status, theme);
  const isPending = node.status === "pending";
  const isRunning = node.status === "running";

  // Border: running nodes smoothly pulse, others show status color
  let borderCol: string;
  if (isRunning) {
    const t = (Math.sin((pulsePhase / 32) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    borderCol = focused
      ? lerpColor(theme.warning, "#ffffff", 0.2)
      : lerpColor(theme.border, theme.warning, t);
  } else if (isPending) {
    borderCol = focused ? sc : theme.borderActive;
  } else {
    borderCol = sc;
  }

  // Background: focused nodes get a subtle status-colored tint
  const bgCol = focused ? lerpColor(theme.background, sc, 0.12) : "transparent";

  // Duration computed live from start/end timestamps
  const durCol = isPending ? theme.textDim : sc;
  const duration =
    node.startedAt !== null
      ? fmtDuration((node.endedAt ?? Date.now()) - node.startedAt)
      : "\u2014";

  return (
    <box
      position="absolute"
      left={node.x}
      top={node.y}
      width={NODE_W}
      height={displayH}
      border
      borderStyle="rounded"
      borderColor={borderCol}
      backgroundColor={bgCol}
      flexDirection="column"
      justifyContent="center"
      title={` ${node.name} `}
      titleAlignment="center"
    >
      <box alignItems="center">
        <text fg={durCol}>{duration}</text>
      </box>
    </box>
  );
}
