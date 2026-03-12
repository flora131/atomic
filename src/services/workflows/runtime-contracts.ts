import { z } from "zod";
import {
  incrementRuntimeParityCounter,
  observeRuntimeParityHistogram,
  runtimeParityDebug,
  setRuntimeParityGauge,
} from "@/services/workflows/runtime-parity-observability.ts";

const WORKFLOW_RUNTIME_TASK_STATUS_VALUES = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "blocked",
  "error",
] as const;

export type WorkflowRuntimeTaskStatus = (typeof WORKFLOW_RUNTIME_TASK_STATUS_VALUES)[number];

export const workflowRuntimeTaskStatusSchema = z.enum(WORKFLOW_RUNTIME_TASK_STATUS_VALUES);

const workflowRuntimeTaskStatusWithFallbackSchema = z
  .string()
  .transform((val): WorkflowRuntimeTaskStatus => {
    const normalized = val.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const result = workflowRuntimeTaskStatusSchema.safeParse(normalized);
    return result.success ? result.data : "pending";
  });

const workflowRuntimeTaskIdentitySchema = z.object({
  canonicalId: z.string().min(1).optional(),
  providerBindings: z.record(z.string(), z.array(z.string())).optional(),
});

export type WorkflowRuntimeTaskIdentity = z.infer<typeof workflowRuntimeTaskIdentitySchema>;

const workflowRuntimeTaskResultEnvelopeSchema = z.object({
  task_id: z.string().min(1),
  tool_name: z.string().min(1),
  title: z.string(),
  metadata: z.object({
    sessionId: z.string().min(1).optional(),
    providerBindings: z.record(z.string(), z.string()).optional(),
  }).optional(),
  status: z.enum(["completed", "error"]),
  output_text: z.string(),
  output_structured: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  envelope_text: z.string().optional(),
});

export type WorkflowRuntimeTaskResultEnvelope = z.infer<typeof workflowRuntimeTaskResultEnvelopeSchema>;

const workflowRuntimeTaskBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: workflowRuntimeTaskStatusWithFallbackSchema,
  blockedBy: z.array(z.string()).optional(),
  error: z.string().optional(),
  identity: workflowRuntimeTaskIdentitySchema.optional(),
  taskResult: workflowRuntimeTaskResultEnvelopeSchema.optional(),
});

export const workflowRuntimeTaskSchema = workflowRuntimeTaskBaseSchema;

export const workflowRuntimeStrictTaskSchema = workflowRuntimeTaskBaseSchema.extend({
  status: workflowRuntimeTaskStatusSchema,
});

export type WorkflowRuntimeTask = z.infer<typeof workflowRuntimeTaskSchema>;

export const workflowRuntimeStateTaskSchema = z.object({
  id: z.string().min(1).optional(),
  description: z.string(),
  status: workflowRuntimeTaskStatusWithFallbackSchema,
  summary: z.string(),
  blockedBy: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export type WorkflowRuntimeStateTask = z.infer<typeof workflowRuntimeStateTaskSchema>;

export const workflowRuntimeTaskStatusChangeSchema = z.object({
  taskIds: z.array(z.string()),
  newStatus: workflowRuntimeTaskStatusWithFallbackSchema,
  tasks: z.array(workflowRuntimeTaskSchema),
});

export type WorkflowRuntimeTaskStatusChangePayload = z.infer<typeof workflowRuntimeTaskStatusChangeSchema>;

export interface WorkflowRuntimeTaskIdentityRuntime {
  backfillTask(task: WorkflowRuntimeTask): WorkflowRuntimeTask;
  backfillTasks(tasks: WorkflowRuntimeTask[]): WorkflowRuntimeTask[];
  bindProviderId(task: WorkflowRuntimeTask, provider: string, providerId: string): WorkflowRuntimeTask;
  resolveCanonicalTaskId(provider: string, providerId: string): string | null;
}

export interface WorkflowRuntimeFeatureFlags {
  emitTaskStatusEvents: boolean;
  persistTaskStatusEvents: boolean;
  strictTaskContract: boolean;
}

export type WorkflowRuntimeFeatureFlagOverrides = Partial<WorkflowRuntimeFeatureFlags>;

export const DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS: WorkflowRuntimeFeatureFlags = {
  emitTaskStatusEvents: true,
  persistTaskStatusEvents: true,
  strictTaskContract: true,
};

export function normalizeWorkflowRuntimeTaskStatus(status: unknown): WorkflowRuntimeTaskStatus {
  if (typeof status !== "string") {
    return "pending";
  }
  return workflowRuntimeTaskStatusWithFallbackSchema.parse(status);
}

function normalizeBlockedBy(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item) => item !== null && item !== undefined)
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? input as Record<string, unknown>
    : {};
}

function normalizeProviderBindings(value: unknown): Record<string, string[]> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const normalized: Record<string, string[]> = {};

  for (const [provider, ids] of Object.entries(record)) {
    const providerKey = provider.trim();
    if (providerKey.length === 0 || !Array.isArray(ids)) {
      continue;
    }

    const deduped = Array.from(new Set(
      ids
        .filter((id) => id !== null && id !== undefined)
        .map((id) => String(id).trim())
        .filter((id) => id.length > 0),
    ));

    if (deduped.length > 0) {
      normalized[providerKey] = deduped;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeTaskIdentity(value: unknown, fallbackCanonicalId: string): WorkflowRuntimeTaskIdentity {
  const record = asRecord(value);
  const canonicalId = typeof record.canonicalId === "string" && record.canonicalId.trim().length > 0
    ? record.canonicalId
    : fallbackCanonicalId;

  return {
    canonicalId,
    providerBindings: normalizeProviderBindings(record.providerBindings),
  };
}

function normalizeTaskResultEnvelope(
  value: unknown,
  fallbackTaskId: string,
  fallbackTitle: string,
  identity?: WorkflowRuntimeTaskIdentity,
): WorkflowRuntimeTaskResultEnvelope | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const taskId = typeof record.task_id === "string" && record.task_id.trim().length > 0
    ? record.task_id
    : fallbackTaskId;
  const toolName = typeof record.tool_name === "string" && record.tool_name.trim().length > 0
    ? record.tool_name
    : "task";
  const title = typeof record.title === "string"
    ? record.title
    : fallbackTitle;
  const status = record.status === "error" ? "error" : "completed";
  const outputText = typeof record.output_text === "string"
    ? record.output_text
    : "";

  let metadata: WorkflowRuntimeTaskResultEnvelope["metadata"];
  if (typeof record.metadata === "object" && record.metadata !== null) {
    const rawMetadata = record.metadata as Record<string, unknown>;
    let providerBindings: Record<string, string> | undefined;
    if (typeof rawMetadata.providerBindings === "object" && rawMetadata.providerBindings !== null) {
      providerBindings = {};
      for (const [provider, providerId] of Object.entries(rawMetadata.providerBindings as Record<string, unknown>)) {
        const normalizedProvider = provider.trim();
        if (normalizedProvider.length === 0 || providerId === null || providerId === undefined) {
          continue;
        }
        const normalizedProviderId = String(providerId).trim();
        if (normalizedProviderId.length === 0) {
          continue;
        }
        providerBindings[normalizedProvider] = normalizedProviderId;
      }
      if (Object.keys(providerBindings).length === 0) {
        providerBindings = undefined;
      }
    }

    const sessionId = typeof rawMetadata.sessionId === "string" && rawMetadata.sessionId.trim().length > 0
      ? rawMetadata.sessionId
      : undefined;

    if (sessionId || providerBindings) {
      metadata = {
        ...(sessionId ? { sessionId } : {}),
        ...(providerBindings ? { providerBindings } : {}),
      };
    }
  }

  let outputStructured: Record<string, unknown> | undefined;
  if (typeof record.output_structured === "object" && record.output_structured !== null && !Array.isArray(record.output_structured)) {
    outputStructured = record.output_structured as Record<string, unknown>;
  }

  const normalized: WorkflowRuntimeTaskResultEnvelope = {
    task_id: taskId,
    tool_name: toolName,
    title,
    ...(metadata ? { metadata } : {}),
    status,
    output_text: outputText,
    ...(outputStructured ? { output_structured: outputStructured } : {}),
    ...(typeof record.error === "string" && record.error.length > 0 ? { error: record.error } : {}),
    ...(typeof record.envelope_text === "string" && record.envelope_text.length > 0
      ? { envelope_text: record.envelope_text }
      : {}),
  };

  try {
    const parsed = workflowRuntimeTaskResultEnvelopeSchema.parse(normalized);
    const expectedTaskId = identity?.canonicalId ?? fallbackTaskId;
    if (parsed.task_id !== expectedTaskId) {
      incrementRuntimeParityCounter("workflow.runtime.parity.task_result_invariant_failures_total", {
        reason: "task_id_mismatch",
      });
      throw new Error(
        `TaskResult envelope task_id mismatch: expected ${expectedTaskId}, received ${parsed.task_id}`,
      );
    }

    if (parsed.metadata?.providerBindings && identity?.providerBindings) {
      for (const [provider, providerId] of Object.entries(parsed.metadata.providerBindings)) {
        const identityBindings = identity.providerBindings[provider] ?? [];
        if (!identityBindings.includes(providerId)) {
          incrementRuntimeParityCounter("workflow.runtime.parity.task_result_invariant_failures_total", {
            reason: "provider_binding_mismatch",
            provider,
          });
          throw new Error(
            `TaskResult envelope provider binding mismatch for ${provider}: expected one of [${identityBindings.join(", ")}], received ${providerId}`,
          );
        }
      }
    }

    incrementRuntimeParityCounter("workflow.runtime.parity.task_result_normalized_total", {
      status: parsed.status,
    });
    setRuntimeParityGauge(
      "workflow.runtime.parity.task_result_provider_bindings",
      Object.keys(parsed.metadata?.providerBindings ?? {}).length,
      { taskId: parsed.task_id },
    );
    runtimeParityDebug("task_result_normalized", {
      taskId: parsed.task_id,
      status: parsed.status,
      providers: Object.keys(parsed.metadata?.providerBindings ?? {}),
    });
    return parsed;
  } catch (error) {
    incrementRuntimeParityCounter("workflow.runtime.parity.task_result_normalization_failures_total", {
      reason: "invalid_envelope",
    });
    runtimeParityDebug("task_result_normalization_failed", {
      fallbackTaskId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function toWorkflowRuntimeTask(
  input: unknown,
  fallbackId: () => string,
): WorkflowRuntimeTask {
  const parsed = workflowRuntimeTaskSchema.safeParse(input);
  if (parsed.success) {
    const rawRecord = asRecord(input);
    const identity = normalizeTaskIdentity(parsed.data.identity, parsed.data.id);
    incrementRuntimeParityCounter("workflow.runtime.parity.task_normalized_total", {
      path: "schema_parse",
    });
    observeRuntimeParityHistogram(
      "workflow.runtime.parity.task_blocked_by_count",
      normalizeBlockedBy(parsed.data.blockedBy)?.length ?? 0,
      { path: "schema_parse" },
    );
    runtimeParityDebug("task_normalized", {
      taskId: parsed.data.id,
      canonicalId: identity.canonicalId,
      hasTaskResult: Boolean(parsed.data.taskResult || rawRecord.task_result),
    });
    return {
      ...parsed.data,
      status: normalizeWorkflowRuntimeTaskStatus(parsed.data.status),
      blockedBy: normalizeBlockedBy(parsed.data.blockedBy),
      identity,
      taskResult: normalizeTaskResultEnvelope(
        parsed.data.taskResult ?? rawRecord.task_result,
        identity.canonicalId ?? parsed.data.id,
        parsed.data.title,
        identity,
      ),
    };
  }

  const record = asRecord(input);
  const title = String(record.title ?? record.description ?? record.content ?? "");
  const id = typeof record.id === "string" && record.id.trim().length > 0
    ? record.id
    : fallbackId();
  const identity = normalizeTaskIdentity(record.identity, id);
  incrementRuntimeParityCounter("workflow.runtime.parity.task_normalized_total", {
    path: "fallback_parse",
  });
  observeRuntimeParityHistogram(
    "workflow.runtime.parity.task_blocked_by_count",
    normalizeBlockedBy(record.blockedBy)?.length ?? 0,
    { path: "fallback_parse" },
  );
  runtimeParityDebug("task_normalized_fallback", {
    taskId: id,
    canonicalId: identity.canonicalId,
    hasTaskResult: Boolean(record.taskResult ?? record.task_result),
  });

  return {
    id,
    title,
    status: normalizeWorkflowRuntimeTaskStatus(record.status),
    blockedBy: normalizeBlockedBy(record.blockedBy),
    error: typeof record.error === "string" && record.error.length > 0
      ? record.error
      : undefined,
    identity,
    taskResult: normalizeTaskResultEnvelope(
      record.taskResult ?? record.task_result,
      id,
      title,
      identity,
    ),
  };
}

export function toWorkflowRuntimeTasks(
  input: unknown,
  fallbackId: () => string,
): WorkflowRuntimeTask[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((task) => toWorkflowRuntimeTask(task, fallbackId));
}

export function resolveWorkflowRuntimeFeatureFlags(
  ...overrides: Array<WorkflowRuntimeFeatureFlagOverrides | undefined>
): WorkflowRuntimeFeatureFlags {
  return overrides.reduce<WorkflowRuntimeFeatureFlags>(
    (resolved, next) => (next ? { ...resolved, ...next } : resolved),
    { ...DEFAULT_WORKFLOW_RUNTIME_FEATURE_FLAGS },
  );
}
