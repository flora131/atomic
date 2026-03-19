import { describe, expect, test } from "bun:test";
import { fromOpenCodeModel } from "@/services/models/model-transform.ts";
import { makeOpenCodeModel } from "./model-transform.test-support.ts";

describe("fromOpenCodeModel", () => {
  test("transforms OpenCode model to internal format with all fields", () => {
    const result = fromOpenCodeModel("anthropic", "claude-sonnet-4-5", makeOpenCodeModel(), "anthropic", "Anthropic");
    expect(result.id).toBe("anthropic/claude-sonnet-4-5");
    expect(result.providerID).toBe("anthropic");
    expect(result.providerName).toBe("Anthropic");
    expect(result.modelID).toBe("claude-sonnet-4-5");
    expect(result.name).toBe("Claude Sonnet 4.5");
    expect(result.api).toBe("anthropic");
    expect(result.status).toBe("active");
  });

  test("maps and defaults capabilities", () => {
    const mapped = fromOpenCodeModel("anthropic", "claude-sonnet-4-5", makeOpenCodeModel({
      reasoning: true,
      attachment: true,
      temperature: false,
      tool_call: true,
    }));
    expect(mapped.capabilities).toEqual({
      reasoning: true,
      attachment: true,
      temperature: false,
      toolCall: true,
    });

    const defaults = fromOpenCodeModel("test", "model", makeOpenCodeModel({
      reasoning: undefined,
      attachment: undefined,
      temperature: undefined,
      tool_call: undefined,
    }));
    expect(defaults.capabilities).toEqual({
      reasoning: false,
      attachment: false,
      temperature: true,
      toolCall: true,
    });
  });

  test("maps limits and defaults output", () => {
    const mapped = fromOpenCodeModel("anthropic", "claude-sonnet-4-5", makeOpenCodeModel({
      limit: { context: 200000, input: 180000, output: 8192 },
    }));
    expect(mapped.limits).toEqual({ context: 200000, input: 180000, output: 8192 });

    const defaults = fromOpenCodeModel("anthropic", "model", makeOpenCodeModel({
      limit: { context: 200000 },
    }));
    expect(defaults.limits.output).toBe(16384);
    expect(defaults.limits.input).toBeUndefined();
  });

  test("throws when context window is missing", () => {
    expect(() => fromOpenCodeModel("anthropic", "bad-model", makeOpenCodeModel({
      limit: { output: 8192 },
    }))).toThrow("OpenCode model 'bad-model' from provider 'anthropic' missing context window in limit");

    expect(() => fromOpenCodeModel("test", "no-limit", makeOpenCodeModel({ limit: undefined }))).toThrow(
      "OpenCode model 'no-limit' from provider 'test' missing context window in limit",
    );
  });

  test("maps cost and optional passthrough fields", () => {
    const model = makeOpenCodeModel({
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      modalities: { input: ["text", "image"], output: ["text"] },
      options: { stream: true },
      headers: { "X-Custom": "value" },
    });
    const result = fromOpenCodeModel("anthropic", "model", model);
    expect(result.cost).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    });
    expect(result.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
    expect(result.options).toEqual({ stream: true });
    expect(result.headers).toEqual({ "X-Custom": "value" });
  });

  test("omits optional fields and defaults friendly values", () => {
    const result = fromOpenCodeModel("custom", "fallback-name", makeOpenCodeModel({
      name: undefined,
      status: undefined,
      options: undefined,
      cost: undefined,
    }));
    expect(result.name).toBe("fallback-name");
    expect(result.status).toBe("active");
    expect(result.options).toEqual({});
    expect(result.cost).toBeUndefined();
    expect(result.providerName).toBeUndefined();
    expect(result.api).toBeUndefined();
  });

  test("preserves explicit status values", () => {
    const result = fromOpenCodeModel("test", "old-model", makeOpenCodeModel({ status: "deprecated" }));
    expect(result.status).toBe("deprecated");
  });

  test("maps built-in OpenCode reasoning variants to supported effort levels", () => {
    const result = fromOpenCodeModel("openai", "gpt-5", makeOpenCodeModel({
      variants: {
        low: { reasoningEffort: "low" },
        medium: { reasoningEffort: "medium" },
        high: { reasoningEffort: "high" },
      },
    }));

    expect(result.supportedReasoningEfforts).toEqual(["low", "medium", "high"]);
    expect(result.defaultReasoningEffort).toBeUndefined();
  });

  test("ignores custom and disabled OpenCode variants when deriving effort levels", () => {
    const result = fromOpenCodeModel("anthropic", "claude-sonnet-4-5", makeOpenCodeModel({
      variants: {
        low: { thinking: { budgetTokens: 4000 } },
        max: { disabled: true },
        focused: { reasoningEffort: "high" },
      },
    }));

    expect(result.supportedReasoningEfforts).toEqual(["low"]);
  });
});
