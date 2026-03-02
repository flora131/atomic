import type { SubagentStreamResult } from "./graph/types.ts";
import {
  type WorkflowRuntimeTask,
  workflowRuntimeTaskSchema,
  type WorkflowRuntimeTaskResultEnvelope,
} from "./runtime-contracts.ts";

const DEFAULT_TOOL_NAME = "task";
const DEFAULT_PROVIDER = "subagent_id";

interface BuildTaskResultEnvelopeInput {
  task: WorkflowRuntimeTask;
  result: Pick<SubagentStreamResult, "success" | "output" | "error" | "agentId">;
  sessionId?: string;
  provider?: string;
  toolName?: string;
  outputStructured?: Record<string, unknown>;
}

function normalizeToken(value: string): string {
  return value.trim();
}

function firstBinding(task: WorkflowRuntimeTask, provider: string): string | undefined {
  const bindings = task.identity?.providerBindings;
  if (!bindings) {
    return undefined;
  }
  const key = provider.trim().toLowerCase();
  for (const [bindingProvider, ids] of Object.entries(bindings)) {
    if (bindingProvider.trim().toLowerCase() !== key) {
      continue;
    }
    const first = ids[0];
    if (typeof first === "string" && first.trim().length > 0) {
      return first;
    }
  }
  return undefined;
}

export function formatTaskResultEnvelopeText(taskId: string, outputText: string): string {
  return [
    `task_id: ${taskId} (for resuming to continue this task if needed)`,
    "",
    "<task_result>",
    outputText,
    "</task_result>",
  ].join("\n");
}

export function buildTaskResultEnvelope(
  input: BuildTaskResultEnvelopeInput,
): WorkflowRuntimeTaskResultEnvelope {
  const task = workflowRuntimeTaskSchema.parse(input.task);
  const canonicalTaskId = task.identity?.canonicalId ?? task.id;
  const provider = normalizeToken(input.provider ?? DEFAULT_PROVIDER);
  const providerId = firstBinding(task, provider) ?? input.result.agentId;
  const outputText = typeof input.result.output === "string" ? input.result.output : "";
  const status: WorkflowRuntimeTaskResultEnvelope["status"] = input.result.success ? "completed" : "error";

  return {
    task_id: canonicalTaskId,
    tool_name: normalizeToken(input.toolName ?? DEFAULT_TOOL_NAME) || DEFAULT_TOOL_NAME,
    title: task.title,
    ...(input.sessionId || providerId
      ? {
        metadata: {
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(providerId ? { providerBindings: { [provider || DEFAULT_PROVIDER]: providerId } } : {}),
        },
      }
      : {}),
    status,
    output_text: outputText,
    ...(input.outputStructured ? { output_structured: input.outputStructured } : {}),
    ...(!input.result.success && input.result.error ? { error: input.result.error } : {}),
    envelope_text: formatTaskResultEnvelopeText(canonicalTaskId, outputText),
  };
}
