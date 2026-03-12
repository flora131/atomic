import type { Model } from "@/services/models/model-transform.ts";

export function createMockModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "test-provider/test-model",
    providerID: "test-provider",
    modelID: "test-model",
    name: "Test Model",
    status: "active",
    capabilities: {
      reasoning: false,
      attachment: false,
      temperature: true,
      toolCall: true,
    },
    limits: {
      context: 100000,
      output: 4096,
    },
    options: {},
    ...overrides,
  };
}

export function createMockOpenCodeProviderModel(
  overrides: Partial<{
    name: string;
    status: "alpha" | "beta" | "deprecated";
    reasoning: boolean;
    attachment: boolean;
    temperature: boolean;
    tool_call: boolean;
    limit: { context: number; output: number };
    options: Record<string, unknown>;
  }> = {},
) {
  return {
    name: "Mock OpenCode Model",
    reasoning: true,
    attachment: true,
    temperature: true,
    tool_call: true,
    limit: {
      context: 400000,
      output: 16384,
    },
    options: {},
    ...overrides,
  };
}
