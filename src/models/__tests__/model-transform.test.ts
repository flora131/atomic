import { test, expect, describe } from "bun:test";
import {
  fromClaudeModelInfo,
  fromCopilotModelInfo,
  fromOpenCodeModel,
  fromOpenCodeProvider,
  type OpenCodeModel,
  type OpenCodeProvider,
} from "../model-transform";

describe("model-transform", () => {
  describe("fromClaudeModelInfo", () => {
    test("creates correct Model object from Claude SDK ModelInfo", () => {
      const modelInfo = {
        value: "claude-sonnet-4-5-20250514",
        displayName: "Sonnet 4.5",
        description: "Fast and efficient Claude model",
      };

      const result = fromClaudeModelInfo(modelInfo);

      expect(result.id).toBe("anthropic/claude-sonnet-4-5-20250514");
      expect(result.providerID).toBe("anthropic");
      expect(result.modelID).toBe("claude-sonnet-4-5-20250514");
      expect(result.name).toBe("Sonnet 4.5");
      expect(result.description).toBe("Fast and efficient Claude model");
      expect(result.status).toBe("active");
      expect(result.capabilities).toEqual({
        reasoning: false,
        attachment: false,
        temperature: true,
        toolCall: true,
      });
      expect(result.limits).toEqual({
        context: 200000,
        output: 16384,
      });
      expect(result.options).toEqual({});
    });
  });

  describe("fromCopilotModelInfo", () => {
    test("creates correct Model object from Copilot SDK ModelInfo", () => {
      const modelInfo = {
        id: "claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
        capabilities: {
          supports: ["reasoning", "tools"],
          limits: { context: 200000, output: 8192 },
        },
      };

      const result = fromCopilotModelInfo(modelInfo);

      expect(result.id).toBe("github-copilot/claude-sonnet-4.5");
      expect(result.providerID).toBe("github-copilot");
      expect(result.modelID).toBe("claude-sonnet-4.5");
      expect(result.name).toBe("Claude Sonnet 4.5");
      expect(result.status).toBe("active");
      expect(result.capabilities).toEqual({
        reasoning: true,
        attachment: false,
        temperature: true,
        toolCall: true,
      });
      expect(result.limits).toEqual({
        context: 200000,
        output: 8192,
      });
    });

    test("handles missing capabilities", () => {
      const modelInfo = {
        id: "gpt-4o",
        name: "GPT-4o",
      };

      const result = fromCopilotModelInfo(modelInfo);

      expect(result.capabilities).toEqual({
        reasoning: false,
        attachment: false,
        temperature: true,
        toolCall: true,
      });
      expect(result.limits).toEqual({
        context: 200000,
        output: 16384,
      });
    });
  });

  describe("fromOpenCodeModel", () => {
    // Complete mock model with all fields
    const fullMockModel: OpenCodeModel = {
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      status: "beta",
      reasoning: false,
      attachment: true,
      temperature: true,
      tool_call: true,
      cost: {
        input: 0.003,
        output: 0.015,
        cache_read: 0.001,
        cache_write: 0.002,
      },
      limit: { context: 200000, input: 100000, output: 100000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      options: { max_tokens: 4096 },
      headers: { "anthropic-version": "2025-01-01" },
    };

    // Minimal mock model with only required fields
    const minimalMockModel: OpenCodeModel = {
      name: "GPT-4o",
    };

    test("creates correct Model object with all fields", () => {
      const result = fromOpenCodeModel("anthropic", "claude-sonnet-4", fullMockModel, "anthropic");

      expect(result.id).toBe("anthropic/claude-sonnet-4");
      expect(result.providerID).toBe("anthropic");
      expect(result.modelID).toBe("claude-sonnet-4");
      expect(result.name).toBe("Claude Sonnet 4");
      expect(result.api).toBe("anthropic");
      expect(result.status).toBe("beta");
      expect(result.capabilities).toEqual({
        reasoning: false,
        attachment: true,
        temperature: true,
        toolCall: true,
      });
      expect(result.limits).toEqual({
        context: 200000,
        input: 100000,
        output: 100000,
      });
      expect(result.modalities).toEqual({
        input: ["text", "image"],
        output: ["text"],
      });
      expect(result.options).toEqual({ max_tokens: 4096 });
      expect(result.headers).toEqual({ "anthropic-version": "2025-01-01" });
    });

    test("handles missing optional fields", () => {
      const result = fromOpenCodeModel("openai", "gpt-4o", minimalMockModel);

      expect(result.id).toBe("openai/gpt-4o");
      expect(result.providerID).toBe("openai");
      expect(result.modelID).toBe("gpt-4o");
      expect(result.name).toBe("GPT-4o");
      expect(result.api).toBeUndefined();
      expect(result.headers).toBeUndefined();
    });

    test("status defaults to 'active' when not provided", () => {
      const result = fromOpenCodeModel("openai", "gpt-4o", minimalMockModel);

      expect(result.status).toBe("active");
    });

    test("cost field transformation (snake_case to camelCase)", () => {
      const result = fromOpenCodeModel("anthropic", "claude-sonnet-4", fullMockModel);

      expect(result.cost).toBeDefined();
      expect(result.cost!.input).toBe(0.003);
      expect(result.cost!.output).toBe(0.015);
      expect(result.cost!.cacheRead).toBe(0.001);
      expect(result.cost!.cacheWrite).toBe(0.002);
    });

    test("cost field handles missing cache costs", () => {
      const modelWithPartialCost: OpenCodeModel = {
        name: "Test Model",
        cost: { input: 0.005, output: 0.015 },
      };
      const result = fromOpenCodeModel("openai", "test", modelWithPartialCost);

      expect(result.cost).toBeDefined();
      expect(result.cost!.input).toBe(0.005);
      expect(result.cost!.output).toBe(0.015);
      expect(result.cost!.cacheRead).toBeUndefined();
      expect(result.cost!.cacheWrite).toBeUndefined();
    });

    test("uses modelID as name when name not provided", () => {
      const modelWithoutName: OpenCodeModel = {};
      const result = fromOpenCodeModel("test", "my-model-id", modelWithoutName);

      expect(result.name).toBe("my-model-id");
    });
  });

  describe("fromOpenCodeProvider", () => {
    test("transforms all models in provider", () => {
      const mockProvider: OpenCodeProvider = {
        id: "anthropic",
        name: "Anthropic",
        api: "anthropic",
        models: {
          "claude-sonnet-4": {
            name: "Claude Sonnet 4",
            // status defaults to 'active' when not provided
          },
          "claude-opus-4": {
            name: "Claude Opus 4",
          },
        },
      };

      const result = fromOpenCodeProvider("anthropic", mockProvider);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);

      const sonnetModel = result.find((m) => m.modelID === "claude-sonnet-4");
      expect(sonnetModel).toBeDefined();
      expect(sonnetModel!.id).toBe("anthropic/claude-sonnet-4");
      expect(sonnetModel!.name).toBe("Claude Sonnet 4");
      expect(sonnetModel!.api).toBe("anthropic");

      const opusModel = result.find((m) => m.modelID === "claude-opus-4");
      expect(opusModel).toBeDefined();
      expect(opusModel!.id).toBe("anthropic/claude-opus-4");
      expect(opusModel!.name).toBe("Claude Opus 4");
    });

    test("returns empty array for provider with no models", () => {
      const emptyProvider: OpenCodeProvider = {
        id: "empty",
        name: "Empty Provider",
        models: {},
      };

      const result = fromOpenCodeProvider("empty", emptyProvider);

      expect(result).toEqual([]);
    });

    test("passes provider api to each model", () => {
      const mockProvider: OpenCodeProvider = {
        id: "openai",
        name: "OpenAI",
        api: "openai",
        models: {
          "gpt-4o": {
            name: "GPT-4o",
          },
        },
      };

      const result = fromOpenCodeProvider("openai", mockProvider);

      expect(result.length).toBe(1);
      expect(result[0]!.api).toBe("openai");
    });
  });
});
