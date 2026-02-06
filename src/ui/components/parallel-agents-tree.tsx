/**
 * ParallelAgentsTree Component
 *
 * Displays a tree view of parallel sub-agents and their execution status.
 * Inspired by Claude Code's parallel agent visualization.
 *
 * Reference: Issue #4 - Add UI for visualizing parallel agents
 */

import React from "react";
import { useTheme } from "../theme.tsx";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Status of a parallel agent.
 */
export type AgentStatus = "pending" | "running" | "completed" | "error" | "background";

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
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Status icons for different agent states.
 */
export const STATUS_ICONS: Record<AgentStatus, string> = {
  pending: "○",
  running: "◐",
  completed: "●",
  error: "✕",
  background: "◌",
};

/**
 * ANSI color codes for different agent types.
 * Used for visual distinction between concurrent agents.
 */
export const AGENT_COLORS: Record<string, string> = {
  Explore: "#60a5fa",    // Blue
  Plan: "#a78bfa",       // Purple
  Bash: "#4ade80",       // Green
  debugger: "#f87171",   // Red
  "codebase-analyzer": "#fb923c",   // Orange
  "codebase-locator": "#38bdf8",    // Cyan
  "codebase-pattern-finder": "#fbbf24",  // Yellow
  "codebase-online-researcher": "#c084fc",  // Violet
  "general-purpose": "#94a3b8",     // Slate
  default: "#9ca3af",    // Gray
};

/**
 * Tree drawing characters.
 */
const TREE_CHARS = {
  branch: "├─",
  lastBranch: "└─",
  vertical: "│ ",
  space: "  ",
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Default color for unknown agent types.
 */
const DEFAULT_AGENT_COLOR = "#9ca3af";

/**
 * Get the color for an agent based on its name/type.
 */
export function getAgentColor(agentName: string): string {
  return AGENT_COLORS[agentName] ?? DEFAULT_AGENT_COLOR;
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
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * Truncate text to a maximum length.
 */
export function truncateText(text: string, maxLength: number = 40): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
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
    default:
      return null;
  }
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
  themeColors: {
    foreground: string;
    muted: string;
    accent: string;
    error: string;
    success: string;
  };
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
  const treeChar = isLast ? TREE_CHARS.lastBranch : TREE_CHARS.branch;

  // Build metrics text (tool uses and tokens) - Claude Code style
  const metricsText = [
    agent.toolUses !== undefined ? `${agent.toolUses} tool uses` : "",
    agent.tokens !== undefined ? formatTokens(agent.tokens) : "",
  ].filter(Boolean).join(" · ");

  // Compute sub-status text (currentTool or default based on status)
  const subStatus = getSubStatusText(agent);

  if (compact) {
    // Compact mode: Claude Code style - task · metrics
    return (
      <box flexDirection="column">
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>{treeChar} </text>
          <text style={{ fg: themeColors.foreground }}>
            {truncateText(agent.task, 40)}
          </text>
          {metricsText && (
            <text style={{ fg: themeColors.muted }}> · {metricsText}</text>
          )}
        </box>
        {/* Sub-status: current tool or default status text */}
        {subStatus && (
          <box flexDirection="row">
            <text style={{ fg: themeColors.muted }}>
              {isLast ? TREE_CHARS.space : TREE_CHARS.vertical}  ⎿  </text>
            <text style={{ fg: themeColors.muted }}>
              {truncateText(subStatus, 50)}
            </text>
          </box>
        )}
      </box>
    );
  }

  // Full mode: includes more details
  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text style={{ fg: themeColors.muted }}>{treeChar} </text>
        <text style={{ fg: themeColors.foreground, attributes: 1 }}>
          {agent.task}
        </text>
        {metricsText && (
          <text style={{ fg: themeColors.muted }}> · {metricsText}</text>
        )}
      </box>
      {/* Sub-status: current tool or default status text */}
      {subStatus && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {isLast ? TREE_CHARS.space : TREE_CHARS.vertical}  ⎿  </text>
          <text style={{ fg: themeColors.muted }}>
            {subStatus}
          </text>
        </box>
      )}
      {/* Result summary for completed agents */}
      {agent.status === "completed" && agent.result && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {isLast ? TREE_CHARS.space : TREE_CHARS.vertical}  </text>
          <text style={{ fg: themeColors.success }}>
            ⎿  {truncateText(agent.result, 60)}
          </text>
        </box>
      )}
      {/* Error message for failed agents */}
      {agent.status === "error" && agent.error && (
        <box flexDirection="row">
          <text style={{ fg: themeColors.muted }}>
            {isLast ? TREE_CHARS.space : TREE_CHARS.vertical}  </text>
          <text style={{ fg: themeColors.error }}>
            ⎿  {truncateText(agent.error, 60)}
          </text>
        </box>
      )}
    </box>
  );
}

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
      error: 4,
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
  const themeColors = {
    foreground: theme.colors.foreground,
    muted: theme.colors.muted,
    accent: theme.colors.accent,
    error: "#ef4444",
    success: "#22c55e",
  };

  // Build header text - Claude Code style: "● Running N {Type} agents…"
  const headerIcon = runningCount > 0 ? "●" : completedCount > 0 ? "●" : "○";
  const headerText = runningCount > 0
    ? `Running ${runningCount} ${dominantType} agent${runningCount !== 1 ? "s" : ""}…`
    : completedCount > 0
      ? `${completedCount} ${dominantType} agent${completedCount !== 1 ? "s" : ""} finished`
      : `${pendingCount} ${dominantType} agent${pendingCount !== 1 ? "s" : ""} pending`;

  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      marginTop={1}
    >
      {/* Header - Claude Code style */}
      <box flexDirection="row">
        <text style={{ fg: runningCount > 0 ? "#fbbf24" : completedCount > 0 ? "#f87171" : themeColors.muted }}>
          {headerIcon} {headerText}
        </text>
        <text style={{ fg: themeColors.muted }}> (ctrl+o to {compact ? "expand" : "collapse"})</text>
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
            {TREE_CHARS.lastBranch} ...and {hiddenCount} more
          </text>
        </box>
      )}

      {/* Background hint - Claude Code style */}
      {runningCount > 0 && (
        <box flexDirection="row" marginTop={0}>
          <text style={{ fg: themeColors.muted }}>
            {"   "}ctrl+b ctrl+b (twice) to run in background
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
