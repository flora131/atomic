import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

const SDK_ASK_QUESTION_TOOL_NAMES = new Set(["ask_question", "askquestion"]);

function toQuestionText(input: Record<string, unknown>): string {
  const question = input.question;
  return typeof question === "string" && question.trim().length > 0
    ? question.trim()
    : "Ask question";
}

function toRepoLabel(input: Record<string, unknown>): string | null {
  const repoName = input.repoName;
  if (typeof repoName === "string" && repoName.trim().length > 0) {
    return repoName.trim();
  }

  if (Array.isArray(repoName)) {
    const repos = repoName
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (repos.length > 0) {
      return repos.join(", ");
    }
  }

  return null;
}

function toOutputLines(output: unknown): string[] {
  if (output === undefined) {
    return [];
  }

  if (typeof output === "string") {
    return output.split("\n");
  }

  return JSON.stringify(output, null, 2).split("\n");
}

export function isSdkAskQuestionToolName(toolName: string): boolean {
  return SDK_ASK_QUESTION_TOOL_NAMES.has(toolName.trim().toLowerCase());
}

export const askQuestionToolRenderer: ToolRenderer = {
  icon: "?",

  getTitle(props: ToolRenderProps): string {
    return toQuestionText(props.input);
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const content: string[] = [];
    const repoLabel = toRepoLabel(props.input);

    if (repoLabel) {
      content.push(`Repository: ${repoLabel}`);
    }

    content.push("Question:");
    content.push(toQuestionText(props.input));

    const outputLines = toOutputLines(props.output);
    if (outputLines.length > 0) {
      content.push("");
      content.push("Answer:");
      content.push(...outputLines);
    }

    return {
      title: toQuestionText(props.input),
      content,
      expandable: true,
    };
  },
};
