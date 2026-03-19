import { getToolRenderer, parseMcpToolName } from "@/components/tool-registry/registry/index.ts";
import { collapseNewlines, truncateText } from "@/lib/ui/format.ts";

export function getSubagentToolDisplayName(toolName: string): string {
  const parsed = parseMcpToolName(toolName);
  if (parsed) {
    return `${parsed.server}/${parsed.tool}`;
  }

  if (toolName.length === 0) {
    return "Tool";
  }

  return toolName.charAt(0).toUpperCase() + toolName.slice(1);
}

function basename(path: string): string {
  const normalized = path.trim();
  if (normalized.length === 0) {
    return normalized;
  }
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function extractPathList(input: Record<string, unknown>): string[] {
  const listCandidates = [
    input.paths,
    input.filePaths,
    input.file_paths,
    input.files,
  ];

  for (const candidate of listCandidates) {
    const values = asStringArray(candidate);
    if (values.length > 0) {
      return values;
    }
  }

  const singleCandidates = [
    input.path,
    input.filePath,
    input.file_path,
    input.filename,
    input.file,
  ];

  for (const candidate of singleCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return [candidate.trim()];
    }
  }

  return [];
}

function formatPathList(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined;
  }

  const baseNames = paths.map(basename);
  if (baseNames.length <= 2) {
    return baseNames.join(", ");
  }

  return `${baseNames.slice(0, 2).join(", ")} +${baseNames.length - 2} more`;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function summarizeSearchLikeTool(
  toolLabel: string,
  input: Record<string, unknown>,
): string {
  const query = firstNonEmptyString(
    input.pattern,
    input.query,
    input.regex,
    input.text,
    input.symbol,
    input.name,
    input.uri,
  );
  const scope = formatPathList(extractPathList(input))
    ?? firstNonEmptyString(input.path, input.cwd);

  if (query && scope) {
    return `${toolLabel} ${truncateText(query, 80)} in ${truncateText(scope, 50)}`;
  }

  if (query) {
    return `${toolLabel} ${truncateText(query, 100)}`;
  }

  if (scope) {
    return `${toolLabel} ${truncateText(scope, 80)}`;
  }

  return toolLabel;
}

export function formatSubagentToolSummary(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const toolLabel = getSubagentToolDisplayName(toolName);
  const normalized = toolName.trim().toLowerCase();

  if (normalized === "read" || normalized === "view" || normalized === "open") {
    const paths = formatPathList(extractPathList(input));
    return paths ? collapseNewlines(`${toolLabel} ${truncateText(paths, 110)}`) : toolLabel;
  }

  if (normalized === "grep" || normalized === "search" || normalized === "glob") {
    return collapseNewlines(summarizeSearchLikeTool(toolLabel, input));
  }

  if (normalized === "bash" || normalized === "shell") {
    const command = firstNonEmptyString(input.command, input.cmd);
    return command ? collapseNewlines(`${toolLabel} ${truncateText(command, 110)}`) : toolLabel;
  }

  if (
    normalized === "edit"
    || normalized === "multiedit"
    || normalized === "write"
    || normalized === "create"
  ) {
    const paths = formatPathList(extractPathList(input));
    return paths ? collapseNewlines(`${toolLabel} ${truncateText(paths, 110)}`) : toolLabel;
  }

  if (
    normalized === "task"
    || normalized === "launch_agent"
    || normalized === "launch-agent"
    || normalized === "agent"
  ) {
    const description = firstNonEmptyString(
      input.description,
      input.prompt,
      input.task,
      input.subagent_type,
      input.agent_type,
      input.agent,
    );
    return description ? collapseNewlines(`${toolLabel} ${truncateText(description, 100)}`) : toolLabel;
  }

  const renderer = getToolRenderer(toolName);
  const title = renderer.getTitle({ input });
  if (title && title !== "Tool execution" && title !== "MCP tool call") {
    return collapseNewlines(`${toolLabel} ${truncateText(title, 100)}`);
  }

  const fallback = Object.entries(input)
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${truncateText(String(value), 40)}`)
    .join(", ");

  return fallback.length > 0
    ? collapseNewlines(`${toolLabel} ${fallback}`)
    : toolLabel;
}
