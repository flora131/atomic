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
import { AnimatedBlinkIndicator } from "./animated-blink-indicator.tsx";
import { STATUS, TREE, CONNECTOR } from "../constants/icons.ts";

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
 * Format duration in a human-readable way.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return formatDurationObj(ms).text;
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
    case "running":
    case "pending":
      return "Initializing...";
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
// SINGLE AGENT VIEW COMPONENT
// ============================================================================

/**
 * Props for SingleAgentView component.
 */
interface SingleAgentViewProps {
  agent: ParallelAgent;
  compact: boolean;
  themeColors: ThemeColors;
}

/**
 * Inline view for a single sub-agent (no tree layout).
 * Claude Code style: `● AgentType(task description)` with sub-status below.
 */
function SingleAgentView({ agent, compact, themeColors }: SingleAgentViewProps): React.ReactNode {
  const isRunning = agent.status === "running" || agent.status === "pending";
  const isCompleted = agent.status === "completed";
  const isInterrupted = agent.status === "interrupted";
  const isError = agent.status === "error";

  // Build metrics text
  const metricsParts: string[] = [];
  if (agent.toolUses !== undefined) metricsParts.push(`${agent.toolUses} tool uses`);
  if (agent.tokens !== undefined) metricsParts.push(formatTokens(agent.tokens));
  if (agent.durationMs !== undefined) metricsParts.push(formatDuration(agent.durationMs));
  const metricsText = metricsParts.join(" · ");

  // Compute sub-status text
  const subStatus = getSubStatusText(agent);

  // Done summary line: "⎿  Done (N tool uses · Nk tokens · Ns)"
  const doneSummary = isCompleted
    ? `Done${metricsText ? ` (${metricsText})` : ""}`
    : null;

  // Status indicator color
  const indicatorColor = isRunning
    ? themeColors.accent
    : isCompleted
      ? themeColors.success
      : isInterrupted
        ? themeColors.warning
        : isError
          ? themeColors.error
          : themeColors.muted;

  // Header line: "● AgentType(task description)"
  const headerText = `${agent.name}(${truncateText(agent.task, 60)})`;

  return (
    <box flexDirection="column" paddingLeft={1} marginTop={1}>
      {/* Header: ● AgentType(task) */}
      <box flexDirection="row">
        {isRunning ? (
          <text><AnimatedBlinkIndicator color={indicatorColor} /></text>
        ) : (
          <text style={{ fg: indicatorColor }}>●</text>
        )}
        <text style={{ fg: themeColors.foreground }}> {headerText}</text>
      </box>

      {/* Sub-status line when running: current tool or "Initializing…" */}
      {isRunning && subStatus && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {`     ${CONNECTOR.subStatus}  `}{truncateText(subStatus, 50)}
          </text>
        </box>
      )}

      {/* Collapsed tool uses hint */}
      {isRunning && compact && agent.toolUses !== undefined && agent.toolUses > 0 && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {"     +"}
            {agent.toolUses} more tool use{agent.toolUses !== 1 ? "s" : ""}
          </text>
        </box>
      )}

      {/* Done summary for completed agents */}
      {isCompleted && doneSummary && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {`  ${CONNECTOR.subStatus}  `}{doneSummary}
          </text>
        </box>
      )}

      {/* Error summary */}
      {isError && agent.error && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.error }}>
            {`  ${CONNECTOR.subStatus}  `}{truncateText(agent.error, 60)}
          </text>
        </box>
      )}

      {/* Interrupted summary */}
      {isInterrupted && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.warning }}>
            {`  ${CONNECTOR.subStatus}  `}Interrupted
          </text>
        </box>
      )}
    </box>
  );
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
 * Format token count with k suffix.
 */
function formatTokens(tokens: number | undefined): string {
  if (tokens === undefined) return "";
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k tokens`;
  }
  return `${tokens} tokens`;
}

/**
 * Single agent row in the tree view.
 * Follows Claude Code's parallel agent display style.
 */
function AgentRow({ agent, isLast, compact, themeColors }: AgentRowProps): React.ReactNode {
  const treeChar = isLast ? TREE.lastBranch : TREE.branch;

  // Build metrics text (tool uses and tokens) - Claude Code style
  const metricsText = [
    agent.toolUses !== undefined ? `${agent.toolUses} tool uses` : "",
    agent.tokens !== undefined ? formatTokens(agent.tokens) : "",
  ].filter(Boolean).join(" · ");

  // Compute sub-status text (currentTool or default based on status)
  const subStatus = getSubStatusText(agent);

  if (compact) {
    // Compact mode: Claude Code style - task · metrics
    const isRunning = agent.status === "running" || agent.status === "pending";
    const hasTask = agent.task.trim().length > 0;
    // For running agents, append elapsed time to sub-status
    const elapsedSuffix = isRunning ? ` (${getElapsedTime(agent.startedAt)})` : "";
    const displaySubStatus = subStatus ? `${subStatus}${elapsedSuffix}` : null;

    // Status indicator for the tree row
    const isCompleted = agent.status === "completed";
    const isError = agent.status === "error";
    const isInterrupted = agent.status === "interrupted";
    const rowIndicatorColor = isRunning
      ? themeColors.accent
      : isCompleted
        ? themeColors.success
        : isInterrupted
          ? themeColors.warning
          : isError
            ? themeColors.error
            : themeColors.muted;

    // Continuation line prefix for sub-status and hints
    const continuationPrefix = isLast ? TREE.space : TREE.vertical;

    if (!hasTask && displaySubStatus) {
      // Empty task: show agent name + sub-status inline on the tree line
      return (
        <box flexDirection="column">
          <box flexDirection="row">
            <box flexShrink={0}><text style={{ fg: themeColors.muted }}>{treeChar} </text></box>
            <box flexShrink={0}>
              {isRunning ? (
                <text><AnimatedBlinkIndicator color={rowIndicatorColor} /></text>
              ) : (
                <text style={{ fg: rowIndicatorColor }}>●</text>
              )}
            </box>
            <text style={{ fg: themeColors.foreground }}> {agent.name} </text>
            <text style={{ fg: themeColors.muted }}>
              {truncateText(displaySubStatus, 50)}
            </text>
          </box>
          {isRunning && agent.toolUses !== undefined && agent.toolUses > 0 && (
            <box flexDirection="row">
              <text style={{ fg: themeColors.muted }}>
                {continuationPrefix}{SUB_STATUS_PAD}+{agent.toolUses} more tool use{agent.toolUses !== 1 ? "s" : ""}
              </text>
            </box>
          )}
        </box>
      );
    }

    return (
      <box flexDirection="column">
        <box flexDirection="row">
          <box flexShrink={0}><text style={{ fg: themeColors.muted }}>{treeChar} </text></box>
          <box flexShrink={0}>
            {isRunning ? (
              <text><AnimatedBlinkIndicator color={rowIndicatorColor} /></text>
            ) : (
              <text style={{ fg: rowIndicatorColor }}>●</text>
            )}
          </box>
          <text style={{ fg: themeColors.foreground }}>
            {" "}{truncateText(agent.task, 40)}
          </text>
          {metricsText && (
            <text style={{ fg: themeColors.muted }}> · {metricsText}</text>
          )}
        </box>
        {/* Sub-status: current tool or default status text */}
        {displaySubStatus && (
          <box flexDirection="row">
            <text style={{ fg: themeColors.muted }}>
              {continuationPrefix}{SUB_STATUS_PAD}{CONNECTOR.subStatus}  {truncateText(displaySubStatus, 50)}
            </text>
          </box>
        )}
        {/* Collapsed tool uses hint */}
        {isRunning && agent.toolUses !== undefined && agent.toolUses > 0 && (
          <box flexDirection="row">
            <text style={{ fg: themeColors.muted }}>
              {continuationPrefix}{SUB_STATUS_PAD}+{agent.toolUses} more tool use{agent.toolUses !== 1 ? "s" : ""}
            </text>
          </box>
        )}
      </box>
    );
  }

  // Full mode: includes more details
  const isRunningFull = agent.status === "running" || agent.status === "pending";
  const isCompletedFull = agent.status === "completed";
  const isErrorFull = agent.status === "error";
  const isInterruptedFull = agent.status === "interrupted";
  const hasTaskFull = agent.task.trim().length > 0;
  const elapsedSuffixFull = isRunningFull ? ` (${getElapsedTime(agent.startedAt)})` : "";
  const displaySubStatusFull = subStatus ? `${subStatus}${elapsedSuffixFull}` : null;

  // Status indicator color for the tree row
  const fullRowIndicatorColor = isRunningFull
    ? themeColors.accent
    : isCompletedFull
      ? themeColors.success
      : isInterruptedFull
        ? themeColors.warning
        : isErrorFull
          ? themeColors.error
          : themeColors.muted;

  // Continuation line prefix for sub-status lines
  const fullContinuationPrefix = isLast ? TREE.space : TREE.vertical;

  // If task is empty, show agent name + sub-status inline on the tree line
  if (!hasTaskFull && displaySubStatusFull) {
    return (
      <box flexDirection="column">
        <box flexDirection="row">
          <box flexShrink={0}><text style={{ fg: themeColors.muted }}>{treeChar} </text></box>
          <box flexShrink={0}>
            {isRunningFull ? (
              <text><AnimatedBlinkIndicator color={fullRowIndicatorColor} /></text>
            ) : (
              <text style={{ fg: fullRowIndicatorColor }}>●</text>
            )}
          </box>
          <text style={{ fg: themeColors.foreground }}> {agent.name} </text>
          <text style={{ fg: themeColors.muted }}>
            {displaySubStatusFull}
          </text>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <box flexShrink={0}><text style={{ fg: themeColors.muted }}>{treeChar} </text></box>
        <box flexShrink={0}>
          {isRunningFull ? (
            <text><AnimatedBlinkIndicator color={fullRowIndicatorColor} /></text>
          ) : (
            <text style={{ fg: fullRowIndicatorColor }}>●</text>
          )}
        </box>
        <text style={{ fg: themeColors.foreground, attributes: 1 }}>
          {" "}{agent.task}
        </text>
        {metricsText && (
          <text style={{ fg: themeColors.muted }}> · {metricsText}</text>
        )}
      </box>
      {/* Sub-status: current tool or default status text */}
      {displaySubStatusFull && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {fullContinuationPrefix}{SUB_STATUS_PAD}{CONNECTOR.subStatus}  {displaySubStatusFull}
          </text>
        </box>
      )}
      {/* Result summary for completed agents */}
      {isCompletedFull && agent.result && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {fullContinuationPrefix}{SUB_STATUS_PAD}</text>
          <text style={{ fg: themeColors.success }}>
            {CONNECTOR.subStatus}  {truncateText(agent.result, 60)}
          </text>
        </box>
      )}
      {/* Error message for failed agents */}
      {isErrorFull && agent.error && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {fullContinuationPrefix}{SUB_STATUS_PAD}</text>
          <text style={{ fg: themeColors.error }}>
            {CONNECTOR.subStatus}  {truncateText(agent.error, 60)}
          </text>
        </box>
      )}
      {/* Interrupted message for cancelled agents */}
      {isInterruptedFull && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {fullContinuationPrefix}{SUB_STATUS_PAD}</text>
          <text style={{ fg: themeColors.warning }}>
            {CONNECTOR.subStatus}  Interrupted
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
}: ParallelAgentsTreeProps): React.ReactNode {
  const { theme } = useTheme();

  // Don't render if no agents
  if (agents.length === 0) {
    return null;
  }

  // Sort agents: running first, then pending, then completed, then error
  const sortedAgents = [...agents].sort((a, b) => {
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
  const runningCount = agents.filter(a => a.status === "running" || a.status === "background").length;
  const completedCount = agents.filter(a => a.status === "completed").length;
  const pendingCount = agents.filter(a => a.status === "pending").length;

  // Get the dominant agent type for the header
  const agentTypes = [...new Set(agents.map(a => a.name))];
  const dominantType = agentTypes.length === 1 ? agentTypes[0] : "agents";

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

  // Build header text - Claude Code style: "● Running N {Type} agents…"
  const headerIcon = runningCount > 0 ? "●" : completedCount > 0 ? "●" : "○";
  const headerColor = runningCount > 0
    ? themeColors.accent
    : interruptedCount > 0
      ? themeColors.warning
      : completedCount > 0
        ? themeColors.success
        : themeColors.muted;
  // Build header label: "Explore agent(s)" for single type, "agent(s)" for mixed types
  const buildLabel = (count: number): string => {
    if (dominantType === "agents") {
      return `${count} agent${count !== 1 ? "s" : ""}`;
    }
    return `${count} ${dominantType} agent${count !== 1 ? "s" : ""}`;
  };
  const headerText = runningCount > 0
    ? `Running ${buildLabel(runningCount)}…`
    : completedCount > 0
      ? `${buildLabel(completedCount)} finished`
      : `${buildLabel(pendingCount)} pending`;

  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      marginTop={noTopMargin ? 0 : 1}
    >
      {/* Header - Claude Code style with animated ● when running */}
      <box flexDirection="row">
        {runningCount > 0 ? (
          <text><AnimatedBlinkIndicator color={headerColor} /></text>
        ) : (
          <text style={{ fg: headerColor }}>{headerIcon}</text>
        )}
        <text style={{ fg: headerColor }}> {headerText}</text>
        {runningCount === 0 && (
          <text style={{ fg: themeColors.muted }}> (ctrl+o to expand)</text>
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
