/**
 * AgentListPartDisplay Component
 *
 * Renders an AgentListPart using the AgentListIndicator component.
 */

import React from "react";
import type { AgentListPart } from "@/state/parts/types.ts";
import { AgentListIndicator } from "@/components/agent-list-indicator.tsx";

export interface AgentListPartDisplayProps {
  part: AgentListPart;
  isLast: boolean;
}

export function AgentListPartDisplay({ part }: AgentListPartDisplayProps): React.ReactNode {
  return (
    <box flexDirection="column">
      <AgentListIndicator view={part.view} />
    </box>
  );
}

export default AgentListPartDisplay;
