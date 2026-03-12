import type {
  OpenCodeModel,
  OpenCodeProvider,
} from "@/services/models/model-transform.ts";

export function makeClaudeModelInfo(overrides: Partial<{
  value: string;
  displayName: string;
  description: string;
}> = {}) {
  return {
    value: overrides.value ?? "claude-sonnet-4-5",
    displayName: overrides.displayName ?? "Claude Sonnet 4.5",
    description: overrides.description ?? "A balanced model for most tasks",
  };
}

export function makeCopilotModelInfo(overrides: Record<string, unknown> = {}) {
  return {
    id: "gpt-4o",
    name: "GPT-4o",
    capabilities: {
      limits: {
        maxContextWindowTokens: 128000,
        maxPromptTokens: 8192,
      },
      supports: {
        tools: true,
        reasoning: false,
        vision: true,
      },
    },
    ...overrides,
  };
}

export function makeOpenCodeModel(overrides: Partial<OpenCodeModel> = {}): OpenCodeModel {
  return {
    name: "Claude Sonnet 4.5",
    reasoning: true,
    attachment: true,
    temperature: false,
    tool_call: true,
    limit: {
      context: 200000,
      input: 180000,
      output: 16384,
    },
    cost: {
      input: 3,
      output: 15,
      cache_read: 0.3,
      cache_write: 3.75,
    },
    ...overrides,
  };
}

export function makeOpenCodeProvider(overrides: Partial<OpenCodeProvider> = {}): OpenCodeProvider {
  return {
    id: overrides.id ?? "anthropic",
    name: overrides.name ?? "Anthropic",
    api: overrides.api ?? "anthropic",
    models: overrides.models ?? {
      "claude-sonnet-4-5": makeOpenCodeModel(),
    },
  };
}
