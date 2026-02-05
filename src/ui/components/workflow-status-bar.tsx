/**
 * WorkflowStatusBar Component for Progress Display
 *
 * Displays workflow execution status including type, current node,
 * iteration count, and feature progress.
 *
 * Reference: Feature 12 - Create WorkflowStatusBar component for progress display
 */

import React from "react";
import { useTheme } from "../theme.tsx";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Feature progress information.
 */
export interface FeatureProgress {
  /** Number of completed features */
  completed: number;
  /** Total number of features */
  total: number;
  /** Name of the current feature being worked on (optional) */
  currentFeature?: string;
}

/**
 * Props for the WorkflowStatusBar component.
 */
export interface WorkflowStatusBarProps {
  /** Whether a workflow is currently active */
  workflowActive: boolean;
  /** Type of the active workflow (e.g., "atomic", "ralph") */
  workflowType?: string | null;
  /** Name of the current node being executed (optional) */
  currentNode?: string | null;
  /** Current iteration number (1-based) */
  iteration?: number;
  /** Maximum number of iterations (optional) */
  maxIterations?: number;
  /** Feature progress information (optional) */
  featureProgress?: FeatureProgress | null;
  /** Number of messages queued for processing (optional) */
  queueCount?: number;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get icon for workflow type.
 */
export function getWorkflowIcon(workflowType: string | null | undefined): string {
  if (!workflowType) return "⚡";

  const lower = workflowType.toLowerCase();
  if (lower === "atomic") return "⚛";
  if (lower === "ralph" || lower.includes("ralph")) return "🔄";
  return "⚡";
}

/**
 * Format workflow type for display.
 */
export function formatWorkflowType(workflowType: string | null | undefined): string {
  if (!workflowType) return "Unknown";
  return workflowType.charAt(0).toUpperCase() + workflowType.slice(1);
}

/**
 * Format iteration display string.
 */
export function formatIteration(
  iteration: number | undefined,
  maxIterations: number | undefined
): string | null {
  if (iteration === undefined || iteration < 1) return null;
  if (maxIterations !== undefined && maxIterations > 0) {
    return `Iteration ${iteration}/${maxIterations}`;
  }
  return `Iteration ${iteration}`;
}

/**
 * Format feature progress display string.
 */
export function formatFeatureProgress(progress: FeatureProgress | null | undefined): string | null {
  if (!progress) return null;
  const { completed, total, currentFeature } = progress;

  let progressStr = `Features: ${completed}/${total}`;
  if (currentFeature) {
    // Truncate long feature names
    const maxLen = 30;
    const truncated =
      currentFeature.length > maxLen
        ? `${currentFeature.slice(0, maxLen - 3)}...`
        : currentFeature;
    progressStr += ` - ${truncated}`;
  }
  return progressStr;
}

// ============================================================================
// STATUS ITEM COMPONENT
// ============================================================================

/**
 * Props for StatusItem component.
 */
interface StatusItemProps {
  /** Text to display */
  text: string;
  /** Text color */
  color: string;
  /** Whether text should be bold */
  bold?: boolean;
  /** Whether to add separator before this item */
  separator?: boolean;
  /** Color for separator */
  separatorColor?: string;
}

/**
 * Single item in the status bar.
 */
function StatusItem({
  text,
  color,
  bold: _bold = false,
  separator = false,
  separatorColor = "#666666",
}: StatusItemProps): React.ReactNode {
  return (
    <>
      {separator && (
        <text style={{ fg: separatorColor }}> │ </text>
      )}
      <text style={{ fg: color, attributes: 1 }}>{text}</text>
    </>
  );
}

// ============================================================================
// WORKFLOW STATUS BAR COMPONENT
// ============================================================================

/**
 * Status bar showing workflow execution progress.
 *
 * Displays workflow type, current node, iteration, and feature progress
 * in a horizontal bar with theme-aware styling.
 *
 * Only renders when workflowActive is true.
 *
 * @example
 * ```tsx
 * <WorkflowStatusBar
 *   workflowActive={true}
 *   workflowType="atomic"
 *   currentNode="create_spec"
 *   iteration={2}
 *   maxIterations={5}
 *   featureProgress={{ completed: 3, total: 10, currentFeature: "Add login" }}
 * />
 * ```
 */
export function WorkflowStatusBar({
  workflowActive,
  workflowType,
  currentNode,
  iteration,
  maxIterations,
  featureProgress,
  queueCount,
}: WorkflowStatusBarProps): React.ReactNode {
  const { theme } = useTheme();

  // Don't render if workflow not active
  if (!workflowActive) {
    return null;
  }

  // Prepare display values
  const icon = getWorkflowIcon(workflowType);
  const typeName = formatWorkflowType(workflowType);
  const iterationStr = formatIteration(iteration, maxIterations);
  const progressStr = formatFeatureProgress(featureProgress);

  return (
    <box
      flexDirection="row"
      borderStyle="single"
      borderColor={theme.colors.border}
      paddingLeft={1}
      paddingRight={1}
      marginLeft={1}
      marginRight={1}
      gap={0}
    >
      {/* Workflow icon and type */}
      <StatusItem
        text={`${icon} ${typeName}`}
        color={theme.colors.accent}
        bold={true}
      />

      {/* Current node if present */}
      {currentNode && (
        <StatusItem
          text={currentNode}
          color={theme.colors.foreground}
          separator={true}
          separatorColor={theme.colors.muted}
        />
      )}

      {/* Iteration count if present */}
      {iterationStr && (
        <StatusItem
          text={iterationStr}
          color={theme.colors.muted}
          separator={true}
          separatorColor={theme.colors.muted}
        />
      )}

      {/* Feature progress if present */}
      {progressStr && (
        <StatusItem
          text={progressStr}
          color={theme.colors.muted}
          separator={true}
          separatorColor={theme.colors.muted}
        />
      )}

      {/* Queue count indicator */}
      {queueCount !== undefined && queueCount > 0 && (
        <StatusItem
          text={`📝 ${queueCount} queued`}
          color={theme.colors.accent}
          separator={true}
          separatorColor={theme.colors.muted}
        />
      )}
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default WorkflowStatusBar;
