/**
 * Parallel Agents Types Module
 *
 * Type definitions for parallel/background agent state and display.
 * Used across components, state management, and utility modules.
 */

import type { SyntaxStyle } from "@opentui/core";
import type { Part } from "@/state/parts/types.ts";

// ============================================================================
// AGENT STATUS
// ============================================================================

export type AgentStatus = "pending" | "running" | "completed" | "error" | "background" | "interrupted";

// ============================================================================
// PARALLEL AGENT
// ============================================================================

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
  inlineParts?: Part[];
}

// ============================================================================
// PARALLEL AGENTS TREE PROPS
// ============================================================================

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
