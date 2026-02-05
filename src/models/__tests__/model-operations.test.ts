import { test, expect, describe, beforeEach, mock, spyOn } from "bun:test";
import {
  UnifiedModelOperations,
  CLAUDE_ALIASES,
  type AgentType,
} from "../model-operations";
import { ModelsDev } from "../models-dev";

describe("UnifiedModelOperations", () => {
  // Mock models data
  const mockModelsData: ModelsDev.Database = {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      api: "anthropic",
      env: ["ANTHROPIC_API_KEY"],
      models: {
        "claude-sonnet-4": {
          id: "claude-sonnet-4",
          name: "Claude Sonnet 4",
          release_date: "2025-01-01",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.003, output: 0.015 },
          limit: { context: 200000, input: 100000, output: 100000 },
          modalities: { input: ["text", "image"], output: ["text"] },
          options: {},
        },
      },
    },
    openai: {
      id: "openai",
      name: "OpenAI",
      api: "openai",
      env: ["OPENAI_API_KEY"],
      models: {
        "gpt-4o": {
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
          options: {},
        },
      },
    },
  };

  beforeEach(() => {
    // Reset ModelsDev state
    ModelsDev.Data.reset();
  });

  describe("listAvailableModels", () => {
    test("for Claude only returns anthropic models", async () => {
      // Mock ModelsDev.get
      const getSpy = spyOn(ModelsDev, "get").mockResolvedValue(mockModelsData);

      const ops = new UnifiedModelOperations("claude");
      const models = await ops.listAvailableModels();

      expect(getSpy).toHaveBeenCalled();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(1);

      const anthropicModel = models.find((m) => m.providerID === "anthropic");
      expect(anthropicModel).toBeDefined();
      expect(anthropicModel!.modelID).toBe("claude-sonnet-4");

      // Should NOT include OpenAI models
      const openaiModel = models.find((m) => m.providerID === "openai");
      expect(openaiModel).toBeUndefined();

      getSpy.mockRestore();
    });

    test("for OpenCode returns all models", async () => {
      // Mock ModelsDev.get
      const getSpy = spyOn(ModelsDev, "get").mockResolvedValue(mockModelsData);

      const ops = new UnifiedModelOperations("opencode");
      const models = await ops.listAvailableModels();

      expect(getSpy).toHaveBeenCalled();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(2);

      const anthropicModel = models.find((m) => m.providerID === "anthropic");
      expect(anthropicModel).toBeDefined();

      const openaiModel = models.find((m) => m.providerID === "openai");
      expect(openaiModel).toBeDefined();

      getSpy.mockRestore();
    });

    test("for Copilot only returns github-copilot and github-models models", async () => {
      // Add github-copilot and github-models providers to mock data
      const mockDataWithGithub = {
        ...mockModelsData,
        "github-copilot": {
          id: "github-copilot",
          name: "GitHub Copilot",
          api: "github-copilot",
          env: ["GITHUB_TOKEN"],
          models: {
            "copilot-gpt-4": {
              id: "copilot-gpt-4",
              name: "Copilot GPT-4",
              release_date: "2024-01-01",
              cost: { input: 0, output: 0 },
              limit: { context: 128000, input: 64000, output: 64000 },
              modalities: { input: ["text"], output: ["text"] },
              options: {},
            },
          },
        },
        "github-models": {
          id: "github-models",
          name: "GitHub Models",
          api: "github-models",
          env: ["GITHUB_TOKEN"],
          models: {
            "gpt-4o": {
              id: "gpt-4o",
              name: "GPT-4o",
              release_date: "2024-05-01",
              cost: { input: 0.005, output: 0.015 },
              limit: { context: 128000, input: 64000, output: 64000 },
              modalities: { input: ["text"], output: ["text"] },
              options: {},
            },
          },
        },
      };

      const getSpy = spyOn(ModelsDev, "get").mockResolvedValue(mockDataWithGithub);

      const ops = new UnifiedModelOperations("copilot");
      const models = await ops.listAvailableModels();

      expect(getSpy).toHaveBeenCalled();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(2);

      const copilotModel = models.find((m) => m.providerID === "github-copilot");
      expect(copilotModel).toBeDefined();
      expect(copilotModel!.modelID).toBe("copilot-gpt-4");

      const githubModelsModel = models.find((m) => m.providerID === "github-models");
      expect(githubModelsModel).toBeDefined();
      expect(githubModelsModel!.modelID).toBe("gpt-4o");

      // Should NOT include other providers
      const anthropicModel = models.find((m) => m.providerID === "anthropic");
      expect(anthropicModel).toBeUndefined();

      getSpy.mockRestore();
    });

    test("filters out deprecated models", async () => {
      const mockDataWithDeprecated = {
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          api: "anthropic",
          env: ["ANTHROPIC_API_KEY"],
          models: {
            "claude-sonnet-4": {
              id: "claude-sonnet-4",
              name: "Claude Sonnet 4",
              release_date: "2025-01-01",
              cost: { input: 0.003, output: 0.015 },
              limit: { context: 200000, input: 100000, output: 100000 },
              modalities: { input: ["text"], output: ["text"] },
              options: {},
            },
            "claude-2": {
              id: "claude-2",
              name: "Claude 2",
              status: "deprecated" as const,
              release_date: "2023-01-01",
              cost: { input: 0.01, output: 0.03 },
              limit: { context: 100000, input: 50000, output: 50000 },
              modalities: { input: ["text"], output: ["text"] },
              options: {},
            },
          },
        },
      };

      const getSpy = spyOn(ModelsDev, "get").mockResolvedValue(mockDataWithDeprecated);

      const ops = new UnifiedModelOperations("claude");
      const models = await ops.listAvailableModels();

      expect(models.length).toBe(1);
      expect(models[0]!.modelID).toBe("claude-sonnet-4");

      getSpy.mockRestore();
    });
  });

  describe("setModel", () => {
    test("for Claude calls sdkSetModel", async () => {
      const mockSdkSetModel = mock(() => Promise.resolve());
      const ops = new UnifiedModelOperations(
        "claude",
        mockSdkSetModel as (model: string) => Promise<void>
      );

      const result = await ops.setModel("anthropic/claude-sonnet-4");

      expect(result.success).toBe(true);
      expect(result.requiresNewSession).toBeUndefined();
      expect(mockSdkSetModel).toHaveBeenCalledWith("anthropic/claude-sonnet-4");
    });

    test("for Claude resolves alias before calling sdkSetModel", async () => {
      const mockSdkSetModel = mock(() => Promise.resolve());
      const ops = new UnifiedModelOperations(
        "claude",
        mockSdkSetModel as (model: string) => Promise<void>
      );

      const result = await ops.setModel("sonnet");

      expect(result.success).toBe(true);
      // Should resolve 'sonnet' alias to 'sonnet' (the SDK resolves it)
      expect(mockSdkSetModel).toHaveBeenCalledWith("sonnet");
    });

    test("for OpenCode calls sdkSetModel", async () => {
      const mockSdkSetModel = mock(() => Promise.resolve());
      const ops = new UnifiedModelOperations(
        "opencode",
        mockSdkSetModel as (model: string) => Promise<void>
      );

      const result = await ops.setModel("anthropic/claude-sonnet-4");

      expect(result.success).toBe(true);
      expect(result.requiresNewSession).toBeUndefined();
      expect(mockSdkSetModel).toHaveBeenCalledWith("anthropic/claude-sonnet-4");
    });

    test("for Copilot returns requiresNewSession: true", async () => {
      const mockSdkSetModel = mock(() => Promise.resolve());
      const ops = new UnifiedModelOperations(
        "copilot",
        mockSdkSetModel as (model: string) => Promise<void>
      );

      const result = await ops.setModel("gpt-4o");

      expect(result.success).toBe(true);
      expect(result.requiresNewSession).toBe(true);
      // SDK should NOT be called for Copilot
      expect(mockSdkSetModel).not.toHaveBeenCalled();
    });

    test("works without sdkSetModel function", async () => {
      const ops = new UnifiedModelOperations("claude");

      const result = await ops.setModel("anthropic/claude-sonnet-4");

      expect(result.success).toBe(true);
    });

    test("throws for invalid providerID/modelID format with empty parts", async () => {
      const ops = new UnifiedModelOperations("claude");

      await expect(ops.setModel("anthropic/")).rejects.toThrow(
        "Invalid model format: 'anthropic/'. Expected 'providerID/modelID' format"
      );

      await expect(ops.setModel("/claude-sonnet-4")).rejects.toThrow(
        "Invalid model format: '/claude-sonnet-4'. Expected 'providerID/modelID' format"
      );
    });

    test("throws for model with multiple slashes", async () => {
      const ops = new UnifiedModelOperations("claude");

      await expect(ops.setModel("anthropic/claude/v4")).rejects.toThrow(
        "Invalid model format: 'anthropic/claude/v4'. Expected 'providerID/modelID' format"
      );
    });

    test("surfaces SDK error for invalid model", async () => {
      const sdkError = new Error("Model 'invalid-model' not found");
      const mockSdkSetModel = mock(() => Promise.reject(sdkError));
      const ops = new UnifiedModelOperations(
        "claude",
        mockSdkSetModel as (model: string) => Promise<void>
      );

      await expect(ops.setModel("invalid-model")).rejects.toThrow(
        "Model 'invalid-model' not found"
      );
    });
  });

  describe("getCurrentModel", () => {
    test("returns current model after setModel", async () => {
      const ops = new UnifiedModelOperations("claude");

      await ops.setModel("anthropic/claude-sonnet-4");
      const current = await ops.getCurrentModel();

      expect(current).toBe("anthropic/claude-sonnet-4");
    });

    test("returns undefined when no model set", async () => {
      const ops = new UnifiedModelOperations("claude");

      const current = await ops.getCurrentModel();

      expect(current).toBeUndefined();
    });

    test("returns resolved alias for Claude", async () => {
      const ops = new UnifiedModelOperations("claude");

      await ops.setModel("sonnet");
      const current = await ops.getCurrentModel();

      // Should be the resolved alias
      expect(current).toBe("sonnet");
    });
  });

  describe("resolveAlias", () => {
    test("returns alias for Claude agent type", () => {
      const ops = new UnifiedModelOperations("claude");

      expect(ops.resolveAlias("sonnet")).toBe("sonnet");
      expect(ops.resolveAlias("opus")).toBe("opus");
      expect(ops.resolveAlias("haiku")).toBe("haiku");
      expect(ops.resolveAlias("default")).toBe("sonnet");
    });

    test("is case-insensitive for Claude aliases", () => {
      const ops = new UnifiedModelOperations("claude");

      expect(ops.resolveAlias("SONNET")).toBe("sonnet");
      expect(ops.resolveAlias("Opus")).toBe("opus");
      expect(ops.resolveAlias("HAIKU")).toBe("haiku");
    });

    test("returns undefined for non-Claude agents", () => {
      const openCodeOps = new UnifiedModelOperations("opencode");
      const copilotOps = new UnifiedModelOperations("copilot");

      expect(openCodeOps.resolveAlias("sonnet")).toBeUndefined();
      expect(openCodeOps.resolveAlias("opus")).toBeUndefined();
      expect(copilotOps.resolveAlias("sonnet")).toBeUndefined();
      expect(copilotOps.resolveAlias("haiku")).toBeUndefined();
    });

    test("returns undefined for unknown alias", () => {
      const ops = new UnifiedModelOperations("claude");

      expect(ops.resolveAlias("unknown-alias")).toBeUndefined();
      expect(ops.resolveAlias("gpt-4")).toBeUndefined();
    });
  });

  describe("getPendingModel", () => {
    test("returns pending model for Copilot after setModel", async () => {
      const ops = new UnifiedModelOperations("copilot");

      await ops.setModel("gpt-4o");
      const pending = ops.getPendingModel();

      expect(pending).toBe("gpt-4o");
    });

    test("returns undefined for Copilot when no model set", () => {
      const ops = new UnifiedModelOperations("copilot");

      const pending = ops.getPendingModel();

      expect(pending).toBeUndefined();
    });

    test("returns undefined for non-Copilot agents after setModel", async () => {
      const claudeOps = new UnifiedModelOperations("claude");
      const openCodeOps = new UnifiedModelOperations("opencode");

      await claudeOps.setModel("sonnet");
      await openCodeOps.setModel("anthropic/claude-sonnet-4");

      expect(claudeOps.getPendingModel()).toBeUndefined();
      expect(openCodeOps.getPendingModel()).toBeUndefined();
    });
  });

  describe("CLAUDE_ALIASES", () => {
    test("contains expected aliases", () => {
      expect(CLAUDE_ALIASES).toHaveProperty("sonnet");
      expect(CLAUDE_ALIASES).toHaveProperty("opus");
      expect(CLAUDE_ALIASES).toHaveProperty("haiku");
      expect(CLAUDE_ALIASES).toHaveProperty("default");
    });

    test("default resolves to sonnet", () => {
      expect(CLAUDE_ALIASES["default"]).toBe("sonnet");
    });
  });
});
