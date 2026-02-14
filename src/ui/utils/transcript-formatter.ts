/**
 * Transcript Formatter
 *
 * Pure function that converts ChatMessage[] into structured transcript lines
 * for the full-screen transcript view (ctrl+o toggle).
 */

import type { ChatMessage, StreamingMeta } from "../chat.tsx";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import { formatDuration } from "../components/parallel-agents-tree.tsx";
import { truncateText, formatTimestamp as formatTimestampFull } from "./format.ts";
import { getHitlResponseRecord } from "./hitl-response.ts";
import { STATUS, TREE, CONNECTOR, PROMPT, SPINNER_FRAMES, SPINNER_COMPLETE, SEPARATOR, MISC } from "../constants/icons.ts";

// ============================================================================
// TYPES
// ============================================================================

export type TranscriptLineType =
  | "user-prompt"
  | "file-read"
  | "thinking-header"
  | "thinking-content"
  | "timestamp"
  | "assistant-bullet"
  | "assistant-text"
  | "tool-header"
  | "tool-content"
  | "agent-header"
  | "agent-row"
  | "agent-substatus"
  | "separator"
  | "footer"
  | "blank";

export interface TranscriptLine {
  type: TranscriptLineType;
  content: string;
  indent: number;
}

export interface FormatTranscriptOptions {
  messages: ChatMessage[];
  liveThinkingText?: string;
  liveParallelAgents?: ParallelAgent[];
  streamingMeta?: StreamingMeta | null;
  isStreaming: boolean;
  modelId?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTimestamp(iso: string): string {
  return formatTimestampFull(iso).text;
}

function line(type: TranscriptLineType, content: string, indent = 0): TranscriptLine {
  return { type, content, indent };
}

// ============================================================================
// MAIN FORMATTER
// ============================================================================

/**
 * Format messages into structured transcript lines for the transcript view.
 *
 * Format matches the expanded transcript reference:
 * - User messages: `❯ <content>` with `⎿  Read/Loaded` file lines
 * - Thinking: `∴ Thinking…` header + indented content
 * - Timestamps: `HH:MM AM/PM model-id`
 * - Assistant: `● <content>` bullet prefix
 * - Tool calls: tool name, args, status, output summary
 * - Agent trees: `● AgentType(task)` with prompts, sub-tool lists, `⎿  Done (metrics)`
 * - Footer: `──── Showing detailed transcript · ctrl+o to toggle`
 */
export function formatTranscript(options: FormatTranscriptOptions): TranscriptLine[] {
  const { messages, liveThinkingText, liveParallelAgents, streamingMeta, isStreaming, modelId } = options;
  const lines: TranscriptLine[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      // User prompt line
      lines.push(line("user-prompt", `${PROMPT.cursor} ${msg.content}`));

      // Files read via @mention
      if (msg.filesRead && msg.filesRead.length > 0) {
        for (const file of msg.filesRead) {
          const sizeKb = file.sizeBytes ? `(${(file.sizeBytes / 1024).toFixed(1)}KB)` : "";
          lines.push(line("file-read", `${CONNECTOR.subStatus}  Read ${file.path} ${sizeKb}`, 1));
        }
      }

      lines.push(line("blank", ""));
    } else if (msg.role === "assistant") {
      // Thinking trace (baked from completed message or live)
      const thinkingContent = msg.thinkingText || (!msg.streaming ? undefined : liveThinkingText);
      if (thinkingContent) {
        lines.push(line("thinking-header", `${MISC.thinking} Thinking…`));
        // Split thinking text into lines, indent each
        const thinkingLines = thinkingContent.split("\n");
        for (const tl of thinkingLines) {
          if (tl.trim()) {
            lines.push(line("thinking-content", tl, 1));
          }
        }
        lines.push(line("blank", ""));
      }

      // Timestamp
      const ts = formatTimestamp(msg.timestamp);
      const modelLabel = msg.modelId || modelId || "";
      if (modelLabel) {
        lines.push(line("timestamp", `${ts} ${modelLabel}`));
      }

      // Assistant text content — split into segments around tool calls
      const content = msg.content;
      if (content.trim()) {
        const contentLines = content.split("\n");
        const firstLine = contentLines[0]?.trim();
        if (firstLine) {
          lines.push(line("assistant-bullet", `${STATUS.active} ${firstLine}`));
        }
        for (let i = 1; i < contentLines.length; i++) {
          const cl = contentLines[i];
          if (cl !== undefined) {
            lines.push(line("assistant-text", `  ${cl}`, 1));
          }
        }
      }

      // Tool calls
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          const isHitlTool = tc.toolName === "AskUserQuestion"
            || tc.toolName === "question"
            || tc.toolName === "ask_user";
          if (isHitlTool) {
            const statusIcon = tc.status === "completed"
              ? STATUS.active
              : tc.status === "running"
                ? STATUS.active
                : tc.status === "error"
                  ? STATUS.error
                  : STATUS.pending;
            lines.push(line("tool-header", `${statusIcon} ${tc.toolName}`));

            const questions = tc.input.questions as Array<{ question?: string }> | undefined;
            const questionText = (tc.input.question as string)
              || questions?.[0]?.question
              || "";
            if (questionText) {
              lines.push(line("tool-content", `  ${questionText}`, 1));
            }

            const hitlResponse = getHitlResponseRecord(tc);
            if (hitlResponse) {
              lines.push(line("tool-content", `  ${PROMPT.cursor} ${hitlResponse.displayText}`, 1));
            }
            continue;
          }

          const statusIcon = tc.status === "completed" ? STATUS.active : tc.status === "running" ? STATUS.active : tc.status === "error" ? STATUS.error : STATUS.pending;
          const toolTitle = formatToolTitle(tc.toolName, tc.input);
          lines.push(line("tool-header", `${statusIcon} ${tc.toolName} ${toolTitle}`));

          // Tool input details
          const inputSummary = formatToolInput(tc.toolName, tc.input);
          if (inputSummary) {
            lines.push(line("tool-content", `  ${inputSummary}`, 1));
          }

          // Tool output summary
          if (tc.output !== undefined) {
            const outputStr = typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output);
            const outputLines = outputStr.split("\n").filter((l: string) => l.trim());
            const previewCount = Math.min(outputLines.length, 8);
            for (let i = 0; i < previewCount; i++) {
              lines.push(line("tool-content", `  ${outputLines[i]}`, 1));
            }
            if (outputLines.length > previewCount) {
              lines.push(line("tool-content", `  … ${outputLines.length - previewCount} more lines`, 1));
            }
          }
        }
      }

      // Parallel agents (baked from completed message or live)
      const agents = msg.parallelAgents && msg.parallelAgents.length > 0
        ? msg.parallelAgents
        : msg.streaming && liveParallelAgents && liveParallelAgents.length > 0
          ? liveParallelAgents
          : null;

      if (agents) {
        lines.push(line("blank", ""));
        const runningCount = agents.filter(a => a.status === "running" || a.status === "pending").length;
        const completedCount = agents.filter(a => a.status === "completed").length;
        const headerText = runningCount > 0
          ? `${STATUS.active} Running ${runningCount} agent${runningCount !== 1 ? "s" : ""}…`
          : `${STATUS.active} ${completedCount} agent${completedCount !== 1 ? "s" : ""} finished`;
        lines.push(line("agent-header", headerText));

        for (const agent of agents) {
          const taskText = truncateText(agent.task, 60);
          const metricsParts: string[] = [];
          if (agent.toolUses !== undefined) metricsParts.push(`${agent.toolUses} tool uses`);
          if (agent.durationMs !== undefined) metricsParts.push(formatDuration(agent.durationMs));
          const metrics = metricsParts.length > 0 ? ` · ${metricsParts.join(" · ")}` : "";

          const agentIcon = agent.status === "completed" ? STATUS.active : agent.status === "running" ? STATUS.active : STATUS.pending;
          lines.push(line("agent-row", `${TREE.branch} ${agentIcon} ${taskText}${metrics}`));

          // Sub-status
          if (agent.status === "completed") {
            const resultText = agent.result ? truncateText(agent.result, 60) : "Done";
            lines.push(line("agent-substatus", `${TREE.vertical} ${CONNECTOR.subStatus}  ${resultText}${metrics ? ` (${metricsParts.join(" · ")})` : ""}`));
          } else if (agent.status === "running" && agent.currentTool) {
            lines.push(line("agent-substatus", `${TREE.vertical} ${CONNECTOR.subStatus}  ${truncateText(agent.currentTool, 50)}`));
          } else if (agent.status === "error" && agent.error) {
            lines.push(line("agent-substatus", `${TREE.vertical} ${CONNECTOR.subStatus}  ${truncateText(agent.error, 60)}`));
          }
        }
      }

      // Completion summary
      if (!msg.streaming && msg.durationMs != null && msg.durationMs >= 1000) {
        lines.push(line("blank", ""));
        const dur = formatDuration(msg.durationMs);
        const tokensLabel = msg.outputTokens ? ` · ${msg.outputTokens} tokens` : "";
        lines.push(line("separator", `${SPINNER_COMPLETE} Worked for ${dur}${tokensLabel}`));
      }

      lines.push(line("blank", ""));
    } else if (msg.role === "system") {
      lines.push(line("assistant-text", `⚠ ${msg.content}`));
      lines.push(line("blank", ""));
    }
  }

  // Live streaming indicator
  if (isStreaming && streamingMeta) {
    const thinkingLabel = streamingMeta.thinkingMs > 0
      ? ` · thinking ${formatDuration(streamingMeta.thinkingMs)}`
      : "";
    const tokenLabel = streamingMeta.outputTokens > 0
      ? ` · ${streamingMeta.outputTokens} tokens`
      : "";
    lines.push(line("separator", `${SPINNER_FRAMES[0]} Streaming…${thinkingLabel}${tokenLabel}`));
  }

  // Footer
  lines.push(line("separator", SEPARATOR.line.repeat(25)));
  lines.push(line("footer", "  Showing detailed transcript · ctrl+o to toggle"));

  return lines;
}

// ============================================================================
// TOOL FORMATTING HELPERS
// ============================================================================

function formatToolTitle(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
      return String(input.file_path || "");
    case "Edit":
      return String(input.file_path || "");
    case "Write":
      return String(input.file_path || "");
    case "Bash":
      return truncateText(String(input.command || ""), 50);
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return truncateText(String(input.pattern || ""), 40);
    case "Task": {
      const desc = String(input.description || input.prompt || "");
      return truncateText(desc, 45);
    }
    default:
      return "";
  }
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
      return input.file_path ? `file: ${input.file_path}` : "";
    case "Edit":
      return input.file_path ? `file: ${input.file_path}` : "";
    case "Write":
      return input.file_path ? `file: ${input.file_path}` : "";
    case "Bash":
      return input.command ? `$ ${truncateText(String(input.command), 70)}` : "";
    case "Glob":
      return input.pattern ? `pattern: ${input.pattern}` : "";
    case "Grep":
      return input.pattern ? `pattern: ${input.pattern}` : "";
    case "Task":
      return input.prompt ? `prompt: ${truncateText(String(input.prompt), 60)}` : "";
    default: {
      const keys = Object.keys(input).slice(0, 3);
      return keys.map(k => `${k}: ${truncateText(String(input[k]), 30)}`).join(", ");
    }
  }
}
