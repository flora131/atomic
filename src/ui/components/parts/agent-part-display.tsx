/**
 * Renders an AgentPart without the dedicated sub-agent tree UI.
 *
 * Sub-agent activity is shown inline as normal blocks so tool/text output
 * remains visible in the transcript.
 */

import React, { useEffect, useMemo, useRef } from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { AgentPart } from "../../parts/types.ts";
import type { Part, ReasoningPart, TextPart, ToolPart, TaskListPart, SkillLoadPart, McpSnapshotPart, CompactionPart, TaskResultPart, WorkflowStepPart } from "../../parts/types.ts";
import { deduplicateAgents, getAgentTaskLabel, collectDoneRenderMarkers } from "../parallel-agents-tree.tsx";
import type { ParallelAgent } from "../parallel-agents-tree.tsx";
import { SPACING } from "../../constants/spacing.ts";
import { STATUS } from "../../constants/icons.ts";
import { useThemeColors } from "../../theme.tsx";
import { TextPartDisplay } from "./text-part-display.tsx";
import { ReasoningPartDisplay } from "./reasoning-part-display.tsx";
import { ToolPartDisplay } from "./tool-part-display.tsx";
import { TaskListPartDisplay } from "./task-list-part-display.tsx";
import { SkillLoadPartDisplay } from "./skill-load-part-display.tsx";
import { McpSnapshotPartDisplay } from "./mcp-snapshot-part-display.tsx";
import { CompactionPartDisplay } from "./compaction-part-display.tsx";
import { TaskResultPartDisplay } from "./task-result-part-display.tsx";
import { WorkflowStepPartDisplay } from "./workflow-step-part-display.tsx";

export interface AgentPartDisplayProps {
  part: AgentPart;
  isLast: boolean;
  syntaxStyle?: SyntaxStyle;
  onAgentDoneRendered?: (marker: { agentId: string; timestampMs: number }) => void;
}

function renderInlinePart(
  part: Part,
  isLast: boolean,
  syntaxStyle: SyntaxStyle | undefined,
): React.ReactNode {
  switch (part.type) {
    case "text":
      return <TextPartDisplay part={part as TextPart} syntaxStyle={syntaxStyle} />;
    case "reasoning":
      return <ReasoningPartDisplay part={part as ReasoningPart} isLast={isLast} syntaxStyle={syntaxStyle} />;
    case "tool":
      return <ToolPartDisplay part={part as ToolPart} />;
    case "task-list":
      return <TaskListPartDisplay part={part as TaskListPart} isLast={isLast} />;
    case "skill-load":
      return <SkillLoadPartDisplay part={part as SkillLoadPart} isLast={isLast} />;
    case "mcp-snapshot":
      return <McpSnapshotPartDisplay part={part as McpSnapshotPart} isLast={isLast} />;
    case "compaction":
      return <CompactionPartDisplay part={part as CompactionPart} isLast={isLast} />;
    case "task-result":
      return <TaskResultPartDisplay part={part as TaskResultPart} isLast={isLast} />;
    case "workflow-step":
      return <WorkflowStepPartDisplay part={part as WorkflowStepPart} isLast={isLast} />;
    case "agent":
      return null;
  }
}

function getAgentStatusIcon(status: ParallelAgent["status"]): string {
  switch (status) {
    case "completed":
      return STATUS.success;
    case "error":
      return STATUS.error;
    case "interrupted":
      return STATUS.pending;
    default:
      return STATUS.active;
  }
}

function AgentPartDisplayInner({ part, syntaxStyle, onAgentDoneRendered }: AgentPartDisplayProps): React.ReactNode {
  const allAgents = useMemo(() => deduplicateAgents(part.agents), [part.agents]);
  const doneRenderedAgentIdsRef = useRef<Set<string>>(new Set());
  const themeColors = useThemeColors();

  useEffect(() => {
    if (!onAgentDoneRendered) return;
    const markers = collectDoneRenderMarkers(allAgents, doneRenderedAgentIdsRef.current);
    if (markers.length === 0) return;
    const timestampMs = Date.now();
    for (const agentId of markers) {
      onAgentDoneRendered({ agentId, timestampMs });
    }
  }, [allAgents, onAgentDoneRendered]);

  if (allAgents.length === 0) {
    return null;
  }

  return (
    <box flexDirection="column" gap={SPACING.ELEMENT}>
      {allAgents.map((agent) => {
        const inlineParts = agent.inlineParts ?? [];
        const taskLabel = getAgentTaskLabel(agent);

        return (
          <box key={agent.id} flexDirection="column" gap={SPACING.ELEMENT}>
            <text wrapMode="word">
              <span style={{ fg: themeColors.accent }}>{getAgentStatusIcon(agent.status)}</span>
              <span style={{ fg: themeColors.foreground }}> {taskLabel}</span>
              <span style={{ fg: themeColors.muted }}> [{agent.name}]</span>
            </text>

            {inlineParts.length > 0 && (
              <box flexDirection="column" paddingLeft={2} gap={SPACING.ELEMENT}>
                {inlineParts.map((inlinePart, index) => (
                  <React.Fragment key={`${agent.id}:${inlinePart.id}`}>
                    {renderInlinePart(inlinePart, index === inlineParts.length - 1, syntaxStyle)}
                  </React.Fragment>
                ))}
              </box>
            )}
          </box>
        );
      })}
    </box>
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
