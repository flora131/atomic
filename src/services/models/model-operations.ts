import type { Model } from "@/services/models/model-transform.ts";
import { CLAUDE_ALIASES, listClaudeModels, normalizeClaudeModelInput, type ClaudeSdkListModelsFn } from "@/services/models/model-operations/claude.ts";
import { listCopilotModels, type CopilotSdkListModelsFn } from "@/services/models/model-operations/copilot.ts";
import { listOpenCodeModels, type OpenCodeSdkListProvidersFn } from "@/services/models/model-operations/opencode.ts";

export { CLAUDE_ALIASES } from "@/services/models/model-operations/claude.ts";

export type AgentType = "claude" | "opencode" | "copilot";

export interface SetModelResult {
  success: boolean;
  requiresNewSession?: boolean;
}

export interface ModelOperations {
  listAvailableModels(): Promise<Model[]>;
  invalidateModelCache?(): void;
  setModel(model: string): Promise<SetModelResult>;
  getCurrentModel(): Promise<string | undefined>;
  resolveAlias(alias: string): string | undefined;
  getPendingModel?(): string | undefined;
}

type SdkSetModelFn = (
  model: string,
  options?: { reasoningEffort?: string }
) => Promise<void>;

export class UnifiedModelOperations implements ModelOperations {
  private currentModel?: string;
  private pendingModel?: string;
  private pendingReasoningEffort?: string;
  private cachedModels: Model[] | null = null;

  constructor(
    private agentType: AgentType,
    private sdkSetModel?: SdkSetModelFn,
    private sdkListModels?: ClaudeSdkListModelsFn,
    initialModel?: string,
    private sdkListCopilotModels?: CopilotSdkListModelsFn,
    private sdkListOpenCodeProviders?: OpenCodeSdkListProvidersFn,
  ) {
    this.currentModel = this.agentType === "claude" && initialModel
      ? normalizeClaudeModelInput(initialModel)
      : initialModel;
  }

  async listAvailableModels(): Promise<Model[]> {
    if (this.cachedModels) {
      return this.cachedModels;
    }

    const models = await this.loadAvailableModels();
    this.cachedModels = models;
    return models;
  }

  invalidateModelCache(): void {
    this.cachedModels = null;
  }

  async setModel(model: string): Promise<SetModelResult> {
    let modelId = model;
    if (model.includes("/")) {
      const parts = model.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(
          `Invalid model format: '${model}'. Expected 'providerID/modelID' format (e.g., 'anthropic/claude-sonnet-4').`
        );
      }
      if (this.agentType === "claude") {
        modelId = parts[1];
      }
    }

    if (this.agentType === "claude" && modelId.toLowerCase() === "default") {
      throw new Error("Model 'default' is not supported for Claude. Use one of: opus, sonnet, haiku.");
    }

    let resolvedModel: string;
    try {
      resolvedModel = this.resolveAlias(modelId) ?? modelId;
    } catch {
      resolvedModel = modelId;
    }

    if (this.shouldValidateSelectedModel()) {
      await this.validateModelExists(resolvedModel);
    }

    const sanitizedReasoningEffort =
      this.agentType === "copilot" || this.agentType === "opencode" || this.agentType === "claude"
      ? await this.sanitizeReasoningEffortForModel(
          resolvedModel,
          this.pendingReasoningEffort,
        )
      : undefined;

    if (this.sdkSetModel) {
      await this.sdkSetModel(
        resolvedModel,
        sanitizedReasoningEffort !== undefined
          ? { reasoningEffort: sanitizedReasoningEffort }
          : undefined,
      );
      this.pendingReasoningEffort = sanitizedReasoningEffort;
      this.pendingModel = undefined;
      this.currentModel = resolvedModel;
      return { success: true };
    }

    if (this.agentType === "copilot") {
      this.pendingReasoningEffort = sanitizedReasoningEffort;
      this.pendingModel = resolvedModel;
      return { success: true, requiresNewSession: true };
    }

    this.pendingReasoningEffort = sanitizedReasoningEffort;
    this.currentModel = resolvedModel;
    return { success: true };
  }

  async sanitizeReasoningEffortForModel(
    model: string,
    effort: string | undefined,
  ): Promise<string | undefined> {
    if (
      (
        this.agentType !== "copilot"
        && this.agentType !== "opencode"
        && this.agentType !== "claude"
      )
      || effort === undefined
    ) {
      return effort;
    }

    const targetModel = await this.getValidatedModelRecord(model);
    if (!targetModel) {
      return undefined;
    }

    if (this.agentType === "opencode") {
      return targetModel.supportedReasoningEfforts?.includes(effort)
        ? effort
        : undefined;
    }

    if (targetModel.supportedReasoningEfforts?.length) {
      return targetModel.supportedReasoningEfforts.includes(effort)
        ? effort
        : undefined;
    }

    return targetModel.capabilities.reasoning ? effort : undefined;
  }

  async getCurrentModel(): Promise<string | undefined> {
    if (this.agentType === "claude" && this.currentModel) {
      return normalizeClaudeModelInput(this.currentModel);
    }
    return this.currentModel;
  }

  resolveAlias(alias: string): string | undefined {
    if (this.agentType === "claude") {
      return CLAUDE_ALIASES[alias.toLowerCase()];
    }
    return undefined;
  }

  getPendingModel(): string | undefined {
    return this.pendingModel;
  }

  setPendingReasoningEffort(effort: string | undefined): void {
    this.pendingReasoningEffort = effort;
  }

  getPendingReasoningEffort(): string | undefined {
    return this.pendingReasoningEffort;
  }

  private shouldValidateSelectedModel(): boolean {
    if (this.agentType === "copilot") {
      return true;
    }

    if (this.agentType === "opencode") {
      return true;
    }

    return this.cachedModels !== null || this.sdkListModels !== undefined;
  }

  private async loadAvailableModels(): Promise<Model[]> {
    switch (this.agentType) {
      case "claude":
        return listClaudeModels(this.sdkListModels);
      case "copilot":
        return listCopilotModels(this.sdkListCopilotModels);
      case "opencode":
        return listOpenCodeModels(this.sdkListOpenCodeProviders);
      default:
        throw new Error(`Unsupported agent type: ${this.agentType}`);
    }
  }

  private async getValidatedModelRecord(model: string): Promise<Model | undefined> {
    if (!this.cachedModels) {
      this.cachedModels = await this.listAvailableModels();
    }

    return this.cachedModels.find(
      (entry) => entry.id === model || entry.modelID === model
    );
  }

  private async validateModelExists(model: string): Promise<void> {
    const found = await this.getValidatedModelRecord(model);
    if (!found) {
      throw new Error(
        `Model '${model}' is not available. Use /model to see available models.`
      );
    }
  }
}
