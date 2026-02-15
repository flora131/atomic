/**
 * Tests for model-transform.ts — transforms SDK model info to internal Model format
 */
import { describe, expect, test } from "bun:test";
import {
  fromClaudeModelInfo,
  fromCopilotModelInfo,
  fromOpenCodeModel,
  fromOpenCodeProvider,
  type OpenCodeModel,
  type OpenCodeProvider,
} from "./model-transform.ts";

// ── Factory helpers ──────────────────────────────────────────────────────────

function makeClaudeModelInfo(overrides: Partial<{
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

function makeCopilotModelInfo(overrides: Record<string, unknown> = {}) {
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

function makeOpenCodeModel(overrides: Partial<OpenCodeModel> = {}): OpenCodeModel {
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

function makeOpenCodeProvider(overrides: Partial<OpenCodeProvider> = {}): OpenCodeProvider {
  return {
    id: overrides.id ?? "anthropic",
    name: overrides.name ?? "Anthropic",
    api: overrides.api ?? "anthropic",
    models: overrides.models ?? {
      "claude-sonnet-4-5": makeOpenCodeModel(),
    },
  };
}

// ── fromClaudeModelInfo ──────────────────────────────────────────────────────

describe("fromClaudeModelInfo", () => {
  test("transforms Claude SDK model info to internal Model format", () => {
    const input = makeClaudeModelInfo();
    const result = fromClaudeModelInfo(input, 200000);

    expect(result.id).toBe("anthropic/claude-sonnet-4-5");
    expect(result.providerID).toBe("anthropic");
    expect(result.modelID).toBe("claude-sonnet-4-5");
    expect(result.name).toBe("Claude Sonnet 4.5");
    expect(result.description).toBe("A balanced model for most tasks");
    expect(result.status).toBe("active");
    expect(result.options).toEqual({});
  });

  test("sets default capabilities (no reasoning, no attachment, temperature on, toolCall on)", () => {
    const result = fromClaudeModelInfo(makeClaudeModelInfo(), 200000);

    expect(result.capabilities).toEqual({
      reasoning: false,
      attachment: false,
      temperature: true,
      toolCall: true,
    });
  });

  test("uses provided contextWindow for limits and defaults output to 16384", () => {
    const result = fromClaudeModelInfo(makeClaudeModelInfo(), 100000);

    expect(result.limits).toEqual({
      context: 100000,
      output: 16384,
    });
  });

  test("handles different model values correctly", () => {
    const input = makeClaudeModelInfo({
      value: "claude-opus-4",
      displayName: "Claude Opus 4",
      description: "Most capable model",
    });
    const result = fromClaudeModelInfo(input, 300000);

    expect(result.id).toBe("anthropic/claude-opus-4");
    expect(result.modelID).toBe("claude-opus-4");
    expect(result.name).toBe("Claude Opus 4");
    expect(result.limits.context).toBe(300000);
  });
});

// ── fromCopilotModelInfo ─────────────────────────────────────────────────────

describe("fromCopilotModelInfo", () => {
  test("transforms Copilot SDK model info with object-style supports", () => {
    const input = makeCopilotModelInfo();
    const result = fromCopilotModelInfo(input);

    expect(result.id).toBe("github-copilot/gpt-4o");
    expect(result.providerID).toBe("github-copilot");
    expect(result.modelID).toBe("gpt-4o");
    expect(result.name).toBe("GPT-4o");
    expect(result.status).toBe("active");
    expect(result.options).toEqual({});
  });

  test("maps object-style supports to capabilities correctly", () => {
    const input = makeCopilotModelInfo();
    const result = fromCopilotModelInfo(input);

    expect(result.capabilities).toEqual({
      reasoning: false,
      attachment: true,  // vision: true maps to attachment
      temperature: true,
      toolCall: true,
    });
  });

  test("maps array-style supports to capabilities correctly", () => {
    const input = makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000, maxPromptTokens: 4096 },
        supports: ["tools", "reasoning", "vision"],
      },
    });
    const result = fromCopilotModelInfo(input);

    expect(result.capabilities).toEqual({
      reasoning: true,
      attachment: true,
      temperature: true,
      toolCall: true,
    });
  });

  test("detects reasoning from reasoningEffort in array-style supports", () => {
    const input = makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
        supports: ["reasoningEffort"],
      },
    });
    const result = fromCopilotModelInfo(input);

    expect(result.capabilities.reasoning).toBe(true);
  });

  test("detects attachment from 'attachment' key in array-style supports", () => {
    const input = makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 64000 },
        supports: ["attachment"],
      },
    });
    const result = fromCopilotModelInfo(input);

    expect(result.capabilities.attachment).toBe(true);
  });

  test("defaults toolCall to true when tools not in object supports", () => {
    const input = makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
        supports: { reasoning: false },
      },
    });
    const result = fromCopilotModelInfo(input);

    expect(result.capabilities.toolCall).toBe(true);
  });

  test("extracts limits from maxContextWindowTokens and maxPromptTokens", () => {
    const input = makeCopilotModelInfo();
    const result = fromCopilotModelInfo(input);

    expect(result.limits).toEqual({
      context: 128000,
      output: 8192,
    });
  });

  test("falls back to snake_case limit keys", () => {
    const input = makeCopilotModelInfo({
      capabilities: {
        limits: {
          max_context_window_tokens: 64000,
          output: 2048,
        },
        supports: {},
      },
    });
    const result = fromCopilotModelInfo(input);

    expect(result.limits.context).toBe(64000);
    expect(result.limits.output).toBe(2048);
  });

  test("defaults output to 16384 when maxPromptTokens and output are missing", () => {
    const input = makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
        supports: {},
      },
    });
    const result = fromCopilotModelInfo(input);

    expect(result.limits.output).toBe(16384);
  });

  test("throws when context window is missing from limits", () => {
    const input = makeCopilotModelInfo({
      id: "broken-model",
      capabilities: {
        limits: {},
        supports: {},
      },
    });

    expect(() => fromCopilotModelInfo(input)).toThrow(
      "Copilot model 'broken-model' missing context window in capabilities.limits"
    );
  });

  test("passes through supportedReasoningEfforts and defaultReasoningEffort when reasoning is supported", () => {
    const input = makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
        supports: { reasoningEffort: true },
      },
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    });
    const result = fromCopilotModelInfo(input);

    expect(result.supportedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(result.defaultReasoningEffort).toBe("medium");
  });

  test("omits reasoning effort fields when reasoning is not supported", () => {
    const input = makeCopilotModelInfo({
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    });
    // Default makeCopilotModelInfo has reasoning: false in supports
    const result = fromCopilotModelInfo(input);

    expect(result.supportedReasoningEfforts).toBeUndefined();
    expect(result.defaultReasoningEffort).toBeUndefined();
  });

  test("handles missing capabilities.supports gracefully (defaults to empty object)", () => {
    const input = makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
      },
    });
    const result = fromCopilotModelInfo(input);

    // supports defaults to {} via nullish coalescing, so hasTools defaults to true
    expect(result.capabilities.toolCall).toBe(true);
    expect(result.capabilities.reasoning).toBe(false);
    expect(result.capabilities.attachment).toBe(false);
  });
});

// ── fromOpenCodeModel ────────────────────────────────────────────────────────

describe("fromOpenCodeModel", () => {
  test("transforms OpenCode model to internal format with all fields", () => {
    const model = makeOpenCodeModel();
    const result = fromOpenCodeModel("anthropic", "claude-sonnet-4-5", model, "anthropic", "Anthropic");

    expect(result.id).toBe("anthropic/claude-sonnet-4-5");
    expect(result.providerID).toBe("anthropic");
    expect(result.providerName).toBe("Anthropic");
    expect(result.modelID).toBe("claude-sonnet-4-5");
    expect(result.name).toBe("Claude Sonnet 4.5");
    expect(result.api).toBe("anthropic");
    expect(result.status).toBe("active");
  });

  test("maps capabilities from OpenCode model fields", () => {
    const model = makeOpenCodeModel({
      reasoning: true,
      attachment: true,
      temperature: false,
      tool_call: true,
    });
    const result = fromOpenCodeModel("anthropic", "claude-sonnet-4-5", model);

    expect(result.capabilities).toEqual({
      reasoning: true,
      attachment: true,
      temperature: false,
      toolCall: true,
    });
  });

  test("defaults capabilities when not provided", () => {
    const model = makeOpenCodeModel({
      reasoning: undefined,
      attachment: undefined,
      temperature: undefined,
      tool_call: undefined,
    });
    const result = fromOpenCodeModel("test", "model", model);

    expect(result.capabilities).toEqual({
      reasoning: false,
      attachment: false,
      temperature: true,
      toolCall: true,
    });
  });

  test("maps limits from model.limit including input", () => {
    const model = makeOpenCodeModel({
      limit: { context: 200000, input: 180000, output: 8192 },
    });
    const result = fromOpenCodeModel("anthropic", "claude-sonnet-4-5", model);

    expect(result.limits).toEqual({
      context: 200000,
      input: 180000,
      output: 8192,
    });
  });

  test("defaults output to 16384 when not provided", () => {
    const model = makeOpenCodeModel({
      limit: { context: 200000 },
    });
    const result = fromOpenCodeModel("anthropic", "model", model);

    expect(result.limits.output).toBe(16384);
    expect(result.limits.input).toBeUndefined();
  });

  test("throws when context window is missing", () => {
    const model = makeOpenCodeModel({
      limit: { output: 8192 },
    });

    expect(() => fromOpenCodeModel("anthropic", "bad-model", model)).toThrow(
      "OpenCode model 'bad-model' from provider 'anthropic' missing context window in limit"
    );
  });

  test("throws when limit is completely missing", () => {
    const model = makeOpenCodeModel({ limit: undefined });

    expect(() => fromOpenCodeModel("test", "no-limit", model)).toThrow(
      "OpenCode model 'no-limit' from provider 'test' missing context window in limit"
    );
  });

  test("maps cost with snake_case to camelCase conversion", () => {
    const model = makeOpenCodeModel({
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
    });
    const result = fromOpenCodeModel("anthropic", "model", model);

    expect(result.cost).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    });
  });

  test("omits cost when not provided", () => {
    const model = makeOpenCodeModel({ cost: undefined });
    const result = fromOpenCodeModel("anthropic", "model", model);

    expect(result.cost).toBeUndefined();
  });

  test("passes through modalities, options, and headers", () => {
    const model = makeOpenCodeModel({
      modalities: { input: ["text", "image"], output: ["text"] },
      options: { stream: true },
      headers: { "X-Custom": "value" },
    });
    const result = fromOpenCodeModel("anthropic", "model", model);

    expect(result.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
    expect(result.options).toEqual({ stream: true });
    expect(result.headers).toEqual({ "X-Custom": "value" });
  });

  test("defaults name to modelID when model.name is not provided", () => {
    const model = makeOpenCodeModel({ name: undefined });
    const result = fromOpenCodeModel("anthropic", "fallback-name", model);

    expect(result.name).toBe("fallback-name");
  });

  test("defaults status to 'active' when not provided", () => {
    const model = makeOpenCodeModel({ status: undefined });
    const result = fromOpenCodeModel("test", "model", model);

    expect(result.status).toBe("active");
  });

  test("preserves explicit status values", () => {
    const model = makeOpenCodeModel({ status: "deprecated" });
    const result = fromOpenCodeModel("test", "old-model", model);

    expect(result.status).toBe("deprecated");
  });

  test("defaults options to empty object when not provided", () => {
    const model = makeOpenCodeModel({ options: undefined });
    const result = fromOpenCodeModel("test", "model", model);

    expect(result.options).toEqual({});
  });

  test("providerName and api are optional", () => {
    const model = makeOpenCodeModel();
    const result = fromOpenCodeModel("custom", "model", model);

    expect(result.providerName).toBeUndefined();
    expect(result.api).toBeUndefined();
  });
});

// ── fromOpenCodeProvider ─────────────────────────────────────────────────────

describe("fromOpenCodeProvider", () => {
  test("transforms a provider with a single model", () => {
    const provider = makeOpenCodeProvider();
    const results = fromOpenCodeProvider("anthropic", provider);

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("anthropic/claude-sonnet-4-5");
    expect(results[0]!.providerName).toBe("Anthropic");
    expect(results[0]!.api).toBe("anthropic");
  });

  test("transforms a provider with multiple models", () => {
    const provider = makeOpenCodeProvider({
      models: {
        "claude-sonnet-4-5": makeOpenCodeModel({ name: "Claude Sonnet 4.5" }),
        "claude-opus-4": makeOpenCodeModel({
          name: "Claude Opus 4",
          limit: { context: 300000, output: 32768 },
        }),
      },
    });
    const results = fromOpenCodeProvider("anthropic", provider);

    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.modelID);
    expect(ids).toContain("claude-sonnet-4-5");
    expect(ids).toContain("claude-opus-4");
  });

  test("returns empty array when provider has no models", () => {
    const provider = makeOpenCodeProvider({ models: {} });
    const results = fromOpenCodeProvider("empty", provider);

    expect(results).toEqual([]);
  });

  test("passes provider.api and provider.name to each model", () => {
    const provider = makeOpenCodeProvider({
      name: "OpenAI",
      api: "openai",
      models: {
        "gpt-4o": makeOpenCodeModel({ name: "GPT-4o" }),
      },
    });
    const results = fromOpenCodeProvider("openai", provider);

    expect(results[0]!.api).toBe("openai");
    expect(results[0]!.providerName).toBe("OpenAI");
  });

  test("handles provider without api field", () => {
    const provider: OpenCodeProvider = {
      id: "custom",
      name: "Custom Provider",
      models: {
        "model-1": makeOpenCodeModel({ name: "Model 1" }),
      },
    };
    const results = fromOpenCodeProvider("custom", provider);

    expect(results[0]!.api).toBeUndefined();
    expect(results[0]!.providerName).toBe("Custom Provider");
  });
});
