import { test, expect, describe } from "bun:test";
import { fromModelsDevModel, fromModelsDevProvider } from "../model-transform";
import { ModelsDev } from "../models-dev";

describe("model-transform", () => {
  // Complete mock model with all fields
  const fullMockModel: ModelsDev.Model = {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    family: "claude",
    release_date: "2025-01-01",
    attachment: true,
    reasoning: false,
    temperature: true,
    tool_call: true,
    cost: {
      input: 0.003,
      output: 0.015,
      cache_read: 0.001,
      cache_write: 0.002
    },
    limit: { context: 200000, input: 100000, output: 100000 },
    modalities: { input: ["text", "image"], output: ["text"] },
    options: { max_tokens: 4096 },
    headers: { "anthropic-version": "2025-01-01" },
    status: "beta"
  };

  // Minimal mock model with only required fields
  const minimalMockModel: ModelsDev.Model = {
    id: "gpt-4o",
    name: "GPT-4o",
    release_date: "2024-05-01",
    attachment: true,
    reasoning: false,
    temperature: true,
    tool_call: true,
    cost: { input: 0.005, output: 0.015 },
    limit: { context: 128000, input: 64000, output: 64000 },
    modalities: { input: ["text"], output: ["text"] },
    options: {}
  };

  describe("fromModelsDevModel", () => {
    test("creates correct Model object with all fields", () => {
      const result = fromModelsDevModel("anthropic", "claude-sonnet-4", fullMockModel, "anthropic");

      expect(result.id).toBe("anthropic/claude-sonnet-4");
      expect(result.providerID).toBe("anthropic");
      expect(result.modelID).toBe("claude-sonnet-4");
      expect(result.name).toBe("Claude Sonnet 4");
      expect(result.family).toBe("claude");
      expect(result.api).toBe("anthropic");
      expect(result.status).toBe("beta");
      expect(result.capabilities).toEqual({
        reasoning: false,
        attachment: true,
        temperature: true,
        toolCall: true
      });
      expect(result.limits).toEqual({
        context: 200000,
        input: 100000,
        output: 100000
      });
      expect(result.modalities).toEqual({
        input: ["text", "image"],
        output: ["text"]
      });
      expect(result.options).toEqual({ max_tokens: 4096 });
      expect(result.headers).toEqual({ "anthropic-version": "2025-01-01" });
    });

    test("handles missing optional fields", () => {
      const result = fromModelsDevModel("openai", "gpt-4o", minimalMockModel);

      expect(result.id).toBe("openai/gpt-4o");
      expect(result.providerID).toBe("openai");
      expect(result.modelID).toBe("gpt-4o");
      expect(result.name).toBe("GPT-4o");
      expect(result.family).toBeUndefined();
      expect(result.api).toBeUndefined();
      expect(result.headers).toBeUndefined();
    });

    test("status defaults to 'active' when not provided", () => {
      const result = fromModelsDevModel("openai", "gpt-4o", minimalMockModel);

      expect(result.status).toBe("active");
    });

    test("cost field transformation (snake_case to camelCase)", () => {
      const result = fromModelsDevModel("anthropic", "claude-sonnet-4", fullMockModel);

      expect(result.cost).toBeDefined();
      expect(result.cost!.input).toBe(0.003);
      expect(result.cost!.output).toBe(0.015);
      expect(result.cost!.cacheRead).toBe(0.001);
      expect(result.cost!.cacheWrite).toBe(0.002);
    });

    test("cost field handles missing cache costs", () => {
      const result = fromModelsDevModel("openai", "gpt-4o", minimalMockModel);

      expect(result.cost).toBeDefined();
      expect(result.cost!.input).toBe(0.005);
      expect(result.cost!.output).toBe(0.015);
      expect(result.cost!.cacheRead).toBeUndefined();
      expect(result.cost!.cacheWrite).toBeUndefined();
    });
  });

  describe("fromModelsDevProvider", () => {
    test("transforms all models in provider", () => {
      const mockProvider: ModelsDev.Provider = {
        id: "anthropic",
        name: "Anthropic",
        api: "anthropic",
        env: ["ANTHROPIC_API_KEY"],
        models: {
          "claude-sonnet-4": fullMockModel,
          "claude-opus-4": {
            ...fullMockModel,
            id: "claude-opus-4",
            name: "Claude Opus 4"
          }
        }
      };

      const result = fromModelsDevProvider("anthropic", mockProvider);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);

      const sonnetModel = result.find(m => m.modelID === "claude-sonnet-4");
      expect(sonnetModel).toBeDefined();
      expect(sonnetModel!.id).toBe("anthropic/claude-sonnet-4");
      expect(sonnetModel!.name).toBe("Claude Sonnet 4");
      expect(sonnetModel!.api).toBe("anthropic");

      const opusModel = result.find(m => m.modelID === "claude-opus-4");
      expect(opusModel).toBeDefined();
      expect(opusModel!.id).toBe("anthropic/claude-opus-4");
      expect(opusModel!.name).toBe("Claude Opus 4");
    });

    test("returns empty array for provider with no models", () => {
      const emptyProvider: ModelsDev.Provider = {
        id: "empty",
        name: "Empty Provider",
        env: [],
        models: {}
      };

      const result = fromModelsDevProvider("empty", emptyProvider);

      expect(result).toEqual([]);
    });

    test("passes provider api to each model", () => {
      const mockProvider: ModelsDev.Provider = {
        id: "openai",
        name: "OpenAI",
        api: "openai",
        env: ["OPENAI_API_KEY"],
        models: {
          "gpt-4o": minimalMockModel
        }
      };

      const result = fromModelsDevProvider("openai", mockProvider);

      expect(result.length).toBe(1);
      expect(result[0]!.api).toBe("openai");
    });
  });
});
