import { truncateRawText } from "./config.ts";

export function formatTaskToolLines(
  toolInput: Record<string, unknown>,
): string[] {
  const lines: string[] = [];
  const task = String(toolInput.description ?? "").trim();
  const prompt = String(toolInput.prompt ?? "").trim();
  const agent = String(
    toolInput.agent_type ?? toolInput.subagent_type ?? toolInput.agent ?? "",
  ).trim();
  const title = [agent, task].filter(Boolean).join(": ") || "Sub-agent task";
  lines.push(`task ${truncateRawText(title, 180)}`);
  if (agent) lines.push(`Agent: ${truncateRawText(agent, 160)}`);
  if (task) lines.push(`Task: ${truncateRawText(task, 160)}`);
  if (prompt) lines.push(`Prompt: ${truncateRawText(prompt, 160)}`);
  return lines;
}

export function formatToolStartLines(
  toolName: string,
  toolInput: Record<string, unknown>,
): string[] {
  const normalizedName = toolName.toLowerCase();
  if (
    normalizedName === "task" ||
    normalizedName === "launch_agent" ||
    normalizedName === "launch-agent"
  ) {
    return ["◉", ...formatTaskToolLines(toolInput)];
  }

  const lines: string[] = [`◉ ${toolName}`];
  const summaryParts = Object.entries(toolInput)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${truncateRawText(String(value), 80)}`);
  if (summaryParts.length > 0) {
    lines.push(summaryParts.join(", "));
  }
  return lines;
}
