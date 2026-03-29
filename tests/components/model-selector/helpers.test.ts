import { describe, expect, test } from "bun:test";

import type { Model } from "@/services/models/model-transform.ts";

import {
  getCapabilityInfo,
  groupModelsByProvider,
} from "@/components/model-selector/helpers.ts";

function createModel(
  overrides: Partial<Model> & { providerID: string; providerName: string },
): Model {
  return {
    id: "model-1",
    name: "Test Model",
    ...overrides,
  } as Model;
}

describe("groupModelsByProvider", () => {
  test("returns empty array for empty input", () => {
    expect(groupModelsByProvider([])).toEqual([]);
  });

  test("groups models by providerID", () => {
    const models = [
      createModel({ providerID: "anthropic", providerName: "Anthropic" }),
      createModel({ providerID: "openai", providerName: "OpenAI" }),
    ];

    const result = groupModelsByProvider(models);

    expect(result).toHaveLength(2);
    expect(result.map((g) => g.providerID)).toEqual(["anthropic", "openai"]);
  });

  test("sorts groups alphabetically by providerID", () => {
    const models = [
      createModel({ providerID: "openai", providerName: "OpenAI" }),
      createModel({ providerID: "anthropic", providerName: "Anthropic" }),
      createModel({ providerID: "google", providerName: "Google" }),
    ];

    const result = groupModelsByProvider(models);

    expect(result.map((g) => g.providerID)).toEqual([
      "anthropic",
      "google",
      "openai",
    ]);
  });

  test("uses providerName from first model as displayName", () => {
    const models = [
      createModel({
        id: "m1",
        providerID: "anthropic",
        providerName: "Anthropic",
      }),
      createModel({
        id: "m2",
        providerID: "anthropic",
        providerName: "Anthropic (Alt)",
      }),
    ];

    const result = groupModelsByProvider(models);

    expect(result).toHaveLength(1);
    expect(result[0]!.displayName).toBe("Anthropic");
  });

  test("handles multiple models per provider", () => {
    const modelA = createModel({
      id: "a1",
      providerID: "anthropic",
      providerName: "Anthropic",
      name: "Claude Sonnet",
    });
    const modelB = createModel({
      id: "a2",
      providerID: "anthropic",
      providerName: "Anthropic",
      name: "Claude Opus",
    });
    const modelC = createModel({
      id: "o1",
      providerID: "openai",
      providerName: "OpenAI",
      name: "GPT-4o",
    });

    const result = groupModelsByProvider([modelA, modelB, modelC]);

    const anthropicGroup = result.find((g) => g.providerID === "anthropic");
    const openaiGroup = result.find((g) => g.providerID === "openai");

    expect(anthropicGroup!.models).toHaveLength(2);
    expect(anthropicGroup!.models).toContain(modelA);
    expect(anthropicGroup!.models).toContain(modelB);
    expect(openaiGroup!.models).toHaveLength(1);
    expect(openaiGroup!.models).toContain(modelC);
  });

  test("falls back to providerID if providerName is missing", () => {
    const model = createModel({
      providerID: "custom-provider",
      providerName: "",
    });
    // Simulate a model where providerName is undefined at runtime
    (model as unknown as Record<string, unknown>).providerName = undefined;

    const result = groupModelsByProvider([model]);

    expect(result).toHaveLength(1);
    expect(result[0]!.displayName).toBe("custom-provider");
  });
});

describe("getCapabilityInfo", () => {
  test("returns null when no limits defined", () => {
    const model = createModel({
      providerID: "test",
      providerName: "Test",
    });
    // Remove limits entirely
    (model as unknown as Record<string, unknown>).limits = undefined;

    expect(getCapabilityInfo(model)).toBeNull();
  });

  test("returns null when no context in limits", () => {
    const model = createModel({
      providerID: "test",
      providerName: "Test",
    });
    (model as unknown as Record<string, unknown>).limits = {};

    expect(getCapabilityInfo(model)).toBeNull();
  });

  test('formats context >= 1M as "X.XM"', () => {
    const model1M = createModel({
      providerID: "test",
      providerName: "Test",
      limits: { context: 1_000_000, output: 4096 },
    });
    expect(getCapabilityInfo(model1M)).toBe("1.0M");

    const model2_5M = createModel({
      providerID: "test",
      providerName: "Test",
      limits: { context: 2_500_000, output: 4096 },
    });
    expect(getCapabilityInfo(model2_5M)).toBe("2.5M");
  });

  test('formats context >= 1k as "Xk"', () => {
    const model128k = createModel({
      providerID: "test",
      providerName: "Test",
      limits: { context: 128_000, output: 4096 },
    });
    expect(getCapabilityInfo(model128k)).toBe("128k");

    const model4k = createModel({
      providerID: "test",
      providerName: "Test",
      limits: { context: 4_000, output: 4096 },
    });
    expect(getCapabilityInfo(model4k)).toBe("4k");
  });

  test("formats small context as plain number", () => {
    const model = createModel({
      providerID: "test",
      providerName: "Test",
      limits: { context: 500, output: 100 },
    });
    expect(getCapabilityInfo(model)).toBe("500");
  });
});
