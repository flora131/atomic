import React, { memo, useMemo, useRef } from "react";
import type { SyntaxStyle } from "@opentui/core";
import { getCatppuccinPalette, useThemeColors } from "@/theme/index.tsx";
import { formatDuration as formatDurationObj, truncateText } from "@/lib/ui/format.ts";
import { TREE } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";
import type { Part } from "@/state/parts/types.ts";
import { AnimatedBlinkIndicator } from "@/components/animated-blink-indicator.tsx";
import { PART_REGISTRY } from "@/components/message-parts/registry.tsx";

import type { AgentStatus, ParallelAgent, ParallelAgentsTreeProps } from "@/types/parallel-agents.ts";

export { truncateText };

export const STATUS_ICONS: Record<AgentStatus, string> = {
  pending: "●",
  running: "●",
  completed: "●",
  error: "●",
  background: "●",
  interrupted: "●",
};

export function getAgentColors(isDark: boolean): Record<string, string> {
  const p = getCatppuccinPalette(isDark);
  return {
    Explore: p.blue,
    Plan: p.mauve,
    Bash: p.green,
    debugger: p.red,
    "codebase-analyzer": p.peach,
    "codebase-locator": p.sky,
    "codebase-pattern-finder": p.yellow,
    "codebase-online-researcher": p.pink,
    "general-purpose": p.subtext0,
    "default": p.overlay0,
  };
}

export const AGENT_COLORS: Record<string, string> = getAgentColors(true);

/** Part types eligible for agent inline summary display. */
const AGENT_INLINE_PART_TYPES: ReadonlySet<Part["type"]> = new Set([
  "tool",
  "text",
  "reasoning",
]);

export function getAgentInlineDisplayParts(parts: ReadonlyArray<Part>): Part[] {
  return parts.filter((part) => AGENT_INLINE_PART_TYPES.has(part.type));
}

export function buildAgentInlinePrefix(continuationPrefix: string): string {
  return `${continuationPrefix}${TREE.lastBranch} `;
}

export function buildAgentInlineBranchPrefix(
  continuationPrefix: string,
  isLast: boolean,
): string {
  const branch = isLast ? TREE.lastBranch : TREE.branch;
  return `${continuationPrefix}${branch} `;
}

export function getAgentColor(agentName: string, isDark: boolean = true): string {
  const colors = getAgentColors(isDark);
  const fallback = colors["default"] as string;
  return colors[agentName] ?? fallback;
}

export function getStatusIcon(status: AgentStatus): string {
  return STATUS_ICONS[status] ?? STATUS_ICONS.pending;
}

interface ThemeColors {
  foreground: string;
  muted: string;
  accent: string;
  error: string;
  success: string;
  warning: string;
}

export function getStatusIndicatorColor(
  status: AgentStatus,
  colors: Pick<ThemeColors, "muted" | "success" | "warning" | "error">,
): string {
  if (status === "completed") return colors.success;
  if (status === "error") return colors.error;
  if (status === "pending" || status === "interrupted") return colors.warning;
  return colors.muted;
}

export function shouldAnimateAgentStatus(status: AgentStatus): boolean {
  return status === "running" || status === "background";
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return formatDurationObj(ms).text;
}

export function isGenericSubagentTask(task: string): boolean {
  const normalized = task.trim().toLowerCase();
  return normalized === "" || normalized === "sub-agent task" || normalized === "subagent task";
}

export function getAgentTaskLabel(agent: Pick<ParallelAgent, "task" | "name">): string {
  return isGenericSubagentTask(agent.task) ? agent.name : agent.task;
}

export function buildAgentHeaderLabel(count: number, dominantType: string): string {
  const normalized = dominantType.trim();
  const lower = normalized.toLowerCase();
  const plural = count !== 1;

  if (!normalized || lower === "agent" || lower === "agents") {
    return `${count} agent${plural ? "s" : ""}`;
  }

  if (lower.endsWith(" agents")) {
    return `${count} ${normalized}`;
  }

  if (lower.endsWith(" agent")) {
    const base = normalized.slice(0, -" agent".length);
    return `${count} ${base} agent${plural ? "s" : ""}`;
  }

  return `${count} ${normalized} agent${plural ? "s" : ""}`;
}

export function getForegroundActiveAgentCount(
  agents: ReadonlyArray<Pick<ParallelAgent, "status">>,
): number {
  return agents.filter(
    (agent) => agent.status === "running" || agent.status === "pending" || agent.status === "background",
  ).length;
}

export function getForegroundHeaderText(
  agents: ReadonlyArray<Pick<ParallelAgent, "status">>,
): string {
  const activeCount = getForegroundActiveAgentCount(agents);
  if (activeCount > 0) {
    return `Running ${activeCount} agent${activeCount !== 1 ? "s" : ""}…`;
  }
  const completedCount = agents.filter((agent) => agent.status === "completed").length;
  if (completedCount > 0) {
    return `${completedCount} agent${completedCount !== 1 ? "s" : ""} finished`;
  }
  const pendingCount = agents.filter((agent) => agent.status === "pending").length;
  return `${pendingCount} agent${pendingCount !== 1 ? "s" : ""} pending`;
}

export function getElapsedTime(startedAt: string, nowMs: number = Date.now()): string {
  const start = new Date(startedAt).getTime();
  return formatDuration(nowMs - start);
}

export function getBackgroundSubStatusText(agent: ParallelAgent): string {
  if (agent.status === "completed") return "Done";
  if (agent.status === "error") return agent.error ?? "Error";
  if (agent.status === "interrupted") return "Interrupted";
  return `Running ${agent.name} in background…`;
}

function isSubagentDispatchToolName(toolName: string | undefined): boolean {
  if (!toolName) return false;
  const normalized = toolName.trim().toLowerCase();
  return normalized === "task" || normalized === "agent" || normalized === "launch_agent";
}

export function shouldRenderAgentCurrentTool(
  agent: Pick<ParallelAgent, "status" | "currentTool" | "toolUses">,
): boolean {
  const currentTool = agent.currentTool;
  if (!currentTool) {
    return false;
  }

  const toolUses = agent.toolUses ?? 0;
  if (isSubagentDispatchToolName(currentTool) && toolUses <= 1) {
    return false;
  }

  const isRunning = agent.status === "running" || agent.status === "pending";
  if (isRunning) {
    return toolUses > 0;
  }

  return true;
}

/**
 * Compute which agents have newly completed since the last call.
 * Returns the markers (agent IDs) AND a new snapshot of the tracked set,
 * so the caller can update its ref without the function mutating it directly.
 * This makes the function pure and safe under React Strict Mode double-invocation.
 */
export function collectDoneRenderMarkers(
  agents: ReadonlyArray<Pick<ParallelAgent, "id" | "status">>,
  prevDoneRenderedAgentIds: ReadonlySet<string>,
): { markers: string[]; nextDoneRenderedAgentIds: Set<string> } {
  const visibleAgentIds = new Set(agents.map((agent) => agent.id));
  const nextDoneRendered = new Set<string>();

  // Carry over previously-rendered agents that are still visible and completed
  for (const agentId of prevDoneRenderedAgentIds) {
    if (visibleAgentIds.has(agentId)) {
      // Only keep if still completed (will re-check below)
      nextDoneRendered.add(agentId);
    }
  }

  const markers: string[] = [];
  for (const agent of agents) {
    if (agent.status === "completed") {
      if (!prevDoneRenderedAgentIds.has(agent.id)) {
        markers.push(agent.id);
      }
      nextDoneRendered.add(agent.id);
    } else {
      nextDoneRendered.delete(agent.id);
    }
  }

  return { markers, nextDoneRenderedAgentIds: nextDoneRendered };
}

export const MAX_VISIBLE_INLINE_TOOLS = 3;

interface AgentSummaryBlockProps {
  agent: ParallelAgent;
  compact: boolean;
  syntaxStyle?: SyntaxStyle;
}

const AgentSummaryBlock = memo(function AgentSummaryBlock({
  agent,
  compact,
  syntaxStyle,
}: AgentSummaryBlockProps): React.ReactNode {
  const colors = useThemeColors();
  const allTools = getAgentInlineDisplayParts(agent.inlineParts ?? []);
  const hiddenToolCount = Math.max(0, allTools.length - MAX_VISIBLE_INLINE_TOOLS);
  const visibleTools = hiddenToolCount > 0
    ? allTools.slice(-MAX_VISIBLE_INLINE_TOOLS)
    : allTools;
  const indicatorColor = getStatusIndicatorColor(agent.status, colors);
  const animateIndicator = shouldAnimateAgentStatus(agent.status);
  const label = truncateText(agent.name, compact ? 40 : 60);

  return (
    <box flexDirection="column">
      <text wrapMode="word">
        {animateIndicator ? (
          <AnimatedBlinkIndicator color={indicatorColor} speed={500} />
        ) : (
          <span fg={indicatorColor}>{getStatusIcon(agent.status)}</span>
        )}
        <span fg={colors.foreground} attributes={1}> {label}</span>
      </text>
      {hiddenToolCount > 0 && (
        <box flexDirection="row">
          <box flexShrink={0}>
            <text fg={colors.muted}>
              {buildAgentInlineBranchPrefix("", false)}
            </text>
          </box>
          <box flexGrow={1} flexShrink={1}>
            <text fg={colors.muted}>
              +{hiddenToolCount} earlier tool call{hiddenToolCount === 1 ? "" : "s"}
            </text>
          </box>
        </box>
      )}
      {visibleTools.map((part, index) => {
        const Renderer = PART_REGISTRY[part.type];
        if (!Renderer) return null;

        return (
          <box key={part.id} flexDirection="row">
            <box flexShrink={0}>
              <text fg={colors.muted}>
                {buildAgentInlineBranchPrefix("", index === visibleTools.length - 1)}
              </text>
            </box>
            <box flexGrow={1} flexShrink={1}>
              <Renderer
                part={part}
                isLast={index === visibleTools.length - 1}
                syntaxStyle={syntaxStyle}
                summaryOnly
              />
            </box>
          </box>
        );
      })}
    </box>
  );
});

export function ParallelAgentsTree({
  agents,
  syntaxStyle,
  compact = false,
  maxVisible = 5,
  noTopMargin = false,
  onAgentDoneRendered,
}: ParallelAgentsTreeProps): React.ReactNode {
  const allAgents = agents;
  const visibleAgents = useMemo(() => allAgents.slice(0, maxVisible), [allAgents, maxVisible]);
  const hiddenCount = allAgents.length - visibleAgents.length;
  const colors = useThemeColors();
  const doneRenderedAgentIdsRef = useRef<Set<string>>(new Set());

  // Render-time derivation: compute done-render markers during render
  // rather than in a post-commit effect. doneRenderedAgentIdsRef serves
  // as the prevRef guard (same role as prevNotifiedRef in autocomplete.tsx).
  if (onAgentDoneRendered) {
    const { markers, nextDoneRenderedAgentIds } = collectDoneRenderMarkers(
      visibleAgents,
      doneRenderedAgentIdsRef.current,
    );
    if (markers.length > 0) {
      doneRenderedAgentIdsRef.current = nextDoneRenderedAgentIds;
      const timestampMs = Date.now();
      for (const agentId of markers) {
        onAgentDoneRendered({ agentId, timestampMs });
      }
    }
  }

  if (visibleAgents.length === 0) {
    return null;
  }

  return (
    <box
      flexDirection="column"
      gap={SPACING.ELEMENT}
      marginTop={noTopMargin ? SPACING.NONE : SPACING.ELEMENT}
    >
      {visibleAgents.map((agent) => (
        <AgentSummaryBlock
          key={agent.id}
          agent={agent}
          compact={compact}
          syntaxStyle={syntaxStyle}
        />
      ))}
      {hiddenCount > 0 && (
        <text fg={colors.muted}>
          +{hiddenCount} more agent{hiddenCount === 1 ? "" : "s"}
        </text>
      )}
    </box>
  );
}

export default ParallelAgentsTree;
