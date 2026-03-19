import { truncateText } from "@/lib/ui/format.ts";

export function formatToolTitle(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "Edit":
    case "Write":
      return String(input.file_path || "");
    case "Bash":
      return truncateText(String(input.command || ""), 50);
    case "Glob":
    case "Grep":
      return String(input.pattern || "");
    case "Task": {
      const description = String(input.description || input.prompt || "");
      return truncateText(description, 45);
    }
    default:
      return "";
  }
}

export function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "Edit":
    case "Write":
      return input.file_path ? `file: ${input.file_path}` : "";
    case "Bash":
      return input.command ? `$ ${truncateText(String(input.command), 70)}` : "";
    case "Glob":
    case "Grep":
      return input.pattern ? `pattern: ${input.pattern}` : "";
    case "Task":
      return input.prompt ? `prompt: ${truncateText(String(input.prompt), 60)}` : "";
    default: {
      const keys = Object.keys(input).slice(0, 3);
      return keys.map((key) => `${key}: ${truncateText(String(input[key]), 30)}`).join(", ");
    }
  }
}
