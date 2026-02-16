/**
 * AgentPartDisplay Component
 *
 * Renders an AgentPart using the existing ParallelAgentsTree component.
 * Supports background status display with correct compact mode detection.
 */

import React from "react";
import type { AgentPart } from "../../parts/types.ts";
import { ParallelAgentsTree } from "../parallel-agents-tree.tsx";

export interface AgentPartDisplayProps {
  part: AgentPart;
  isLast: boolean;
}

export function AgentPartDisplay({ part }: AgentPartDisplayProps): React.ReactNode {
  const hasActiveAgents = part.agents.some(
    a => a.status === "running" || a.status === "pending" || a.status === "background"
  );

  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <ParallelAgentsTree
        agents={part.agents}
        compact={!hasActiveAgents}
        maxVisible={5}
      />
    </box>
  );
}

export default AgentPartDisplay;
