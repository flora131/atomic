import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { StreamMessageOptions } from "@/commands/tui/registry.ts";
import {
  type StreamRunHandle,
  type StreamRunResult,
  StreamRunRuntime,
} from "@/state/runtime/stream-run-runtime.ts";

interface UseChatRunTrackingArgs {
  activeForegroundRunHandleIdRef: MutableRefObject<string | null>;
  awaitedStreamRunIdsRef: MutableRefObject<Set<string>>;
  streamRunRuntimeRef: MutableRefObject<StreamRunRuntime>;
}

export function useChatRunTracking({
  activeForegroundRunHandleIdRef,
  awaitedStreamRunIdsRef,
  streamRunRuntimeRef,
}: UseChatRunTrackingArgs) {
  const getActiveStreamRunId = useCallback((): string | null => {
    return activeForegroundRunHandleIdRef.current;
  }, [activeForegroundRunHandleIdRef]);

  const shouldHideActiveStreamContent = useCallback((): boolean => {
    return streamRunRuntimeRef.current.isHidden(activeForegroundRunHandleIdRef.current);
  }, [activeForegroundRunHandleIdRef, streamRunRuntimeRef]);

  const startTrackedAssistantRun = useCallback((options?: StreamMessageOptions): StreamRunHandle => {
    const handle = streamRunRuntimeRef.current.startRun({
      kind: options?.runKind,
      visibility: options?.visibility,
      parentRunId: options?.parentRunId,
    });
    activeForegroundRunHandleIdRef.current = handle.runId;
    return handle;
  }, [activeForegroundRunHandleIdRef, streamRunRuntimeRef]);

  const bindTrackedRunToMessage = useCallback((runId: string | null | undefined, messageId: string) => {
    if (!runId) return;
    streamRunRuntimeRef.current.bindMessage(runId, messageId);
  }, [streamRunRuntimeRef]);

  const resolveTrackedRun = useCallback((
    action: "complete" | "interrupt" | "fail",
    overrides: Partial<StreamRunResult> = {},
    options?: { runId?: string | null; clearActive?: boolean },
  ): StreamRunResult | null => {
    const runId = options?.runId ?? activeForegroundRunHandleIdRef.current;
    let result: StreamRunResult | null = null;

    if (action === "complete") {
      result = streamRunRuntimeRef.current.completeRun(runId, overrides);
    } else if (action === "interrupt") {
      result = streamRunRuntimeRef.current.interruptRun(runId, overrides);
    } else {
      result = streamRunRuntimeRef.current.failRun(runId, overrides);
    }

    if ((options?.clearActive ?? true) && runId && activeForegroundRunHandleIdRef.current === runId) {
      activeForegroundRunHandleIdRef.current = streamRunRuntimeRef.current.getActiveForegroundRunId();
    }

    return result;
  }, [activeForegroundRunHandleIdRef, streamRunRuntimeRef]);

  const trackAwaitedRun = useCallback((handle: StreamRunHandle | null): StreamRunHandle | null => {
    if (!handle) return null;
    awaitedStreamRunIdsRef.current.add(handle.runId);
    void handle.result.finally(() => {
      awaitedStreamRunIdsRef.current.delete(handle.runId);
    });
    return handle;
  }, [awaitedStreamRunIdsRef]);

  return {
    bindTrackedRunToMessage,
    getActiveStreamRunId,
    resolveTrackedRun,
    shouldHideActiveStreamContent,
    startTrackedAssistantRun,
    trackAwaitedRun,
  };
}
