import type {
  WorkflowRuntimeTask,
  WorkflowRuntimeTaskIdentity,
  WorkflowRuntimeTaskIdentityRuntime,
} from "./runtime-contracts.ts";

const TASK_ID_PROVIDER = "task_id";

function normalizeToken(value: string): string {
  return value.trim();
}

function normalizeProvider(value: string): string {
  return normalizeToken(value).toLowerCase();
}

function normalizeTaskKey(value: string): string {
  return normalizeToken(value).toLowerCase();
}

function toCanonicalTaskAlias(taskId: string): string | null {
  const normalized = normalizeTaskKey(taskId).replace(/^#/, "");
  return normalized.length > 0 ? normalized : null;
}

function cloneProviderBindings(identity: WorkflowRuntimeTaskIdentity): Record<string, string[]> {
  const cloned: Record<string, string[]> = {};
  const bindings = identity.providerBindings;
  if (!bindings) {
    return cloned;
  }

  for (const [provider, ids] of Object.entries(bindings)) {
    if (!Array.isArray(ids) || ids.length === 0) {
      continue;
    }

    const normalizedProvider = normalizeProvider(provider);
    if (normalizedProvider.length === 0) {
      continue;
    }

    const deduped = Array.from(new Set(ids.map((id) => normalizeToken(id)).filter((id) => id.length > 0)));
    if (deduped.length > 0) {
      cloned[normalizedProvider] = deduped;
    }
  }

  return cloned;
}

function upsertBinding(bindings: Record<string, string[]>, provider: string, providerId: string): boolean {
  const providerKey = normalizeProvider(provider);
  const providerValue = normalizeToken(providerId);
  if (providerKey.length === 0 || providerValue.length === 0) {
    return false;
  }

  const ids = bindings[providerKey] ?? [];
  if (!ids.includes(providerValue)) {
    bindings[providerKey] = [...ids, providerValue];
    return true;
  }

  if (!bindings[providerKey]) {
    bindings[providerKey] = ids;
  }
  return false;
}

/**
 * Maintains canonical task IDs and provider-specific task ID bindings.
 *
 * Backfill behavior:
 * - Pre-existing tasks without identity metadata are assigned canonical IDs.
 * - `task_id` provider bindings are synthesized from task IDs.
 * - Legacy `#id` and bare `id` aliases are both registered for lookup.
 */
export class TaskIdentityService implements WorkflowRuntimeTaskIdentityRuntime {
  private readonly providerIdToCanonicalTaskId = new Map<string, string>();
  private readonly canonicalAliases = new Map<string, string>();

  backfillTask(task: WorkflowRuntimeTask): WorkflowRuntimeTask {
    const canonicalId = normalizeToken(task.id);
    const identity = this.withBackfilledIdentity(task.identity, canonicalId);

    const normalizedTask: WorkflowRuntimeTask = {
      ...task,
      id: canonicalId,
      identity,
    };

    this.registerTask(normalizedTask);
    return normalizedTask;
  }

  backfillTasks(tasks: WorkflowRuntimeTask[]): WorkflowRuntimeTask[] {
    return tasks.map((task) => this.backfillTask(task));
  }

  bindProviderId(task: WorkflowRuntimeTask, provider: string, providerId: string): WorkflowRuntimeTask {
    const normalizedTask = this.backfillTask(task);
    const bindings = cloneProviderBindings(normalizedTask.identity ?? { canonicalId: normalizedTask.id });
    const changed = upsertBinding(bindings, provider, providerId);

    if (!changed) {
      this.registerTask(normalizedTask);
      return normalizedTask;
    }

    const boundTask: WorkflowRuntimeTask = {
      ...normalizedTask,
      identity: {
        canonicalId: normalizedTask.id,
        providerBindings: bindings,
      },
    };

    this.registerTask(boundTask);
    return boundTask;
  }

  resolveCanonicalTaskId(provider: string, providerId: string): string | null {
    const key = this.providerBindingKey(provider, providerId);
    if (!key) {
      return null;
    }

    const direct = this.providerIdToCanonicalTaskId.get(key);
    if (direct) {
      return direct;
    }

    if (normalizeProvider(provider) !== TASK_ID_PROVIDER) {
      return null;
    }

    const alias = toCanonicalTaskAlias(providerId);
    if (!alias) {
      return null;
    }

    return this.canonicalAliases.get(alias) ?? null;
  }

  private withBackfilledIdentity(
    rawIdentity: WorkflowRuntimeTaskIdentity | undefined,
    canonicalId: string,
  ): WorkflowRuntimeTaskIdentity {
    const identity: WorkflowRuntimeTaskIdentity = {
      canonicalId,
      providerBindings: cloneProviderBindings(rawIdentity ?? { canonicalId }),
    };

    upsertBinding(identity.providerBindings ?? {}, TASK_ID_PROVIDER, canonicalId);

    const alias = toCanonicalTaskAlias(canonicalId);
    if (alias && alias !== normalizeTaskKey(canonicalId)) {
      upsertBinding(identity.providerBindings ?? {}, TASK_ID_PROVIDER, alias);
    }

    if (identity.providerBindings && Object.keys(identity.providerBindings).length === 0) {
      identity.providerBindings = undefined;
    }

    return identity;
  }

  private registerTask(task: WorkflowRuntimeTask): void {
    const canonicalId = normalizeToken(task.id);
    const alias = toCanonicalTaskAlias(canonicalId);
    if (alias) {
      if (!this.canonicalAliases.has(alias)) {
        this.canonicalAliases.set(alias, canonicalId);
      }
      if (!this.canonicalAliases.has(normalizeTaskKey(canonicalId))) {
        this.canonicalAliases.set(normalizeTaskKey(canonicalId), canonicalId);
      }
    }

    const providerBindings = task.identity?.providerBindings;
    if (!providerBindings) {
      return;
    }

    for (const [provider, ids] of Object.entries(providerBindings)) {
      for (const id of ids) {
        const key = this.providerBindingKey(provider, id);
        if (!key || this.providerIdToCanonicalTaskId.has(key)) {
          continue;
        }
        this.providerIdToCanonicalTaskId.set(key, canonicalId);
      }
    }
  }

  private providerBindingKey(provider: string, providerId: string): string | null {
    const normalizedProvider = normalizeProvider(provider);
    const normalizedProviderId = normalizeToken(providerId);
    if (normalizedProvider.length === 0 || normalizedProviderId.length === 0) {
      return null;
    }
    return `${normalizedProvider}::${normalizedProviderId}`;
  }
}
