import { describe, expect, it } from "bun:test";
import { getInitialReasoningIndex } from "@/components/model-selector-dialog.tsx";
import type { Model } from "@/services/models/model-transform.ts";

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "openai/gpt-5",
    providerID: "openai",
    modelID: "gpt-5",
    name: "GPT-5",
    status: "active",
    capabilities: {
      reasoning: true,
      attachment: false,
      temperature: true,
      toolCall: true,
    },
    limits: {
      context: 128000,
      output: 16384,
    },
    options: {},
    ...overrides,
  };
}

describe("getInitialReasoningIndex", () => {
  it("prefers the currently selected reasoning effort for the active model", () => {
    const model = createModel({
      supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
      defaultReasoningEffort: "medium",
    });

    expect(getInitialReasoningIndex(model, "openai/gpt-5", "high")).toBe(3);
  });

  it("falls back to the model default when the current effort does not apply", () => {
    const model = createModel({
      id: "openai/gpt-5-mini",
      modelID: "gpt-5-mini",
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    });

    expect(getInitialReasoningIndex(model, "openai/gpt-5", "high")).toBe(1);
  });
});
