import { describe, expect, test } from "bun:test";
import {
  fromOpenCodeProvider,
  type OpenCodeProvider,
} from "@/services/models/model-transform.ts";
import {
  makeOpenCodeModel,
  makeOpenCodeProvider,
} from "./model-transform.test-support.ts";

describe("fromOpenCodeProvider", () => {
  test("transforms a provider with a single model", () => {
    const results = fromOpenCodeProvider("anthropic", makeOpenCodeProvider());
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
    expect(results.map((result) => result.modelID)).toContain("claude-sonnet-4-5");
    expect(results.map((result) => result.modelID)).toContain("claude-opus-4");
  });

  test("returns empty array when provider has no models", () => {
    expect(fromOpenCodeProvider("empty", makeOpenCodeProvider({ models: {} }))).toEqual([]);
  });

  test("passes provider.api and provider.name to each model", () => {
    const results = fromOpenCodeProvider("openai", makeOpenCodeProvider({
      name: "OpenAI",
      api: "openai",
      models: {
        "gpt-4o": makeOpenCodeModel({ name: "GPT-4o" }),
      },
    }));
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
