/**
 * ToolResult Component for Rendering Tool Outputs
 *
 * A clean component for tool execution results using OpenTUI patterns.
 * Inspired by OpenCode's BasicTool with collapsible behavior.
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

export interface ToolResultProps {
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: ToolExecutionStatus;
  initialExpanded?: boolean;
  maxCollapsedLines?: number;
  verboseMode?: boolean;
}

export interface ToolSummary {
  text: string;
  count?: number;
}

// ============================================================================
// STATUS INDICATOR COMPONENT
// ============================================================================

const STATUS_ICONS: Record<ToolExecutionStatus, string> = {
  pending: "○",
  running: "◐",
  completed: "●",
  error: "✕",
};

function StatusIndicator({
  status,
  theme,
}: {
  status: ToolExecutionStatus;
  theme: ReturnType<typeof useTheme>["theme"];
}): React.ReactNode {
  const colors = theme.colors;

  // Status-specific colors
  const statusColors: Record<ToolExecutionStatus, string> = {
    pending: colors.muted,
    running: colors.accent,
    completed: colors.success,
    error: colors.error,
  };

  const icon = STATUS_ICONS[status];
  const color = statusColors[status];

  return (
    <text style={{ fg: color }}>
      {icon}
    </text>
  );
}

// ============================================================================
// COLLAPSIBLE CONTENT COMPONENT
// ============================================================================

interface CollapsibleContentProps {
  content: string[];
  expanded: boolean;
  maxCollapsedLines: number;
  hasError: boolean;
  theme: ReturnType<typeof useTheme>["theme"];
  language?: string;
}

function CollapsibleContent({
  content,
  expanded,
  maxCollapsedLines,
  hasError,
  theme,
  language,
}: CollapsibleContentProps): React.ReactNode {
  const colors = theme.colors;
  const isCollapsible = content.length > maxCollapsedLines;
  const displayLines = expanded ? content : content.slice(0, maxCollapsedLines);
  const hiddenCount = content.length - maxCollapsedLines;

  const borderColor = hasError ? colors.error : colors.border;
  const contentColor = hasError ? colors.error : colors.foreground;

  // Use diff styling for diff content
  const isDiff = language === "diff";

  return (
    <box flexDirection="column">
      {/* Content box */}
      <box
        flexDirection="column"
        borderStyle="rounded"
        borderColor={borderColor}
        paddingLeft={1}
        paddingRight={1}
      >
        {displayLines.map((line, index) => {
          // Apply diff coloring
          let lineColor = contentColor;
          if (isDiff) {
            if (line.startsWith("+") && !line.startsWith("+++")) {
              lineColor = colors.success;
            } else if (line.startsWith("-") && !line.startsWith("---")) {
              lineColor = colors.error;
            } else if (line.startsWith("@@")) {
              lineColor = colors.accent;
            }
          }

          return (
            <text key={index} style={{ fg: lineColor }}>
              {line || " "}
            </text>
          );
        })}
      </box>

      {/* Collapse indicator */}
      {isCollapsible && !expanded && (
        <box marginLeft={1}>
          <text style={{ fg: colors.muted }}>
            ▾ {hiddenCount} more lines
          </text>
        </box>
      )}
    </box>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

export function getErrorColor(isDark: boolean): string {
  return isDark ? "#C98A8A" : "#A86868";
}

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
      return { text: `${lineCount} line${lineCount !== 1 ? "s" : ""}`, count: lineCount };
    }
    case "Glob": {
      const fileCount = lines.length;
      return { text: `${fileCount} file${fileCount !== 1 ? "s" : ""}`, count: fileCount };
    }
    case "Grep": {
      const matchCount = lines.length;
      return { text: `${matchCount} match${matchCount !== 1 ? "es" : ""}`, count: matchCount };
    }
    case "Bash": {
      const command = (input.command as string) || "";
      const truncated = command.length > 30 ? command.slice(0, 27) + "…" : command;
      return { text: truncated || `${contentLines} lines`, count: contentLines };
    }
    case "Edit": {
      const filePath = (input.file_path as string) || "";
      const fileName = filePath.split("/").pop() || filePath;
      return { text: `→ ${fileName}`, count: undefined };
    }
    case "Write": {
      const filePath = (input.file_path as string) || "";
      const fileName = filePath.split("/").pop() || filePath;
      return { text: `→ ${fileName}`, count: undefined };
    }
    case "Task": {
      const desc = (input.description as string) || (input.prompt as string) || "";
      const truncated = desc.length > 35 ? desc.slice(0, 32) + "…" : desc;
      return { text: truncated || "complete", count: undefined };
    }
    default: {
      return { text: `${contentLines} line${contentLines !== 1 ? "s" : ""}`, count: contentLines };
    }
  }
}

// ============================================================================
// TOOL RESULT COMPONENT
// ============================================================================

export function ToolResult({
  toolName,
  input,
  output,
  status,
  initialExpanded = false,
  maxCollapsedLines = 5,
  verboseMode = false,
}: ToolResultProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [expanded, setExpanded] = useState(initialExpanded);

  const renderer = useMemo(() => getToolRenderer(toolName), [toolName]);
  const renderProps: ToolRenderProps = useMemo(() => ({ input, output }), [input, output]);
  const renderResult: ToolRenderResult = useMemo(() => renderer.render(renderProps), [renderer, renderProps]);
  const title = useMemo(() => renderer.getTitle(renderProps), [renderer, renderProps]);
  const summary = useMemo(
    () => getToolSummary(toolName, input, output, renderResult.content.length),
    [toolName, input, output, renderResult.content.length]
  );

  const isCollapsed = useMemo(
    () => shouldCollapse(renderResult.content.length, maxCollapsedLines, initialExpanded),
    [renderResult.content.length, maxCollapsedLines, initialExpanded]
  );

  useEffect(() => {
    if (verboseMode) {
      setExpanded(true);
    } else {
      setExpanded(initialExpanded);
    }
  }, [verboseMode, initialExpanded]);

  const isExpanded = verboseMode || expanded;
  const hasError = status === "error";

  // Determine icon color based on status
  const iconColor = hasError ? colors.error : colors.accent;

  return (
    <box flexDirection="column" marginBottom={1}>
      {/* Header line */}
      <box flexDirection="row" gap={1} alignItems="center">
        {/* Tool icon */}
        <text style={{ fg: iconColor }}>
          {renderer.icon}
        </text>

        {/* Tool name */}
        <text style={{ fg: colors.accent }}>
          {toolName}
        </text>

        {/* Title (e.g., filename) */}
        <text style={{ fg: colors.muted }}>
          {title}
        </text>

        {/* Status indicator */}
        <StatusIndicator status={status} theme={theme} />

        {/* Summary when collapsed */}
        {status === "completed" && !isExpanded && (
          <text style={{ fg: colors.muted }}>
            — {summary.text}
          </text>
        )}
      </box>

      {/* Content - only when not pending */}
      {status !== "pending" && renderResult.content.length > 0 && (
        <box marginTop={0} marginLeft={2}>
          <CollapsibleContent
            content={renderResult.content}
            expanded={isExpanded || !isCollapsed}
            maxCollapsedLines={maxCollapsedLines}
            hasError={hasError}
            theme={theme}
            language={renderResult.language}
          />
        </box>
      )}

      {/* Error message - separate display */}
      {hasError && typeof output === "string" && !renderResult.content.includes(output) && (
        <box marginTop={0} marginLeft={2}>
          <text style={{ fg: colors.error }}>
            {output}
          </text>
        </box>
      )}
    </box>
  );
}

export default ToolResult;
