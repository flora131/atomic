/**
 * ToolResult Component for Rendering Tool Outputs
 *
 * Displays tool execution results with status indicators,
 * collapsible content, and tool-specific rendering.
 * Default collapsed with summary line for improved UX.
 *
 * Reference: Feature 16 - Create ToolResult component for rendering tool outputs
 * Enhancement: Default collapsed with summary line
 */

import React, { useState, useMemo, useEffect } from "react";
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
  /** Whether to initially show expanded (default: false - collapsed with summary) */
  initialExpanded?: boolean;
  /** Maximum lines to show when collapsed (default: 3) */
  maxCollapsedLines?: number;
  /** Whether verbose mode is enabled (forces expanded state) */
  verboseMode?: boolean;
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
  /** Summary to display when collapsed */
  summary?: ToolSummary;
  /** Whether to show expand hint */
  showExpandHint?: boolean;
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
  summary,
  showExpandHint = true,
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
        <box marginTop={0} flexDirection="row" gap={2}>
          <text
            style={{ fg: mutedColor, attributes: 2 }}
            onClick={onToggle}
          >
            {expanded
              ? "▲ Collapse"
              : `▼ Show ${hiddenCount} more line${hiddenCount === 1 ? "" : "s"}`}
          </text>
          {/* Expand hint when collapsed */}
          {!expanded && showExpandHint && (
            <text style={{ fg: mutedColor }}>
              (ctrl+o to expand all)
            </text>
          )}
        </box>
      )}

      {/* Summary when collapsed and not expandable */}
      {!expanded && !isCollapsible && summary && (
        <box marginTop={0}>
          <text style={{ fg: mutedColor }}>
            {summary.text}
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

/**
 * Summary information for a tool result.
 */
export interface ToolSummary {
  /** Short summary text (e.g., "42 lines", "3 files") */
  text: string;
  /** Count value for display */
  count?: number;
}

/**
 * Get a summary for tool output when collapsed.
 *
 * @param toolName - The name of the tool
 * @param input - Tool input parameters
 * @param output - Tool output result
 * @param contentLines - Number of lines in rendered content
 * @returns Summary information for display
 */
export function getToolSummary(
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
  contentLines: number
): ToolSummary {
  const strOutput = typeof output === "string" ? output : "";
  const lines = strOutput.split("\n").filter((l) => l.trim().length > 0);

  switch (toolName) {
    case "Read": {
      const lineCount = lines.length || contentLines;
      return {
        text: `${lineCount} line${lineCount !== 1 ? "s" : ""}`,
        count: lineCount,
      };
    }

    case "Glob": {
      // Glob output is typically a list of file paths
      const fileCount = lines.length;
      return {
        text: `${fileCount} file${fileCount !== 1 ? "s" : ""} found`,
        count: fileCount,
      };
    }

    case "Grep": {
      // Grep output shows matching lines
      const matchCount = lines.length;
      return {
        text: `${matchCount} match${matchCount !== 1 ? "es" : ""}`,
        count: matchCount,
      };
    }

    case "Bash": {
      const command = (input.command as string) || "";
      const truncatedCmd = command.length > 30 ? command.slice(0, 27) + "..." : command;
      return {
        text: truncatedCmd || `${contentLines} lines output`,
        count: contentLines,
      };
    }

    case "Edit": {
      const filePath = (input.file_path as string) || "";
      const fileName = filePath.split("/").pop() || filePath;
      return {
        text: `edited ${fileName}`,
        count: undefined,
      };
    }

    case "Write": {
      const filePath = (input.file_path as string) || "";
      const fileName = filePath.split("/").pop() || filePath;
      const success = output === true || (typeof output === "string" && output.includes("success"));
      return {
        text: success ? `created ${fileName}` : `writing ${fileName}`,
        count: undefined,
      };
    }

    case "Task": {
      const description = (input.description as string) || (input.prompt as string) || "";
      const truncated = description.length > 40 ? description.slice(0, 37) + "..." : description;
      return {
        text: truncated || "task completed",
        count: undefined,
      };
    }

    default: {
      return {
        text: `${contentLines} line${contentLines !== 1 ? "s" : ""}`,
        count: contentLines,
      };
    }
  }
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
  initialExpanded = false,
  maxCollapsedLines = 3,
  verboseMode = false,
}: ToolResultProps): React.ReactNode {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(initialExpanded);

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

  // Get summary for collapsed display
  const summary = useMemo(
    () => getToolSummary(toolName, input, output, renderResult.content.length),
    [toolName, input, output, renderResult.content.length]
  );

  // Determine colors
  const isDark = theme.name === "dark";
  const errorColor = getErrorColor(isDark);

  // Determine if collapsed based on initialExpanded (default false = collapsed)
  const isCollapsed = useMemo(
    () => shouldCollapse(renderResult.content.length, maxCollapsedLines, initialExpanded),
    [renderResult.content.length, maxCollapsedLines, initialExpanded]
  );

  // Sync expanded state with verboseMode
  useEffect(() => {
    if (verboseMode) {
      setExpanded(true);
    } else {
      // Reset to initial state when verbose mode is disabled
      setExpanded(initialExpanded);
    }
  }, [verboseMode, initialExpanded]);

  // Header color based on status
  const headerColor = status === "error" ? errorColor : theme.colors.accent;

  // Effective expanded state (verboseMode forces expanded)
  const isExpanded = verboseMode || expanded;

  return (
    <box flexDirection="column" marginBottom={1}>
      {/* Header with icon, title, status, and summary */}
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

        {/* Summary when collapsed */}
        {status === "completed" && !isExpanded && (
          <text style={{ fg: theme.colors.muted }}>
            — {summary.text}
          </text>
        )}
      </box>

      {/* Content (only show when not pending) */}
      {status !== "pending" && (
        <box marginTop={0} marginLeft={2}>
          <CollapsibleContent
            content={renderResult.content}
            expanded={isExpanded || !isCollapsed}
            maxCollapsedLines={maxCollapsedLines}
            language={renderResult.language}
            onToggle={() => setExpanded((prev) => !prev)}
            foregroundColor={theme.colors.foreground}
            mutedColor={theme.colors.muted}
            borderColor={status === "error" ? errorColor : theme.colors.border}
            summary={summary}
            showExpandHint={!verboseMode}
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
