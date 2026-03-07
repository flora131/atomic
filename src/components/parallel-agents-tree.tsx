import React, { useEffect, useMemo, useRef } from "react";
import type { SyntaxStyle } from "@opentui/core";
import { getCatppuccinPalette, useThemeColors } from "@/theme/index.tsx";
import { formatDuration as formatDurationObj, truncateText } from "@/lib/ui/format.ts";
import { TREE } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";
import type { Part } from "@/state/parts/types.ts";
import { AnimatedBlinkIndicator } from "@/components/animated-blink-indicator.tsx";
import { ReasoningPartDisplay } from "@/components/message-parts/reasoning-part-display.tsx";
import { TextPartDisplay } from "@/components/message-parts/text-part-display.tsx";
import { ToolPartDisplay } from "@/components/message-parts/tool-part-display.tsx";

export { truncateText };

export type AgentStatus = "pending" | "running" | "completed" | "error" | "background" | "interrupted";

export interface ParallelAgent {
  id: string;
  taskToolCallId?: string;
  name: string;
  task: string;
  status: AgentStatus;
  model?: string;
  startedAt: string;
  durationMs?: number;
  background?: boolean;
  error?: string;
  result?: string;
  toolUses?: number;
  tokens?: number;
  thinkingMs?: number;
  currentTool?: string;
  inlineParts?: import("@/state/parts/types.ts").Part[];
}

export interface ParallelAgentsTreeProps {
  agents: ParallelAgent[];
  syntaxStyle?: SyntaxStyle;
  compact?: boolean;
  maxVisible?: number;
  noTopMargin?: boolean;
  background?: boolean;
  showExpandHint?: boolean;
  onAgentDoneRendered?: (marker: { agentId: string; timestampMs: number }) => void;
}

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

export function getAgentInlineDisplayParts(parts: ReadonlyArray<Part>): Part[] {
  return parts.filter((part) =>
    part.type === "tool"
    || part.type === "text"
    || part.type === "reasoning"
  );
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

const STATUS_PRIORITY: Record<AgentStatus, number> = {
  pending: 0,
  running: 1,
  background: 2,
  completed: 3,
  interrupted: 4,
  error: 5,
};

export function deduplicateAgents(agents: ParallelAgent[]): ParallelAgent[] {
  if (agents.length <= 1) return agents;

  const byToolCallId = new Map<string, ParallelAgent[]>();
  const ungrouped: ParallelAgent[] = [];

  for (const agent of agents) {
    if (agent.taskToolCallId) {
      const group = byToolCallId.get(agent.taskToolCallId) ?? [];
      group.push(agent);
      byToolCallId.set(agent.taskToolCallId, group);
    } else {
      ungrouped.push(agent);
    }
  }

  let anyMerged = false;
  const merged: ParallelAgent[] = [];

  for (const group of byToolCallId.values()) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }

    anyMerged = true;
    let best = group[0]!;
    for (let i = 1; i < group.length; i++) {
      const other = group[i]!;
      best = mergeAgentPair(best, other);
    }
    merged.push(best);
  }

  const fallbackDeduped = deduplicateUncorrelatedAgents([...merged, ...ungrouped]);

  if (!anyMerged && !fallbackDeduped.merged) return agents;
  return anyMerged && !fallbackDeduped.merged
    ? [...merged, ...ungrouped]
    : fallbackDeduped.agents;
}

function isTaskEquivalentToAgentName(agent: Pick<ParallelAgent, "task" | "name">): boolean {
  return agent.task.trim().toLowerCase() === agent.name.trim().toLowerCase();
}

function mergeAgentPair(a: ParallelAgent, b: ParallelAgent): ParallelAgent {
  const aHasTask = !isGenericSubagentTask(a.task);
  const bHasTask = !isGenericSubagentTask(b.task);
  let primary = bHasTask && !aHasTask ? b : a;
  if (aHasTask && bHasTask) {
    const aNameEquivalentTask = isTaskEquivalentToAgentName(a);
    const bNameEquivalentTask = isTaskEquivalentToAgentName(b);
    if (aNameEquivalentTask !== bNameEquivalentTask) {
      primary = aNameEquivalentTask ? b : a;
    }
  }
  const secondary = primary === a ? b : a;
  const primaryHasTask = !isGenericSubagentTask(primary.task);
  const secondaryHasTask = !isGenericSubagentTask(secondary.task);

  const statusA = STATUS_PRIORITY[a.status] ?? 0;
  const statusB = STATUS_PRIORITY[b.status] ?? 0;
  const statusWinner = statusB > statusA ? b : a;

  return {
    ...primary,
    id: primary.id.startsWith("tool_") ? secondary.id : primary.id,
    task: primaryHasTask ? primary.task : secondaryHasTask ? secondary.task : primary.task,
    status: statusWinner.status,
    background: a.background || b.background,
    toolUses: Math.max(a.toolUses ?? 0, b.toolUses ?? 0) || undefined,
    currentTool: a.currentTool ?? b.currentTool,
    result: a.result ?? b.result,
    error: a.error ?? b.error,
    durationMs: a.durationMs ?? b.durationMs,
    tokens: Math.max(a.tokens ?? 0, b.tokens ?? 0) || undefined,
    thinkingMs: Math.max(a.thinkingMs ?? 0, b.thinkingMs ?? 0) || undefined,
  };
}

function isLikelyEagerPlaceholder(agent: ParallelAgent): boolean {
  if (!agent.taskToolCallId) return false;
  return (
    agent.id === agent.taskToolCallId
    || agent.id.startsWith("tool_")
    || agent.taskToolCallId.startsWith("tool_")
  );
}

function canMergeByTaskCorrelation(a: ParallelAgent, b: ParallelAgent): boolean {
  const aTaskId = a.taskToolCallId;
  const bTaskId = b.taskToolCallId;

  if (aTaskId && bTaskId) {
    return aTaskId === bTaskId;
  }

  if (!aTaskId && !bTaskId) {
    return true;
  }

  const withTaskId = aTaskId ? a : b;
  return isLikelyEagerPlaceholder(withTaskId);
}

function canMergeUncorrelatedDuplicate(a: ParallelAgent, b: ParallelAgent): boolean {
  if (!canMergeByTaskCorrelation(a, b)) return false;
  if (a.name !== b.name) return false;

  const aGenericTask = isGenericSubagentTask(a.task);
  const bGenericTask = isGenericSubagentTask(b.task);
  if (aGenericTask === bGenericTask) return false;

  if (Boolean(a.background) !== Boolean(b.background)) return false;
  if (a.result && b.result && a.result !== b.result) return false;
  if (a.error && b.error && a.error !== b.error) return false;
  if (a.toolUses !== undefined && b.toolUses !== undefined && a.toolUses !== b.toolUses) return false;

  return true;
}

function deduplicateUncorrelatedAgents(agents: ParallelAgent[]): {
  agents: ParallelAgent[];
  merged: boolean;
} {
  if (agents.length <= 1) {
    return { agents, merged: false };
  }

  const consumed = new Set<number>();
  const mergedAgents: ParallelAgent[] = [];
  let merged = false;

  for (let i = 0; i < agents.length; i++) {
    if (consumed.has(i)) continue;
    const current = agents[i];
    if (!current) continue;

    let matchIndex = -1;
    for (let j = i + 1; j < agents.length; j++) {
      if (consumed.has(j)) continue;
      const candidate = agents[j];
      if (!candidate) continue;
      if (canMergeUncorrelatedDuplicate(current, candidate)) {
        matchIndex = j;
        break;
      }
    }

    if (matchIndex >= 0) {
      const match = agents[matchIndex];
      if (match) {
        mergedAgents.push(mergeAgentPair(current, match));
        consumed.add(matchIndex);
        merged = true;
        continue;
      }
    }

    mergedAgents.push(current);
  }

  return { agents: merged ? mergedAgents : agents, merged };
}

export function buildAgentHeaderLabel(count: number, dominantType: string): string {
  const normalized = dominantType.trim();
  const lower = normalized.toLowerCase();
  const plural = count !== 1;

  if (!normalized || lower === "agent" || lower === "agents") {
    return `${count} agent${plural ? "s" : ""}`;
  }

  if (lower.endsWith(" agent") || lower.endsWith(" agents")) {
    return `${count} ${normalized}`;
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

export function collectDoneRenderMarkers(
  agents: ReadonlyArray<Pick<ParallelAgent, "id" | "status">>,
  doneRenderedAgentIds: Set<string>,
): string[] {
  const visibleAgentIds = new Set(agents.map((agent) => agent.id));
  for (const agentId of Array.from(doneRenderedAgentIds)) {
    if (!visibleAgentIds.has(agentId)) {
      doneRenderedAgentIds.delete(agentId);
    }
  }

  const markers: string[] = [];
  for (const agent of agents) {
    if (agent.status === "completed") {
      if (!doneRenderedAgentIds.has(agent.id)) {
        doneRenderedAgentIds.add(agent.id);
        markers.push(agent.id);
      }
      continue;
    }
    doneRenderedAgentIds.delete(agent.id);
  }

  return markers;
}

function AgentSummaryBlock({
  agent,
  compact,
  syntaxStyle,
}: {
  agent: ParallelAgent;
  compact: boolean;
  syntaxStyle?: SyntaxStyle;
}): React.ReactNode {
  const colors = useThemeColors();
  const visibleTools = getAgentInlineDisplayParts(agent.inlineParts ?? []);
  const indicatorColor = getStatusIndicatorColor(agent.status, colors);
  const animateIndicator = shouldAnimateAgentStatus(agent.status);
  const label = truncateText(agent.name, compact ? 40 : 60);

  return (
    <box flexDirection="column">
      <text wrapMode="word">
        {animateIndicator ? (
          <AnimatedBlinkIndicator color={indicatorColor} speed={500} />
        ) : (
          <span style={{ fg: indicatorColor }}>{getStatusIcon(agent.status)}</span>
        )}
        <span style={{ fg: colors.foreground, attributes: 1 }}> {label}</span>
      </text>
      {visibleTools.map((part, index) => (
        <box key={part.id} flexDirection="row">
          <box flexShrink={0}>
            <text style={{ fg: colors.muted }}>
              {buildAgentInlineBranchPrefix("", index === visibleTools.length - 1)}
            </text>
          </box>
          <box flexGrow={1} flexShrink={1}>
            {part.type === "tool" ? (
              <ToolPartDisplay part={part} summaryOnly />
            ) : part.type === "text" ? (
              <TextPartDisplay part={part} syntaxStyle={syntaxStyle} />
            ) : part.type === "reasoning" ? (
              <ReasoningPartDisplay part={part} isLast={index === visibleTools.length - 1} syntaxStyle={syntaxStyle} />
            ) : null}
          </box>
        </box>
      ))}
    </box>
  );
}

export function ParallelAgentsTree({
  agents,
  syntaxStyle,
  compact = false,
  maxVisible = 5,
  noTopMargin = false,
  onAgentDoneRendered,
}: ParallelAgentsTreeProps): React.ReactNode {
  const allAgents = useMemo(() => deduplicateAgents(agents), [agents]);
  const visibleAgents = allAgents.slice(0, maxVisible);
  const hiddenCount = allAgents.length - visibleAgents.length;
  const colors = useThemeColors();
  const doneRenderedAgentIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!onAgentDoneRendered) return;
    const markers = collectDoneRenderMarkers(
      visibleAgents,
      doneRenderedAgentIdsRef.current,
    );
    if (markers.length === 0) return;
    const timestampMs = Date.now();
    for (const agentId of markers) {
      onAgentDoneRendered({ agentId, timestampMs });
    }
  }, [onAgentDoneRendered, visibleAgents]);

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
        <text style={{ fg: colors.muted }}>
          +{hiddenCount} more agent{hiddenCount === 1 ? "" : "s"}
        </text>
      )}
    </box>
  );
}

export default ParallelAgentsTree;
