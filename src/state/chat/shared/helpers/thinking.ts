import type { StreamingMeta, ThinkingDropDiagnostics } from "@/state/chat/shared/types/index.ts";

type ThinkingSourceLifecycleAction = "create" | "update" | "finalize" | "drop";

const THINKING_SOURCE_DIAGNOSTICS_DEBUG = process.env.ATOMIC_THINKING_DIAGNOSTICS_DEBUG === "1";

export function createThinkingDropDiagnostics(): ThinkingDropDiagnostics {
  return {
    droppedStaleOrClosedThinkingEvents: 0,
    droppedMissingBindingThinkingEvents: 0,
  };
}

export function traceThinkingSourceLifecycle(
  action: ThinkingSourceLifecycleAction,
  sourceKey: string,
  detail?: string,
): void {
  if (!THINKING_SOURCE_DIAGNOSTICS_DEBUG) {
    return;
  }
  const suffix = detail ? ` ${detail}` : "";
  console.debug(`[thinking-source] ${action} ${sourceKey}${suffix}`);
}

function addThinkingSourceKey(sourceKeys: Set<string>, key: unknown): void {
  if (typeof key !== "string") {
    return;
  }
  const normalized = key.trim();
  if (normalized.length === 0) {
    return;
  }
  sourceKeys.add(normalized);
}

function addThinkingSourceKeysFromRecord(
  sourceKeys: Set<string>,
  sourceRecord: Record<string, unknown> | undefined,
): void {
  if (!sourceRecord) {
    return;
  }
  for (const key of Object.keys(sourceRecord)) {
    addThinkingSourceKey(sourceKeys, key);
  }
}

export function mergeClosedThinkingSources(
  closedSources: ReadonlySet<string>,
  meta: StreamingMeta | null | undefined,
): Set<string> {
  const merged = new Set(closedSources);
  if (!meta) {
    return merged;
  }

  addThinkingSourceKey(merged, meta.thinkingSourceKey);
  addThinkingSourceKeysFromRecord(merged, meta.thinkingTextBySource);
  addThinkingSourceKeysFromRecord(merged, meta.thinkingGenerationBySource);
  addThinkingSourceKeysFromRecord(merged, meta.thinkingMessageBySource);

  return merged;
}

export function resolveValidatedThinkingMetaEvent(
  meta: StreamingMeta,
  expectedMessageId: string,
  closedSources?: ReadonlySet<string>,
  diagnostics?: ThinkingDropDiagnostics,
): {
  thinkingSourceKey: string;
  targetMessageId: string;
  streamGeneration: number;
  thinkingText: string;
} | null {
  const recordDrop = (
    category: "stale_or_closed" | "missing_binding",
    sourceKey: string,
    detail: string,
  ): null => {
    if (category === "stale_or_closed") {
      if (diagnostics) {
        diagnostics.droppedStaleOrClosedThinkingEvents += 1;
      }
      traceThinkingSourceLifecycle("drop", sourceKey, `(stale/closed) ${detail}`);
      return null;
    }

    if (diagnostics) {
      diagnostics.droppedMissingBindingThinkingEvents += 1;
    }
    traceThinkingSourceLifecycle("drop", sourceKey, `(missing-binding) ${detail}`);
    return null;
  };

  const sourceKey = typeof meta.thinkingSourceKey === "string"
    ? meta.thinkingSourceKey.trim()
    : "";
  if (sourceKey.length === 0) {
    return null;
  }
  if (closedSources?.has(sourceKey)) {
    return recordDrop("stale_or_closed", sourceKey, "source already finalized");
  }

  const sourceTargetMessageId = meta.thinkingMessageBySource?.[sourceKey];
  const resolvedTargetMessageId =
    typeof sourceTargetMessageId === "string" && sourceTargetMessageId.length > 0
      ? sourceTargetMessageId
      : expectedMessageId;
  if (resolvedTargetMessageId !== expectedMessageId) {
    return recordDrop("stale_or_closed", sourceKey, "targetMessageId mismatch");
  }

  const sourceGeneration = meta.thinkingGenerationBySource?.[sourceKey];
  if (typeof sourceGeneration !== "number" || !Number.isFinite(sourceGeneration)) {
    return recordDrop("missing_binding", sourceKey, "missing streamGeneration binding");
  }

  return {
    thinkingSourceKey: sourceKey,
    targetMessageId: resolvedTargetMessageId,
    streamGeneration: sourceGeneration,
    thinkingText: meta.thinkingTextBySource?.[sourceKey] ?? meta.thinkingText,
  };
}
