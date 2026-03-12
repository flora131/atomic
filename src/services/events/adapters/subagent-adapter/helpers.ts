export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function normalizeToolName(value: unknown): string {
  return asString(value) ?? "unknown";
}

export function createSyntheticToolId(
  agentId: string,
  toolName: string,
  counter: number,
): string {
  const normalizedName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `tool_${agentId}_${normalizedName}_${counter}`;
}

export function resolveToolCompleteId(
  toolNames: ReadonlyMap<string, string>,
  fallbackFactory: (toolName: string) => string,
  toolName: string,
): string {
  for (const [toolId, name] of toolNames) {
    if (name === toolName) {
      return toolId;
    }
  }
  return fallbackFactory(toolName);
}
