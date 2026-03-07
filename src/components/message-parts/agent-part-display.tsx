/**
 * Renders AgentPart content using the summary-only sub-agent block UI.
 */

import React from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { AgentPart } from "@/state/parts/types.ts";
import { ParallelAgentsTree } from "@/components/parallel-agents-tree.tsx";

export interface AgentPartDisplayProps {
  part: AgentPart;
  isLast: boolean;
  syntaxStyle?: SyntaxStyle;
  onAgentDoneRendered?: (marker: { agentId: string; timestampMs: number }) => void;
}

function AgentPartDisplayInner({
  part,
  syntaxStyle,
  onAgentDoneRendered,
}: AgentPartDisplayProps): React.ReactNode {
  if (part.agents.length === 0) {
    return null;
  }

  return (
    <ParallelAgentsTree
      agents={part.agents}
      syntaxStyle={syntaxStyle}
      noTopMargin
      onAgentDoneRendered={onAgentDoneRendered}
    />
  );
}

const MemoizedAgentPartDisplay = React.memo(
  AgentPartDisplayInner,
  (prev, next) =>
    prev.part === next.part
    && prev.syntaxStyle === next.syntaxStyle
    && prev.isLast === next.isLast
    && prev.onAgentDoneRendered === next.onAgentDoneRendered,
);

MemoizedAgentPartDisplay.displayName = "AgentPartDisplay";

export function AgentPartDisplay(props: AgentPartDisplayProps): React.ReactNode {
  return <MemoizedAgentPartDisplay {...props} />;
}

export default AgentPartDisplay;
