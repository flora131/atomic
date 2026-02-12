import { test, expect, describe, mock } from "bun:test";
import {
  UnifiedModelOperations,
  CLAUDE_ALIASES,
} from "../model-operations";

describe("UnifiedModelOperations", () => {
  describe("listAvailableModels", () => {
    test("for Claude throws when no sdkListModels callback provided", async () => {
      const ops = new UnifiedModelOperations("claude");
      expect(ops.listAvailableModels()).rejects.toThrow(
        "Claude model listing requires an active session"
      );
    });

    test("for Copilot returns fallback models when SDK fails", async () => {
      const ops = new UnifiedModelOperations("copilot");
      const models = await ops.listAvailableModels();

      // Should return fallback models
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      // All should be github-copilot provider
      for (const model of models) {
        expect(model.providerID).toBe("github-copilot");
      }
    });

    test("for OpenCode throws when SDK server is unavailable", async () => {
      const ops = new UnifiedModelOperations("opencode");
      await expect(ops.listAvailableModels()).rejects.toThrow();
    });
  });

  describe("setModel", () => {
    test("for Claude calls sdkSetModel with modelID only", async () => {
      const mockSdkSetModel = mock(() => Promise.resolve());
      const ops = new UnifiedModelOperations(
        "claude",
        mockSdkSetModel as (model: string) => Promise<void>
      );

      // When given providerID/modelID format, Claude extracts just the modelID
      const result = await ops.setModel("anthropic/claude-sonnet-4");

      expect(result.success).toBe(true);
      expect(result.requiresNewSession).toBeUndefined();
      // Claude SDK receives just the modelID part
      expect(mockSdkSetModel).toHaveBeenCalledWith("claude-sonnet-4");
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

    test("for OpenCode calls sdkSetModel after validation", async () => {
      const mockSdkSetModel = mock(() => Promise.resolve());
      const ops = new UnifiedModelOperations(
        "opencode",
        mockSdkSetModel as (model: string) => Promise<void>
      );

      // Pre-populate the model cache so validation passes without SDK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ops as any).cachedModels = [
        { id: "anthropic/claude-sonnet-4", modelID: "claude-sonnet-4", providerID: "anthropic" },
      ];

      const result = await ops.setModel("anthropic/claude-sonnet-4");

      expect(result.success).toBe(true);
      expect(result.requiresNewSession).toBeUndefined();
      expect(mockSdkSetModel).toHaveBeenCalledWith("anthropic/claude-sonnet-4");
    });

    test("for OpenCode rejects invalid model", async () => {
      const mockSdkSetModel = mock(() => Promise.resolve());
      const ops = new UnifiedModelOperations(
        "opencode",
        mockSdkSetModel as (model: string) => Promise<void>
      );

      // Pre-populate with a different model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ops as any).cachedModels = [
        { id: "anthropic/claude-sonnet-4", modelID: "claude-sonnet-4", providerID: "anthropic" },
      ];

      await expect(ops.setModel("openai/nonexistent-model")).rejects.toThrow(
        "Model 'openai/nonexistent-model' is not available"
      );
      expect(mockSdkSetModel).not.toHaveBeenCalled();
    });

    test("for Copilot returns requiresNewSession: true after validation", async () => {
      const mockSdkSetModel = mock(() => Promise.resolve());
      const ops = new UnifiedModelOperations(
        "copilot",
        mockSdkSetModel as (model: string) => Promise<void>
      );

      // Pre-populate the model cache so validation passes without SDK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ops as any).cachedModels = [
        { id: "github-copilot/gpt-4o", modelID: "gpt-4o", providerID: "github-copilot" },
      ];

      const result = await ops.setModel("gpt-4o");

      expect(result.success).toBe(true);
      expect(result.requiresNewSession).toBe(true);
      // SDK should NOT be called for Copilot
      expect(mockSdkSetModel).not.toHaveBeenCalled();
    });

    test("for Copilot rejects invalid model", async () => {
      const ops = new UnifiedModelOperations("copilot");

      // Pre-populate with a different model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ops as any).cachedModels = [
        { id: "github-copilot/gpt-4o", modelID: "gpt-4o", providerID: "github-copilot" },
      ];

      await expect(ops.setModel("nonexistent-model")).rejects.toThrow(
        "Model 'nonexistent-model' is not available"
      );
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

      // For Claude, the modelID is extracted from providerID/modelID format
      await ops.setModel("anthropic/claude-sonnet-4");
      const current = await ops.getCurrentModel();

      expect(current).toBe("claude-sonnet-4");
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
      expect(ops.resolveAlias("default")).toBeUndefined();
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

      // Pre-populate cache for validation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ops as any).cachedModels = [
        { id: "github-copilot/gpt-4o", modelID: "gpt-4o", providerID: "github-copilot" },
      ];

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

      // Pre-populate OpenCode cache for validation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (openCodeOps as any).cachedModels = [
        { id: "anthropic/claude-sonnet-4", modelID: "claude-sonnet-4", providerID: "anthropic" },
      ];

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
    });
  });
});
