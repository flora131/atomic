import {
  MAIN_CHAT_TOOL_PREVIEW_LIMITS,
  truncateToolText,
} from "@/lib/ui/tool-preview-truncation.ts";
import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

const TASK_OUTPUT_PREVIEW_LINES = 8;
const TASK_FIELD_MAX_CHARS = 160;
const OPENCODE_TASK_RESULT_OPEN = "<task_result>";
const OPENCODE_TASK_RESULT_CLOSE = "</task_result>";

function getTaskTitle(props: ToolRenderProps): string {
  const description = (props.input.description as string) || (props.input.prompt as string) || "";
  const agentType = (
    (props.input.agent_type as string)
    || (props.input.subagent_type as string)
    || (props.input.agent as string)
    || ""
  );

  if (description && agentType) {
    return `${agentType}: ${description}`;
  }
  if (description) {
    return description;
  }
  if (agentType) {
    return agentType;
  }
  return "Sub-agent task";
}

function shouldHideTaskOutput(outputText: string): boolean {
  return outputText.includes(OPENCODE_TASK_RESULT_OPEN)
    && outputText.includes(OPENCODE_TASK_RESULT_CLOSE);
}

export const taskToolRenderer: ToolRenderer = {
  icon: "◉",

  getTitle(props: ToolRenderProps): string {
    return getTaskTitle(props);
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const content: string[] = [];
    const description = (props.input.description as string) || "";
    const prompt = (props.input.prompt as string) || "";
    const agentType = (
      (props.input.agent_type as string)
      || (props.input.subagent_type as string)
      || (props.input.agent as string)
      || ""
    );
    const model = (props.input.model as string) || "";
    const mode = (props.input.mode as string) || "";

    if (agentType) {
      content.push(`Agent: ${agentType}`);
    }
    if (model) {
      content.push(`Model: ${model}`);
    }
    if (mode) {
      content.push(`Mode: ${mode}`);
    }
    if (description) {
      content.push(`Task: ${truncateToolText(description, TASK_FIELD_MAX_CHARS)}`);
    }
    if (prompt) {
      content.push(`Prompt: ${truncateToolText(prompt, TASK_FIELD_MAX_CHARS)}`);
    }

    if (props.output !== undefined) {
      const outputText = typeof props.output === "string"
        ? props.output
        : JSON.stringify(props.output, null, 2);

      if (outputText.trim().length > 0 && !shouldHideTaskOutput(outputText)) {
        content.push("");
        const lines = outputText.split("\n");
        content.push(
          ...lines
            .slice(0, TASK_OUTPUT_PREVIEW_LINES)
            .map((line) => truncateToolText(line, MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxLineChars)),
        );
        if (lines.length > TASK_OUTPUT_PREVIEW_LINES) {
          content.push(`… ${lines.length - TASK_OUTPUT_PREVIEW_LINES} more lines`);
        }
      }
    }

    return {
      title: getTaskTitle(props),
      content,
      expandable: true,
    };
  },
};
