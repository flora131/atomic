/** @jsxImportSource @opentui/react */
/**
 * Footer rendered inside each agent tmux window. Lives in a 1-row bottom
 * pane created by the executor (workflow) or the chat command, spawned via
 * `atomic _footer`. Mirrors the orchestrator Statusline style: a colored
 * pill on the left and right-aligned context on the right.
 *
 * Two variants:
 *   - Workflow: the window name is the left badge; right side shows the
 *     navigation hints (ctrl+g graph · ctrl+\ next). The `ctrl+b d
 *     detach` hint is surfaced in the orchestrator-window Statusline
 *     only, not duplicated into every agent pane footer.
 *   - Chat (agentType set): the provider name becomes the left pill
 *     (CLAUDE / COPILOT / OPENCODE, colored to match the workflow
 *     picker); right side shows pane name · q quit · ctrl+b d detach
 *     (tmux's default detach binding — spelled out because many Atomic
 *     users have never used tmux directly).
 */

import type { AgentType } from "../types.ts";
import type { GraphTheme } from "./graph-theme.ts";

/** Per-agent brand color, matching the workflow picker pill hues. */
const AGENT_PILL_COLOR: Record<AgentType, keyof GraphTheme> = {
  claude: "warning",
  copilot: "success",
  opencode: "mauve",
};

const DOT = "\u00B7";

export function AttachedStatusline({
  name,
  theme,
  agentType,
}: {
  name: string;
  theme: GraphTheme;
  agentType?: AgentType;
}) {
  if (agentType) {
    const pillBg = theme[AGENT_PILL_COLOR[agentType]];
    return (
      <box height={1} flexDirection="row" backgroundColor={theme.backgroundElement}>
        <box backgroundColor={pillBg} paddingLeft={1} paddingRight={1} alignItems="center">
          <text fg={theme.backgroundElement}>
            <strong>{agentType.toUpperCase()}</strong>
          </text>
        </box>

        <box flexGrow={1} />

        <box paddingRight={2} alignItems="center">
          <text>
            <span fg={theme.textMuted}>{name}</span>
            <span fg={theme.textDim}>{" " + DOT + " "}</span>
            <span fg={theme.text}>q</span>
            <span fg={theme.textMuted}> quit</span>
            <span fg={theme.textDim}>{" " + DOT + " "}</span>
            <span fg={theme.text}>ctrl+b d</span>
            <span fg={theme.textMuted}> detach</span>
          </text>
        </box>
      </box>
    );
  }

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
          <span fg={theme.textDim}>{" " + DOT + " "}</span>
          <span fg={theme.text}>{"ctrl+\\"}</span>
          <span fg={theme.textMuted}> next</span>
        </text>
      </box>
    </box>
  );
}
