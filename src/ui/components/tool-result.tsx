/**
 * ToolResult Component for Rendering Tool Outputs
 *
 * Displays tool execution results with status indicators,
 * collapsible content, and tool-specific rendering.
 *
 * Reference: Feature 16 - Create ToolResult component for rendering tool outputs
 */

import React, { useState, useMemo } from "react";
import { useTheme } from "../theme.tsx";
import {
  getToolRenderer,
  type ToolRenderProps,
  type ToolRenderResult,
} from "../tools/registry.ts";
import type { ToolExecutionStatus } from "../hooks/use-streaming-state.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the ToolResult component.
 */
export interface ToolResultProps {
  /** Name of the tool that was executed */
  toolName: string;
  /** Input parameters passed to the tool */
  input: Record<string, unknown>;
  /** Output from the tool (if available) */
  output?: unknown;
  /** Current execution status */
  status: ToolExecutionStatus;
  /** Whether to initially show expanded (default: false for large outputs) */
  initialExpanded?: boolean;
  /** Maximum lines to show before collapsing (default: 10) */
  maxCollapsedLines?: number;
}

/**
 * Props for the StatusIndicator component.
 */
interface StatusIndicatorProps {
  status: ToolExecutionStatus;
  accentColor: string;
  errorColor: string;
  mutedColor: string;
}

/**
 * Props for the CollapsibleContent component.
 */
interface CollapsibleContentProps {
  content: string[];
  expanded: boolean;
  maxCollapsedLines: number;
  language?: string;
  onToggle: () => void;
  foregroundColor: string;
  mutedColor: string;
  borderColor: string;
}

// ============================================================================
// STATUS INDICATOR COMPONENT
// ============================================================================

/**
 * Shows the current execution status with appropriate styling.
 */
function StatusIndicator({
  status,
  accentColor,
  errorColor,
  mutedColor,
}: StatusIndicatorProps): React.ReactNode {
  const statusConfig: Record<ToolExecutionStatus, { icon: string; color: string; label: string }> = {
    pending: { icon: "○", color: mutedColor, label: "pending" },
    running: { icon: "◐", color: accentColor, label: "running" },
    completed: { icon: "●", color: accentColor, label: "done" },
    error: { icon: "✗", color: errorColor, label: "error" },
  };

  const config = statusConfig[status];

  return (
    <text style={{ fg: config.color }}>
      {config.icon} {config.label}
    </text>
  );
}

// ============================================================================
// COLLAPSIBLE CONTENT COMPONENT
// ============================================================================

/**
 * Renders content with expand/collapse functionality.
 */
function CollapsibleContent({
  content,
  expanded,
  maxCollapsedLines,
  language: _language,
  onToggle,
  foregroundColor,
  mutedColor,
  borderColor,
}: CollapsibleContentProps): React.ReactNode {
  // Determine if content should be collapsible
  const isCollapsible = content.length > maxCollapsedLines;
  const displayLines = expanded ? content : content.slice(0, maxCollapsedLines);
  const hiddenCount = content.length - maxCollapsedLines;

  return (
    <box flexDirection="column">
      {/* Content lines */}
      <box
        flexDirection="column"
        borderStyle="single"
        borderColor={borderColor}
        paddingLeft={1}
        paddingRight={1}
      >
        {displayLines.map((line, index) => (
          <text key={index} style={{ fg: foregroundColor }}>
            {line}
          </text>
        ))}
      </box>

      {/* Expand/collapse toggle */}
      {isCollapsible && (
        <box marginTop={0}>
          <text
            style={{ fg: mutedColor, attributes: 2 }}
            onClick={onToggle}
          >
            {expanded
              ? "▲ Collapse"
              : `▼ Show ${hiddenCount} more line${hiddenCount === 1 ? "" : "s"}`}
          </text>
        </box>
      )}
    </box>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Determine if content should be initially collapsed.
 */
export function shouldCollapse(
  contentLength: number,
  maxLines: number,
  initialExpanded?: boolean
): boolean {
  if (initialExpanded !== undefined) {
    return !initialExpanded;
  }
  return contentLength > maxLines;
}

/**
 * Get error color based on theme.
 */
export function getErrorColor(isDark: boolean): string {
  return isDark ? "#EF4444" : "#DC2626"; // red-500 / red-600
}

// ============================================================================
// TOOL RESULT COMPONENT
// ============================================================================

/**
 * Renders the result of a tool execution.
 *
 * Features:
 * - Tool-specific rendering using ToolResultRegistry
 * - Status indicator (pending, running, completed, error)
 * - Collapsible content for large outputs
 * - Error styling for failed executions
 *
 * @example
 * ```tsx
 * <ToolResult
 *   toolName="Read"
 *   input={{ file_path: "/path/to/file.ts" }}
 *   output="file contents here"
 *   status="completed"
 * />
 * ```
 */
export function ToolResult({
  toolName,
  input,
  output,
  status,
  initialExpanded,
  maxCollapsedLines = 10,
}: ToolResultProps): React.ReactNode {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  // Get the appropriate renderer for this tool
  const renderer = useMemo(() => getToolRenderer(toolName), [toolName]);

  // Prepare render props
  const renderProps: ToolRenderProps = useMemo(
    () => ({ input, output }),
    [input, output]
  );

  // Get rendered result
  const renderResult: ToolRenderResult = useMemo(
    () => renderer.render(renderProps),
    [renderer, renderProps]
  );

  // Get title
  const title = useMemo(
    () => renderer.getTitle(renderProps),
    [renderer, renderProps]
  );

  // Determine colors
  const isDark = theme.name === "dark";
  const errorColor = getErrorColor(isDark);

  // Determine if collapsed
  const isCollapsed = useMemo(
    () => shouldCollapse(renderResult.content.length, maxCollapsedLines, initialExpanded),
    [renderResult.content.length, maxCollapsedLines, initialExpanded]
  );

  // Initialize expanded state
  if (!expanded && !isCollapsed) {
    // Small content - always show expanded
  }

  // Header color based on status
  const headerColor = status === "error" ? errorColor : theme.colors.accent;

  return (
    <box flexDirection="column" marginBottom={1}>
      {/* Header with icon, title, and status */}
      <box flexDirection="row" gap={1} alignItems="center">
        {/* Tool icon */}
        <text style={{ fg: headerColor }}>{renderer.icon}</text>

        {/* Tool name and title */}
        <text style={{ fg: headerColor, bold: true }}>
          {toolName}
        </text>
        <text style={{ fg: theme.colors.muted }}>
          {title}
        </text>

        {/* Status indicator */}
        <StatusIndicator
          status={status}
          accentColor={theme.colors.accent}
          errorColor={errorColor}
          mutedColor={theme.colors.muted}
        />
      </box>

      {/* Content (only show when not pending) */}
      {status !== "pending" && (
        <box marginTop={0} marginLeft={2}>
          <CollapsibleContent
            content={renderResult.content}
            expanded={expanded || !isCollapsed}
            maxCollapsedLines={maxCollapsedLines}
            language={renderResult.language}
            onToggle={() => setExpanded((prev) => !prev)}
            foregroundColor={theme.colors.foreground}
            mutedColor={theme.colors.muted}
            borderColor={status === "error" ? errorColor : theme.colors.border}
          />
        </box>
      )}

      {/* Error message if status is error and output contains error info */}
      {status === "error" && typeof output === "string" && (
        <box marginTop={0} marginLeft={2}>
          <text style={{ fg: errorColor }}>
            Error: {output}
          </text>
        </box>
      )}
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ToolResult;
