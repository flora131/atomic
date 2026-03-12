export interface SubagentToolPolicy {
  tools?: readonly string[] | null;
  disallowedTools?: readonly string[] | null;
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function matchesToolPattern(pattern: string, toolName: string): boolean {
  const normalizedPattern = normalizeToolName(pattern);
  const normalizedToolName = normalizeToolName(toolName);

  if (normalizedPattern.length === 0 || normalizedToolName.length === 0) {
    return false;
  }

  if (!normalizedPattern.includes("*") && !normalizedPattern.includes("?")) {
    return normalizedPattern === normalizedToolName;
  }

  const regex = new RegExp(
    `^${escapeRegExp(normalizedPattern)
      .replace(/\\\*/g, ".*")
      .replace(/\\\?/g, ".")}$`,
    "i",
  );
  return regex.test(normalizedToolName);
}

function matchesAnyPattern(
  patterns: readonly string[] | null | undefined,
  toolName: string,
): boolean {
  return (patterns ?? []).some((pattern) => matchesToolPattern(pattern, toolName));
}

export function resolveSubagentToolPolicy<T extends SubagentToolPolicy>(
  policies: Record<string, T> | undefined,
  agentName: string,
): T | undefined {
  if (!policies) {
    return undefined;
  }

  const direct = policies[agentName];
  if (direct) {
    return direct;
  }

  return Object.entries(policies).find(
    ([name]) => normalizeToolName(name) === normalizeToolName(agentName),
  )?.[1];
}

export function isToolDisabledBySubagentPolicy(
  policy: SubagentToolPolicy | undefined,
  toolName: string,
  options: { treatToolsAsAllowlist?: boolean } = {},
): boolean {
  if (!policy) {
    return false;
  }

  if (matchesAnyPattern(policy.disallowedTools, toolName)) {
    return true;
  }

  if (options.treatToolsAsAllowlist && (policy.tools?.length ?? 0) > 0) {
    return !matchesAnyPattern(policy.tools, toolName);
  }

  return false;
}
