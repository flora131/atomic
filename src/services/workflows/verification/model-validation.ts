/**
 * Model Validation for Workflow Verification
 *
 * Validates that models and reasoning efforts declared in workflow stage
 * `sessionConfig` entries are available for each referenced agent type.
 *
 * This check runs during `atomic workflow verify` and reports errors when
 * a stage references a model or reasoning effort that does not exist for
 * the user's environment.
 */

import type { StageDefinition } from "@/services/workflows/conductor/types.ts";
import type { WorkflowSessionConfig, WorkflowAgentType } from "@/services/workflows/dsl/types.ts";
import type { Model } from "@/services/models/model-transform.ts";
import type { PropertyResult } from "@/services/workflows/verification/types.ts";
import { UnifiedModelOperations } from "@/services/models/model-operations.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelReference {
  stageId: string;
  agentType: WorkflowAgentType;
  model: string;
  reasoningEffort?: string;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract all model + reasoning effort references from stage definitions.
 */
function extractModelReferences(stages: readonly StageDefinition[]): ModelReference[] {
  const refs: ModelReference[] = [];
  const agentTypes: WorkflowAgentType[] = ["claude", "opencode", "copilot"];

  for (const stage of stages) {
    const config = stage.sessionConfig as Partial<WorkflowSessionConfig> | undefined;
    if (!config) continue;

    for (const agentType of agentTypes) {
      const model = config.model?.[agentType];
      if (model) {
        refs.push({
          stageId: stage.id,
          agentType,
          model,
          reasoningEffort: config.reasoningEffort?.[agentType],
        });
      } else if (config.reasoningEffort?.[agentType]) {
        refs.push({
          stageId: stage.id,
          agentType,
          model: "",
          reasoningEffort: config.reasoningEffort[agentType],
        });
      }
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * List available models for an agent type. Returns empty array on failure
 * (e.g., SDK not available).
 */
async function listModelsForAgent(agentType: WorkflowAgentType): Promise<Model[]> {
  try {
    const ops = new UnifiedModelOperations(agentType);
    return await ops.listAvailableModels();
  } catch {
    return [];
  }
}

/**
 * Validate model references against available models.
 *
 * For each agent type referenced in the workflow, lists the available
 * models and checks that every declared model ID exists. Also validates
 * that reasoning effort levels are supported by the target model.
 *
 * Returns a `PropertyResult` suitable for inclusion in `VerificationResult`.
 */
export async function checkModelValidation(
  stages: readonly StageDefinition[],
): Promise<PropertyResult> {
  const refs = extractModelReferences(stages);

  if (refs.length === 0) {
    return { verified: true };
  }

  // Group by agent type to minimize model listing calls
  const byAgent = new Map<WorkflowAgentType, ModelReference[]>();
  for (const ref of refs) {
    const existing = byAgent.get(ref.agentType) ?? [];
    existing.push(ref);
    byAgent.set(ref.agentType, existing);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [agentType, agentRefs] of byAgent) {
    const models = await listModelsForAgent(agentType);

    if (models.length === 0) {
      warnings.push(
        `Could not list ${agentType} models (SDK not available) — ` +
        `skipping validation for: ${agentRefs.map((r) => r.model || "(default)").join(", ")}`,
      );
      continue;
    }

    for (const ref of agentRefs) {
      if (!ref.model) continue;

      // Check if model exists (by id or modelID)
      const matchedModel = models.find(
        (m) => m.id === ref.model || m.modelID === ref.model,
      );

      if (!matchedModel) {
        // Also check aliases for Claude
        if (agentType === "claude") {
          const { CLAUDE_ALIASES } = await import("@/services/models/model-operations.ts");
          const resolved = CLAUDE_ALIASES[ref.model.toLowerCase()];
          if (resolved) {
            const aliasMatch = models.find(
              (m) => m.id === resolved || m.modelID === resolved,
            );
            if (aliasMatch) continue;
          }
        }

        const availableIds = models.map((m) => m.modelID).join(", ");
        errors.push(
          `Stage "${ref.stageId}": model "${ref.model}" not found for ${agentType}. ` +
          `Available: [${availableIds}]`,
        );
        continue;
      }

      // Validate reasoning effort if specified
      if (ref.reasoningEffort) {
        if (!matchedModel.capabilities.reasoning) {
          errors.push(
            `Stage "${ref.stageId}": model "${ref.model}" (${agentType}) does not support reasoning, ` +
            `but reasoningEffort "${ref.reasoningEffort}" was specified`,
          );
        } else if (
          matchedModel.supportedReasoningEfforts?.length &&
          !matchedModel.supportedReasoningEfforts.includes(ref.reasoningEffort)
        ) {
          errors.push(
            `Stage "${ref.stageId}": reasoning effort "${ref.reasoningEffort}" is not supported ` +
            `by model "${ref.model}" (${agentType}). ` +
            `Supported: [${matchedModel.supportedReasoningEfforts.join(", ")}]`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return {
      verified: false,
      counterexample: errors.join("; "),
      details: {
        errors,
        warnings,
      },
    };
  }

  return {
    verified: true,
    details: warnings.length > 0 ? { warnings } : undefined,
  };
}
