/**
 * ParallelAgentsTree Component
 *
 * Displays a tree view of parallel sub-agents and their execution status.
 * Inspired by Claude Code's parallel agent visualization.
 *
 * Reference: Issue #4 - Add UI for visualizing parallel agents
 */

import React from "react";
import { useTheme, getCatppuccinPalette } from "../theme.tsx";
import { formatDuration as formatDurationObj, truncateText } from "../utils/format.ts";
import { STATUS, TREE, CONNECTOR, MISC } from "../constants/icons.ts";
import { SPACING } from "../constants/spacing.ts";
import { buildParallelAgentsHeaderHint } from "../utils/background-agent-tree-hints.ts";

// Re-export for backward compatibility
export { truncateText };

// ============================================================================
// TYPES
// ============================================================================

/**
 * Status of a parallel agent.
 */
export type AgentStatus = "pending" | "running" | "completed" | "error" | "background" | "interrupted";

/**
 * Definition of a running parallel agent.
 */
export interface ParallelAgent {
  /** Unique identifier for the agent */
  id: string;
  /** Task tool call ID that spawned this agent (used for stream ordering correlation) */
  taskToolCallId?: string;
  /** Display name of the agent (e.g., "Explore", "codebase-analyzer") */
  name: string;
  /** Brief description of what the agent is doing */
  task: string;
  /** Current status */
  status: AgentStatus;
  /** Model being used (optional) */
  model?: string;
  /** Start time in ISO format */
  startedAt: string;
  /** Duration in milliseconds (for completed agents) */
  durationMs?: number;
  /** Whether running in background */
  background?: boolean;
  /** Error message if status is "error" */
  error?: string;
  /** Agent output/result summary (for completed agents) */
  result?: string;
  /** Number of tool uses (for progress display) */
  toolUses?: number;
  /** Token count (for progress display) */
  tokens?: number;
  /** Current tool operation (e.g., "Bash: Find files...") */
  currentTool?: string;
  /** Inline parts for agent-scoped streaming content */
  inlineParts?: import("../parts/types").Part[];
}

/**
 * Props for the ParallelAgentsTree component.
 */
export interface ParallelAgentsTreeProps {
  /** List of parallel agents */
  agents: ParallelAgent[];
  /** Whether to show in compact mode (default: false) */
  compact?: boolean;
  /** Maximum agents to show before collapsing (default: 5) */
  maxVisible?: number;
  /** Remove top margin (useful when the tree is the first element in a container) */
  noTopMargin?: boolean;
  /** Render in background-agent mode (green header, "launched", background sub-status) */
  background?: boolean;
  /** Whether to show the expand/collapse keyboard hint (default: false) */
  showExpandHint?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Status icons for different agent states.
 */
export const STATUS_ICONS: Record<AgentStatus, string> = {
  pending: STATUS.pending,
  running: STATUS.active,
  completed: STATUS.active,
  error: STATUS.active,
  background: STATUS.background,
  interrupted: STATUS.active,
};

/**
 * Get theme-aware agent colors using the Catppuccin palette.
 * Maps agent types to palette colors that adapt to dark/light mode.
 */
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
    default: p.overlay0,
  };
}

/**
 * Static AGENT_COLORS for backward compatibility (Mocha/dark defaults).
 */
export const AGENT_COLORS: Record<string, string> = getAgentColors(true);

/**
 * Indentation for sub-status lines beneath a tree row.
 * Aligns the ⎿ connector directly under the start of the task text.
 *
 * Tree row layout:  `├─ ● task text`
 *                    ^^^ ^
 *   treeChar+space=3  icon=1  space+text starts at col 5
 *
 * Sub-status line:  `│    ⎿  sub-status text`
 *                    ^^ ^^^
 *   continuation=2  pad=3  => ⎿ at col 5
 */
const SUB_STATUS_PAD = "   ";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the color for an agent based on its name/type and theme mode.
 * Returns Catppuccin Mocha colors for dark mode, Latte for light mode.
 */
export function getAgentColor(agentName: string, isDark: boolean = true): string {
  const colors = getAgentColors(isDark);
  const fallback = colors["default"] as string;
  return colors[agentName] ?? fallback;
}

/**
 * Get the status icon for an agent.
 */
export function getStatusIcon(status: AgentStatus): string {
  return STATUS_ICONS[status] ?? STATUS_ICONS.pending;
}

/**
 * Get the color used for the status indicator dot.
 *
 * - completed: green (success)
 * - error: red (error)
 * - pending/interrupted: yellow (warning)
 * - running/background: muted (spinner animation conveys activity)
 */
export function getStatusIndicatorColor(
  status: AgentStatus,
  colors: Pick<ThemeColors, "muted" | "success" | "warning" | "error">,
): string {
  if (status === "completed") return colors.success;
  if (status === "error") return colors.error;
  if (status === "pending" || status === "interrupted") return colors.warning;
  return colors.muted;
}

/**
 * Format duration in a human-readable way.
 */
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

/**
 * Status priority for deduplication: higher value wins.
 */
const STATUS_PRIORITY: Record<AgentStatus, number> = {
  pending: 0,
  running: 1,
  background: 2,
  completed: 3,
  interrupted: 4,
  error: 5,
};

/**
 * Deduplicate duplicate logical sub-agents.
 *
 * Primary path: merge entries that share a `taskToolCallId`.
 * Fallback path: merge near-duplicates when one row still carries the
 * generic placeholder task and another row has the real task text.
 * This also handles mixed-correlation rows (e.g. eager Task row + SDK row)
 * when they clearly represent the same logical sub-agent.
 */
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
    // Merge all entries in the group into one
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

function mergeAgentPair(a: ParallelAgent, b: ParallelAgent): ParallelAgent {
  // Prefer the entry with a real task description
  const aHasTask = !isGenericSubagentTask(a.task);
  const bHasTask = !isGenericSubagentTask(b.task);
  const primary = bHasTask && !aHasTask ? b : a;
  const secondary = primary === a ? b : a;

  // Take the higher-priority status
  const statusA = STATUS_PRIORITY[a.status] ?? 0;
  const statusB = STATUS_PRIORITY[b.status] ?? 0;
  const statusWinner = statusB > statusA ? b : a;

  return {
    ...primary,
    // Use the real subagentId if available (non-toolId format)
    id: primary.id.startsWith("tool_") ? secondary.id : primary.id,
    task: aHasTask ? a.task : bHasTask ? b.task : primary.task,
    status: statusWinner.status,
    background: a.background || b.background,
    toolUses: Math.max(a.toolUses ?? 0, b.toolUses ?? 0) || undefined,
    currentTool: a.currentTool ?? b.currentTool,
    result: a.result ?? b.result,
    error: a.error ?? b.error,
    durationMs: a.durationMs ?? b.durationMs,
    tokens: Math.max(a.tokens ?? 0, b.tokens ?? 0) || undefined,
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

/**
 * Get elapsed time since start.
 */
export function getElapsedTime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  return formatDuration(now - start);
}

/**
 * Get default sub-status text based on agent state.
 * Shows currentTool if active, otherwise a status-appropriate default.
 */
export function getSubStatusText(agent: ParallelAgent): string | null {
  if (agent.currentTool) {
    return agent.currentTool;
  }
  switch (agent.status) {
    case "background":
      return "Running in the background (↓ to manage)";
    case "running":
    case "pending":
      return "Initializing…";
    case "completed":
      return "Done";
    case "error":
      return agent.error ?? "Error";
    case "interrupted":
      return "Interrupted";
    default:
      return null;
  }
}

export function getBackgroundSubStatusText(agent: ParallelAgent): string {
  if (agent.status === "completed") return "Done";
  if (agent.status === "error") return agent.error ?? "Error";
  if (agent.status === "interrupted") return "Interrupted";
  return `Running ${agent.name} in background…`;
}

// ============================================================================
// CLAUDE CODE COLOR CONSTANTS (ANSI 256 compatible)
// ============================================================================

// Removed hardcoded constants in favor of theme colors

// ============================================================================
// THEME COLORS TYPE
// ============================================================================

interface ThemeColors {
  foreground: string;
  muted: string;
  accent: string;
  error: string;
  success: string;
  warning: string;
}

// ============================================================================
// AGENT ROW COMPONENT
// ============================================================================

/**
 * Props for AgentRow component.
 */
interface AgentRowProps {
  agent: ParallelAgent;
  isLast: boolean;
  compact: boolean;
  themeColors: ThemeColors;
}

/**
 * Props for AgentRow component.
 */
interface BackgroundAgentRowProps {
  agent: ParallelAgent;
  isLast: boolean;
  themeColors: ThemeColors;
}

/**
 * Agent row for background-mode tree.
 * Shows task name with ● indicator and "Running in the background" sub-status.
 */
function BackgroundAgentRow({ agent, isLast, themeColors }: BackgroundAgentRowProps): React.ReactNode {
  const treeChar = isLast ? TREE.lastBranch : TREE.branch;
  const continuationPrefix = isLast ? TREE.space : TREE.vertical;
  const subStatus = getBackgroundSubStatusText(agent);

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <box flexShrink={0}><text style={{ fg: themeColors.muted }}>{treeChar}</text></box>
        <box flexShrink={0}>
          <text style={{ fg: themeColors.success }}>●</text>
        </box>
        <text style={{ fg: themeColors.foreground, attributes: 1 }}>
          {" "}{getAgentTaskLabel(agent)}
        </text>
      </box>
      {subStatus && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {continuationPrefix}{SUB_STATUS_PAD}{CONNECTOR.subStatus}  {subStatus}
          </text>
        </box>
      )}
    </box>
  );
}

/**
 * Single agent row in the tree view.
 *
 * Layout:
 *   ├─● {task}
 *   │    ╰  {agent-name}: ({N} tool uses)   — during execution
 *   │      · {currentTool}                   — active tool on separate line
 *
 *   ├─● {task}
 *   │    ╰  Initializing {agent-name}… (Ns)  — during initialization
 */
function AgentRow({ agent, isLast, compact, themeColors }: AgentRowProps): React.ReactNode {
  const treeChar = isLast ? TREE.lastBranch : TREE.branch;
  const continuationPrefix = isLast ? TREE.space : TREE.vertical;
  const isRunning = agent.status === "running" || agent.status === "pending";

  const rowIndicatorColor = getStatusIndicatorColor(agent.status, themeColors);
  const displayTask = truncateText(getAgentTaskLabel(agent), compact ? 40 : 50);

  // Build sub-status text based on agent state
  let subStatusText: string | null = null;
  if (isRunning) {
    if (agent.toolUses !== undefined && agent.toolUses > 0) {
      subStatusText = `${agent.name}: (${agent.toolUses} tool use${agent.toolUses !== 1 ? "s" : ""})`;
    } else {
      const elapsed = getElapsedTime(agent.startedAt);
      subStatusText = `Initializing ${agent.name}…${elapsed ? ` (${elapsed})` : ""}`;
    }
  } else if (agent.status === "completed") {
    subStatusText = agent.result ? truncateText(agent.result, 60) : "Done";
  } else if (agent.status === "error") {
    subStatusText = agent.error ?? "Error";
  } else if (agent.status === "interrupted") {
    subStatusText = "Interrupted";
  } else if (agent.status === "background") {
    subStatusText = `Running ${agent.name} in background…`;
  }

  // Current tool shown on separate line only during active execution
  const showCurrentTool = isRunning && agent.currentTool && agent.toolUses !== undefined && agent.toolUses > 0;

  return (
    <box flexDirection="column">
      {/* Tree row: ├─● task */}
      <box flexDirection="row">
        <box flexShrink={0}><text style={{ fg: themeColors.muted }}>{treeChar}</text></box>
        <box flexShrink={0}>
          <text style={{ fg: rowIndicatorColor }}>●</text>
        </box>
        <text style={{ fg: themeColors.foreground, attributes: 1 }}>
          {" "}{displayTask}
        </text>
      </box>
      {/* Sub-status line */}
      {subStatusText && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {continuationPrefix}{SUB_STATUS_PAD}{CONNECTOR.subStatus}  {subStatusText}
          </text>
        </box>
      )}
      {/* Current tool on separate line */}
      {showCurrentTool && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {continuationPrefix}{SUB_STATUS_PAD}  {MISC.separator} {agent.currentTool}
          </text>
        </box>
      )}
    </box>
  );
}

// ============================================================================
// ANIMATED HEADER ICON
// ============================================================================

// ============================================================================
// PARALLEL AGENTS TREE COMPONENT
// ============================================================================

/**
 * Tree view showing parallel agent execution status.
 *
 * Displays a hierarchical view of running, pending, and completed
 * sub-agents with their status, task, and results.
 *
 * @example
 * ```tsx
 * <ParallelAgentsTree
 *   agents={[
 *     { id: "1", name: "Explore", task: "Find API endpoints", status: "running", startedAt: "..." },
 *     { id: "2", name: "debugger", task: "Investigate error", status: "completed", ... },
 *   ]}
 * />
 * ```
 */
export function ParallelAgentsTree({
  agents,
  compact = false,
  maxVisible = 5,
  noTopMargin = false,
  background = false,
  showExpandHint = false,
}: ParallelAgentsTreeProps): React.ReactNode {
  const { theme } = useTheme();

  // Don't render if no agents
  if (agents.length === 0) {
    return null;
  }

  // Deduplicate agents that share the same taskToolCallId (eager + real entries)
  const dedupedAgents = deduplicateAgents(agents);

  // Sort agents: running first, then pending, then completed, then error
  const sortedAgents = [...dedupedAgents].sort((a, b) => {
    const order: Record<AgentStatus, number> = {
      running: 0,
      pending: 1,
      background: 2,
      completed: 3,
      interrupted: 4,
      error: 5,
    };
    return order[a.status] - order[b.status];
  });

  // Limit visible agents if needed
  const visibleAgents = sortedAgents.slice(0, maxVisible);
  const hiddenCount = sortedAgents.length - visibleAgents.length;

  // Count agents by status
  const runningCount = dedupedAgents.filter(a => a.status === "running" || a.status === "background").length;
  const completedCount = dedupedAgents.filter(a => a.status === "completed").length;
  const pendingCount = dedupedAgents.filter(a => a.status === "pending").length;

  // Dominant type removed — header always says "Task" for background, "agents" for foreground

  // Theme colors
  const themeColors: ThemeColors = {
    foreground: theme.colors.foreground,
    muted: theme.colors.muted,
    accent: theme.colors.accent,
    error: theme.colors.error,
    success: theme.colors.success,
    warning: theme.colors.warning,
  };

  // Single agent: use tree layout with header for consistency
  // (SingleAgentView is only used for non-tree contexts)

  // Count interrupted agents
  const interruptedCount = agents.filter(a => a.status === "interrupted").length;

  // Background mode: green dot header with "N Task agents launched"
  if (background) {
    const bgHeaderColor = themeColors.success;
    const bgHeaderText = `${agents.length} Task agent${agents.length !== 1 ? "s" : ""} launched…`;
    const bgHintText = buildParallelAgentsHeaderHint(agents, showExpandHint);

    return (
      <box
        flexDirection="column"
        paddingLeft={SPACING.CONTAINER_PAD}
        marginTop={noTopMargin ? SPACING.NONE : SPACING.ELEMENT}
      >
        {/* Background header */}
        <box flexDirection="row">
          <text style={{ fg: bgHeaderColor }}>●</text>
          <text style={{ fg: themeColors.foreground }}> {bgHeaderText}</text>
          {bgHintText !== "" && (
            <text style={{ fg: themeColors.muted }}> · {bgHintText}</text>
          )}
        </box>

        {/* Background agent tree */}
        {visibleAgents.map((agent, index) => (
          <BackgroundAgentRow
            key={agent.id}
            agent={agent}
            isLast={index === visibleAgents.length - 1 && hiddenCount === 0}
            themeColors={themeColors}
          />
        ))}

        {/* Hidden count indicator */}
        {hiddenCount > 0 && (
          <box flexDirection="row">
            <text style={{ fg: themeColors.muted }}>
              {TREE.lastBranch} ...and {hiddenCount} more
            </text>
          </box>
        )}
      </box>
    );
  }

  // Build header text - Claude Code style: "● Running N {Type} agents…"
  const headerIcon = runningCount > 0 ? "●" : completedCount > 0 ? "●" : "○";
  const headerColor = runningCount > 0
    ? themeColors.accent
    : interruptedCount > 0
      ? themeColors.warning
      : completedCount > 0
        ? themeColors.success
        : themeColors.muted;
  const headerText = runningCount > 0
    ? `Running ${runningCount} agent${runningCount !== 1 ? "s" : ""}…`
    : completedCount > 0
      ? `${completedCount} agent${completedCount !== 1 ? "s" : ""} finished`
      : `${pendingCount} agent${pendingCount !== 1 ? "s" : ""} pending`;

  // Build header hint from background agent tree hints
  const headerHintText = buildParallelAgentsHeaderHint(agents, showExpandHint);

  return (
    <box
      flexDirection="column"
      paddingLeft={SPACING.CONTAINER_PAD}
      marginTop={noTopMargin ? SPACING.NONE : SPACING.ELEMENT}
    >
      {/* Header */}
      <box flexDirection="row">
        <text style={{ fg: headerColor }}>{headerIcon}</text>
        <text style={{ fg: headerColor }}> {headerText}</text>
        {headerHintText !== "" && (
          <text style={{ fg: themeColors.muted }}> · {headerHintText}</text>
        )}
      </box>

      {/* Agent tree */}
      {visibleAgents.map((agent, index) => (
        <AgentRow
          key={agent.id}
          agent={agent}
          isLast={index === visibleAgents.length - 1 && hiddenCount === 0}
          compact={compact}
          themeColors={themeColors}
        />
      ))}

      {/* Hidden count indicator */}
      {hiddenCount > 0 && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {TREE.lastBranch} ...and {hiddenCount} more
          </text>
        </box>
      )}

    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ParallelAgentsTree;
