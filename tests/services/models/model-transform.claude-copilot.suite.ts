import { describe, expect, test } from "bun:test";
import {
  fromClaudeModelInfo,
  fromCopilotModelInfo,
} from "@/services/models/model-transform.ts";
import {
  makeClaudeModelInfo,
  makeCopilotModelInfo,
} from "./model-transform.test-support.ts";

describe("fromClaudeModelInfo", () => {
  test("transforms Claude SDK model info to internal Model format", () => {
    const result = fromClaudeModelInfo(makeClaudeModelInfo(), 200000);
    expect(result.id).toBe("anthropic/claude-sonnet-4-5");
    expect(result.providerID).toBe("anthropic");
    expect(result.modelID).toBe("claude-sonnet-4-5");
    expect(result.name).toBe("Claude Sonnet 4.5");
    expect(result.description).toBe("A balanced model for most tasks");
    expect(result.status).toBe("active");
    expect(result.options).toEqual({});
  });

  test("sets default capabilities and limits", () => {
    const result = fromClaudeModelInfo(makeClaudeModelInfo(), 100000);
    expect(result.capabilities).toEqual({
      reasoning: false,
      attachment: false,
      temperature: true,
      toolCall: true,
    });
    expect(result.limits).toEqual({ context: 100000, output: 16384 });
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

  test("passes Claude reasoning effort metadata through only when explicitly advertised", () => {
    const supported = fromClaudeModelInfo(makeClaudeModelInfo({
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "max"],
    }), 200000);

    expect(supported.capabilities.reasoning).toBe(true);
    expect(supported.supportedReasoningEfforts).toEqual(["low", "medium", "high", "max"]);
    expect(supported.defaultReasoningEffort).toBe("high");

    const unsupported = fromClaudeModelInfo(makeClaudeModelInfo({
      supportsEffort: true,
    }), 200000);

    expect(unsupported.capabilities.reasoning).toBe(false);
    expect(unsupported.supportedReasoningEfforts).toBeUndefined();
    expect(unsupported.defaultReasoningEffort).toBeUndefined();
  });
});

describe("fromCopilotModelInfo", () => {
  test("transforms Copilot SDK model info with object-style supports", () => {
    const result = fromCopilotModelInfo(makeCopilotModelInfo());
    expect(result.id).toBe("github-copilot/gpt-4o");
    expect(result.providerID).toBe("github-copilot");
    expect(result.modelID).toBe("gpt-4o");
    expect(result.name).toBe("GPT-4o");
    expect(result.status).toBe("active");
    expect(result.options).toEqual({});
  });

  test("maps object-style supports to capabilities correctly", () => {
    const result = fromCopilotModelInfo(makeCopilotModelInfo());
    expect(result.capabilities).toEqual({
      reasoning: false,
      attachment: true,
      temperature: true,
      toolCall: true,
    });
  });

  test("maps array-style supports to capabilities correctly", () => {
    const result = fromCopilotModelInfo(makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000, maxPromptTokens: 4096 },
        supports: ["tools", "reasoning", "vision"],
      },
    }));
    expect(result.capabilities).toEqual({
      reasoning: true,
      attachment: true,
      temperature: true,
      toolCall: true,
    });
  });

  test("detects reasoning and attachment aliases in array-style supports", () => {
    const reasoning = fromCopilotModelInfo(makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
        supports: ["reasoningEffort"],
      },
    }));
    expect(reasoning.capabilities.reasoning).toBe(true);

    const attachment = fromCopilotModelInfo(makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 64000 },
        supports: ["attachment"],
      },
    }));
    expect(attachment.capabilities.attachment).toBe(true);
  });

  test("defaults toolCall to true when tools not in object supports", () => {
    const result = fromCopilotModelInfo(makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
        supports: { reasoning: false },
      },
    }));
    expect(result.capabilities.toolCall).toBe(true);
  });

  test("extracts limits from multiple key shapes", () => {
    const standard = fromCopilotModelInfo(makeCopilotModelInfo());
    expect(standard.limits).toEqual({ context: 128000, output: 8192 });

    const snake = fromCopilotModelInfo(makeCopilotModelInfo({
      capabilities: {
        limits: {
          max_context_window_tokens: 64000,
          output: 2048,
        },
        supports: {},
      },
    }));
    expect(snake.limits.context).toBe(64000);
    expect(snake.limits.output).toBe(2048);
  });

  test("defaults output when missing and throws when context is missing", () => {
    const defaults = fromCopilotModelInfo(makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
        supports: {},
      },
    }));
    expect(defaults.limits.output).toBe(16384);

    expect(() => fromCopilotModelInfo(makeCopilotModelInfo({
      id: "broken-model",
      capabilities: {
        limits: {},
        supports: {},
      },
    }))).toThrow("Copilot model 'broken-model' missing context window in capabilities.limits");
  });

  test("passes reasoning effort fields only when reasoning is supported", () => {
    const supported = fromCopilotModelInfo(makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
        supports: { reasoningEffort: true },
      },
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    }));
    expect(supported.supportedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(supported.defaultReasoningEffort).toBe("medium");

    const unsupported = fromCopilotModelInfo(makeCopilotModelInfo({
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    }));
    expect(unsupported.supportedReasoningEfforts).toBeUndefined();
    expect(unsupported.defaultReasoningEffort).toBeUndefined();
  });

  test("handles missing capabilities.supports gracefully", () => {
    const result = fromCopilotModelInfo(makeCopilotModelInfo({
      capabilities: {
        limits: { maxContextWindowTokens: 128000 },
      },
    }));
    expect(result.capabilities.toolCall).toBe(true);
    expect(result.capabilities.reasoning).toBe(false);
    expect(result.capabilities.attachment).toBe(false);
  });
});
