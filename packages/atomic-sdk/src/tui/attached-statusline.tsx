/**
 * JSX equivalent of the attached-mode footer, authored against the
 * tui sub-package's `<Box>`, `<Text>`, and `<Footer>` intrinsics.
 * Compiles to a tmux/psmux format string via `renderFooter`.
 *
 * Two top-level variants:
 *   - workflow (no agentType): a single tmux conditional that picks
 *     between an orchestrator branch (GRAPH badge + graph-mode hints)
 *     and an agent branch (window-name pill + agent-mode hints) based
 *     on `#{window_name}`. Mirrors the catppuccin-theme pattern that
 *     is known to render correctly on psmux 3.3.3 — no nested
 *     conditionals, no user-option indirection.
 *   - chat (agentType set): single-window session, no conditional —
 *     just the agent-type pill + detach hint.
 *
 * Dynamic content (bg-task counter, attach-flash message) was
 * deliberately removed for now: psmux 3.3.3's status-line render
 * path mishandles nested `#{?…}` conditionals and a few escape
 * patterns we'd need. We can layer that back in later by having the
 * orchestrator panel push fully-styled segments into single
 * `@atomic-…` user-options the format string references inline.
 */

import type { ReactNode } from "react";

import { Box, Footer, Text } from "./components.tsx";
import type { GraphTheme } from "../components/graph-theme.ts";
import type { AgentType } from "../types.ts";

const AGENT_PILL_COLOR: Record<AgentType, keyof GraphTheme> = {
  claude: "warning",
  copilot: "success",
  opencode: "mauve",
};

const DOT = "·";

/** Window name used by `runtime/tmux.ts:createSession` for the orchestrator. */
export const ORCHESTRATOR_WINDOW_NAME = "orchestrator";

/**
 * Wrap two ReactNodes in a single tmux conditional that selects
 * between them based on whether the active window is the orchestrator
 * window. The compiler emits children sequentially as strings, so the
 * result has the shape
 * `#{?#{==:#{window_name},orchestrator},<orch>,<agent>}`.
 *
 * Pure — no side effects. The cond's only comma is inside the
 * brace-balanced `#{==:…}` substitution, which tmux's parser handles
 * correctly. Branch content uses space-separated style attributes
 * (see `compiler/styles.ts`) so the only commas at the conditional's
 * top level are its two separators.
 */
function whenOrchestrator(orch: ReactNode, agent: ReactNode): ReactNode {
  return [
    `#{?#{==:#{window_name},${ORCHESTRATOR_WINDOW_NAME}},`,
    orch,
    ",",
    agent,
    "}",
  ];
}

export function attachedStatusline(args: {
  name: string;
  theme: GraphTheme;
  agentType?: AgentType;
}): ReactNode {
  const { name, theme, agentType } = args;

  if (agentType) {
    const pillBg = theme[AGENT_PILL_COLOR[agentType]];
    return (
      <Footer
        position="bottom"
        bg={theme.backgroundElement}
        fg={theme.text}
      >
        <Footer.Left>
          <Box bg={pillBg} paddingLeft={1} paddingRight={1}>
            <Text fg={theme.backgroundElement} bold>
              {agentType.toUpperCase()}
            </Text>
          </Box>
        </Footer.Left>
        <Footer.Right>
          <Box paddingRight={2}>
            <Text fg={theme.textMuted}>{name}</Text>
            <Text fg={theme.textDim}>{` ${DOT} `}</Text>
            <Text fg={theme.text}>ctrl+b d</Text>
            <Text fg={theme.textMuted}> detach</Text>
          </Box>
        </Footer.Right>
      </Footer>
    );
  }

  const orchLeft = (
    <Box bg={theme.primary} paddingLeft={1} paddingRight={1}>
      <Text fg={theme.backgroundElement} bold>
        GRAPH
      </Text>
    </Box>
  );
  const agentLeft = (
    <Box bg={theme.primary} paddingLeft={1} paddingRight={1}>
      <Text fg={theme.backgroundElement} bold>
        {"#{window_name}"}
      </Text>
    </Box>
  );

  const orchRight = (
    <Box paddingRight={2}>
      <Text fg={theme.text}>{"↑↓←→"}</Text>
      <Text fg={theme.textMuted}> navigate</Text>
      <Text fg={theme.textDim}>{` ${DOT} `}</Text>
      <Text fg={theme.text}>{"↵"}</Text>
      <Text fg={theme.textMuted}> attach</Text>
      <Text fg={theme.textDim}>{` ${DOT} `}</Text>
      <Text fg={theme.text}>/</Text>
      <Text fg={theme.textMuted}> stages</Text>
      <Text fg={theme.textDim}>{` ${DOT} `}</Text>
      <Text fg={theme.text}>ctrl+b d</Text>
      <Text fg={theme.textMuted}> detach</Text>
      <Text fg={theme.textDim}>{` ${DOT} `}</Text>
      <Text fg={theme.text}>q</Text>
      <Text fg={theme.textMuted}> quit</Text>
    </Box>
  );
  const agentRight = (
    <Box paddingRight={2}>
      <Text fg={theme.text}>ctrl+g</Text>
      <Text fg={theme.textMuted}> graph</Text>
      <Text fg={theme.textDim}>{` ${DOT} `}</Text>
      <Text fg={theme.text}>ctrl+\</Text>
      <Text fg={theme.textMuted}> next</Text>
    </Box>
  );

  return (
    <Footer position="bottom" bg={theme.backgroundElement} fg={theme.text}>
      <Footer.Left>{whenOrchestrator(orchLeft, agentLeft)}</Footer.Left>
      <Footer.Right>{whenOrchestrator(orchRight, agentRight)}</Footer.Right>
    </Footer>
  );
}
