/**
 * Renders an AgentPart using the existing ParallelAgentsTree component.
 * Foreground agents render as a tree, while background agents are
 * surfaced via a separate background-mode tree.
 */

import React from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { AgentPart } from "../../parts/types.ts";
import { ParallelAgentsTree, deduplicateAgents } from "../parallel-agents-tree.tsx";
import type { ParallelAgent } from "../parallel-agents-tree.tsx";
import { isBackgroundAgent, isShadowForegroundAgent } from "../../utils/background-agent-footer.ts";

export interface AgentPartDisplayProps {
  part: AgentPart;
  isLast: boolean;
  syntaxStyle?: SyntaxStyle;
}

export function getForegroundTreeAgents(
  agents: readonly ParallelAgent[],
): ParallelAgent[] {
  return agents.filter(
    (agent) => !isBackgroundAgent(agent) && !isShadowForegroundAgent(agent, agents),
  );
}

export function getBackgroundTreeAgents(
  agents: readonly ParallelAgent[],
): ParallelAgent[] {
  return agents.filter((agent) => isBackgroundAgent(agent));
}

export function hasActiveForegroundTreeAgents(
  agents: readonly ParallelAgent[],
): boolean {
  return agents.some(
    (agent) =>
      (agent.status === "running" || agent.status === "pending")
      && !isShadowForegroundAgent(agent, agents),
  );
}

export type AgentTreeDisplayMode = "foreground" | "background" | "mixed";

export function getAgentTreeDisplayMode(
  foregroundAgents: readonly ParallelAgent[],
  backgroundAgents: readonly ParallelAgent[],
): AgentTreeDisplayMode {
  if (foregroundAgents.length === 0) return "background";
  if (backgroundAgents.length === 0) return "foreground";
  return "mixed";
}

export function AgentPartDisplay({ part, syntaxStyle }: AgentPartDisplayProps): React.ReactNode {
  // Deduplicate before splitting so eager+real entries merge and
  // the `background` flag is preserved on the winner.
  const allAgents = deduplicateAgents([...part.agents]);

  if (allAgents.length === 0) {
    return null;
  }

  const foregroundAgents = getForegroundTreeAgents(allAgents);
  const backgroundAgents = getBackgroundTreeAgents(allAgents);
  const displayMode = getAgentTreeDisplayMode(foregroundAgents, backgroundAgents);

  if (displayMode === "background") {
    return (
      <ParallelAgentsTree
        agents={backgroundAgents}
        syntaxStyle={syntaxStyle}
        background
        maxVisible={5}
        noTopMargin
      />
    );
  }

  const hasActiveAgents = hasActiveForegroundTreeAgents(foregroundAgents);

  if (displayMode === "mixed") {
    return (
      <box flexDirection="column">
        <ParallelAgentsTree
          agents={foregroundAgents}
          syntaxStyle={syntaxStyle}
          compact={!hasActiveAgents}
          maxVisible={5}
          noTopMargin
        />
        <ParallelAgentsTree
          agents={backgroundAgents}
          syntaxStyle={syntaxStyle}
          background
          maxVisible={5}
        />
      </box>
    );
  }

  return (
    <ParallelAgentsTree
      agents={foregroundAgents}
      syntaxStyle={syntaxStyle}
      compact={!hasActiveAgents}
      maxVisible={5}
      noTopMargin
    />
  );
}

export default AgentPartDisplay;
