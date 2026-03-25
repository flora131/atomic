/**
 * ToolResult Component for Rendering Tool Outputs
 *
 * A clean component for tool execution results using OpenTUI patterns.
 * Inspired by OpenCode's BasicTool with collapsible behavior.
 */

import React, { useMemo } from "react";
import { useTheme } from "@/theme/index.tsx";
import { AnimatedBlinkIndicator } from "@/components/animated-blink-indicator.tsx";
import { STATUS, MISC } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";
import {
  getToolRenderer,
  isSdkAskQuestionToolName,
  parseMcpToolName,
  type ToolRenderResult,
} from "@/components/tool-registry/registry/index.ts";
import { SkillLoadIndicator, type SkillLoadStatus } from "@/components/skill-load-indicator.tsx";
import type { ToolExecutionStatus } from "@/state/parts/types.ts";
import {
  MAIN_CHAT_TOOL_PREVIEW_LIMITS,
  getMainChatToolMaxLines,
  truncateToolHeader,
  truncateToolLines,
  truncateToolText,
} from "@/components/tool-preview-truncation.ts";

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
}

export interface ToolSummary {
  text: string;
  count?: number;
}

type ToolStatusColorKey = "muted" | "accent" | "success" | "error" | "warning";

// ============================================================================
// STATUS INDICATOR COMPONENT
// ============================================================================

const STATUS_ICONS: Record<ToolExecutionStatus, string> = {
  pending: STATUS.pending,
  running: STATUS.active,
  completed: STATUS.active,
  error: STATUS.active,
  interrupted: STATUS.active,
};

export function getToolStatusColorKey(status: ToolExecutionStatus): ToolStatusColorKey {
  switch (status) {
    case "pending":
      return "muted";
    case "running":
      return "accent";
    case "completed":
      return "success";
    case "error":
      return "error";
    case "interrupted":
      return "warning";
  }
}

function StatusIndicator({
  status,
  theme,
}: {
  status: ToolExecutionStatus;
  theme: ReturnType<typeof useTheme>["theme"];
}): React.ReactNode {
  const colors = theme.colors;
  const color = colors[getToolStatusColorKey(status)];

  // Running state uses animated blinking ●
  if (status === "running") {
    return <text><AnimatedBlinkIndicator color={color} speed={500} /></text>;
  }

  const icon = STATUS_ICONS[status];

  return (
    <text fg={color}>
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
        paddingLeft={SPACING.CONTAINER_PAD}
        paddingRight={SPACING.CONTAINER_PAD}
      >
        {/* Index keys are safe here — list is static display lines derived from tool output, never reordered */}
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
            <text key={index} fg={lineColor}>
              {line || " "}
            </text>
          );
        })}
      </box>

      {/* Collapse indicator */}
      {isCollapsible && !expanded && (
        <box marginLeft={SPACING.CONTAINER_PAD}>
          <text fg={colors.muted}>
            {MISC.collapsed} {hiddenCount} more lines
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

export function getToolSummary(
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
  contentLines: number
): ToolSummary {
  const strOutput = typeof output === "string" ? output : "";
  const lines = strOutput.split("\n").filter((l) => l.trim().length > 0);

  // Normalize tool name to PascalCase for consistent matching
  // (Claude uses PascalCase, OpenCode/Copilot may use lowercase)
  const normalized = toolName.charAt(0).toUpperCase() + toolName.slice(1);

  switch (normalized) {
    case "Read":
    case "View": {
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
    case "Edit":
    case "Multiedit": {
      const filePath = (input.file_path as string) || "";
      const fileName = filePath.split("/").pop() || filePath;
      return { text: `→ ${fileName}`, count: undefined };
    }
    case "Write":
    case "Create": {
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
      if (isSdkAskQuestionToolName(toolName)) {
        const repoName = input.repoName;
        const repoSummary = Array.isArray(repoName)
          ? repoName.filter((value): value is string => typeof value === "string").join(", ")
          : typeof repoName === "string"
            ? repoName
            : "";
        const truncated = repoSummary.length > 35 ? `${repoSummary.slice(0, 32)}…` : repoSummary;
        return { text: truncated || "answer", count: undefined };
      }
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
}: ToolResultProps): React.ReactNode {
  const normalizedToolName = toolName.toLowerCase();
  const isSkillTool = normalizedToolName === "skill";

  // All hooks must be called unconditionally (Rules of Hooks)
  const { theme } = useTheme();
  const colors = theme.colors;
  const renderer = getToolRenderer(toolName);
  const mcpParsed = parseMcpToolName(toolName);
  const displayLabel = mcpParsed ? `${mcpParsed.server} / ${mcpParsed.tool}` : toolName;
  const maxToolPreviewLines = getMainChatToolMaxLines(toolName);
  const renderResult: ToolRenderResult = useMemo(
    () => renderer.render({ input, output }),
    [renderer, input, output],
  );
  const title = renderer.getTitle({ input, output });
  const summary = getToolSummary(toolName, input, output, renderResult.content.length);

  const linkifiedTitle = truncateToolHeader(title, MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxTitleChars);
  const truncatedDisplayLabel = truncateToolHeader(displayLabel, MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxLabelChars);
  const truncatedSummaryText = truncateToolText(summary.text, MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxSummaryChars);
  const truncatedRenderContent = truncateToolLines(renderResult.content, {
    maxLines: maxToolPreviewLines,
    maxLineChars: MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxLineChars,
  });
  const hasError = status === "error";
  const truncatedErrorLines = hasError && typeof output === "string"
    ? truncateToolLines(output.split("\n"), {
        maxLines: maxToolPreviewLines,
        maxLineChars: MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxLineChars,
      }).lines
    : [];

  const isCollapsed = shouldCollapse(truncatedRenderContent.lines.length, maxCollapsedLines, initialExpanded);

  // Skill tool: render SkillLoadIndicator directly (early return after all hooks)
  if (isSkillTool) {
    const skillName = (input.skill as string) || (input.name as string) || "unknown";
    const skillStatus: SkillLoadStatus =
      status === "completed" ? "loaded" : status === "error" ? "error" : "loading";
    const errorMessage = status === "error" && typeof output === "string" ? output : undefined;
    return (
      <box>
        <SkillLoadIndicator
          skillName={skillName}
          status={skillStatus}
          errorMessage={errorMessage}
        />
      </box>
    );
  }

  // Determine icon color based on status
  const iconColor = hasError ? colors.error : colors.accent;

  return (
    <box flexDirection="column">
      {/* Header line */}
      <box flexDirection="row" gap={SPACING.ELEMENT}>
        {/* Status indicator + icon — fixed-width prefix so they stay on line 1 */}
        <box flexDirection="row" gap={SPACING.ELEMENT} flexShrink={0} width={3}>
          <StatusIndicator status={status} theme={theme} />
          <text fg={iconColor}>
            {renderer.icon}
          </text>
        </box>

        {/* Tool name + title + summary — wraps as a single inline block */}
        <text>
          <span fg={colors.accent} attributes={1}>
            {truncatedDisplayLabel}
          </span>
          <span fg={colors.muted}>
            {" "}{linkifiedTitle}
          </span>
          {status === "completed" && !initialExpanded && (
            <span fg={colors.muted}>
              {" "}— {truncatedSummaryText} (ctrl+o to expand)
            </span>
          )}
        </text>
      </box>

      {/* Content - only when not pending */}
      {status !== "pending" && truncatedRenderContent.lines.length > 0 && (
        <box marginTop={SPACING.NONE} marginLeft={SPACING.CONTAINER_PAD}>
          <CollapsibleContent
            content={truncatedRenderContent.lines}
            expanded={initialExpanded || !isCollapsed}
            maxCollapsedLines={maxCollapsedLines}
            hasError={hasError}
            theme={theme}
            language={renderResult.language}
          />
        </box>
      )}

      {/* Error message - separate display */}
      {hasError && typeof output === "string" && !renderResult.content.includes(output) && (
        <box marginTop={SPACING.NONE} marginLeft={SPACING.CONTAINER_PAD}>
          {/* Index keys are safe here — list is static error output lines, never reordered */}
          {truncatedErrorLines.map((line, index) => (
            <text key={index} fg={colors.error}>
              {line || " "}
            </text>
          ))}
        </box>
      )}
    </box>
  );
}

export default ToolResult;
