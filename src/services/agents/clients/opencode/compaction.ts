import {
  BACKGROUND_COMPACTION_THRESHOLD,
  computeCompactionThresholdPercent,
} from "@/services/workflows/graph/types.ts";
import {
  incrementRuntimeParityCounter,
  runtimeParityDebug,
} from "@/services/workflows/runtime-parity-observability.ts";

export const AUTO_COMPACTION_THRESHOLD = BACKGROUND_COMPACTION_THRESHOLD;
export { computeCompactionThresholdPercent };
export const MAX_COMPACTION_WAIT_MS = 15_000;
export const COMPACTION_TERMINAL_ERROR_MESSAGE =
  "Compaction failed, please start a new chat.";

export type OpenCodeCompactionControlState =
  | "STREAMING"
  | "COMPACTING"
  | "TERMINAL_ERROR"
  | "ENDED";

export type OpenCodeCompactionErrorCode =
  | "COMPACTION_TIMEOUT"
  | "COMPACTION_FAILED"
  | "COMPACTION_INVALID_STATE";

export interface OpenCodeCompactionControl {
  state: OpenCodeCompactionControlState;
  startedAt: number | null;
  errorCode?: OpenCodeCompactionErrorCode;
  errorMessage?: string;
}

export interface OpenCodeSessionCompactionState {
  isCompacting: boolean;
  hasAutoCompacted: boolean;
  pendingCompactionComplete: boolean;
  lastCompactionCompleteAt: number | null;
  control: OpenCodeCompactionControl;
}

export class OpenCodeCompactionError extends Error {
  readonly code: OpenCodeCompactionErrorCode;

  constructor(code: OpenCodeCompactionErrorCode, message: string) {
    super(message);
    this.name = "OpenCodeCompactionError";
    this.code = code;
  }
}

type OpenCodeCompactionControlEvent =
  | "stream.start"
  | "compaction.start"
  | "compaction.complete.success"
  | "compaction.complete.error"
  | "turn.ended";

export function transitionOpenCodeCompactionControl(
  current: OpenCodeCompactionControl,
  event: OpenCodeCompactionControlEvent,
  options?: {
    now?: number;
    errorCode?: OpenCodeCompactionErrorCode;
    errorMessage?: string;
  },
): OpenCodeCompactionControl {
  const now = options?.now ?? Date.now();

  switch (event) {
    case "stream.start":
      return { state: "STREAMING", startedAt: null };
    case "compaction.start":
      if (current.state !== "STREAMING") {
        throw new OpenCodeCompactionError(
          "COMPACTION_INVALID_STATE",
          COMPACTION_TERMINAL_ERROR_MESSAGE,
        );
      }
      return { state: "COMPACTING", startedAt: now };
    case "compaction.complete.success":
      if (current.state === "TERMINAL_ERROR" || current.state === "ENDED") {
        return current;
      }
      return { state: "STREAMING", startedAt: null };
    case "compaction.complete.error":
      if (current.state === "TERMINAL_ERROR" || current.state === "ENDED") {
        return current;
      }
      if (current.state !== "COMPACTING") {
        throw new OpenCodeCompactionError(
          "COMPACTION_INVALID_STATE",
          COMPACTION_TERMINAL_ERROR_MESSAGE,
        );
      }
      return {
        state: "TERMINAL_ERROR",
        startedAt: current.startedAt ?? now,
        errorCode: options?.errorCode ?? "COMPACTION_FAILED",
        errorMessage:
          options?.errorMessage ?? COMPACTION_TERMINAL_ERROR_MESSAGE,
      };
    case "turn.ended":
      if (current.state !== "TERMINAL_ERROR") {
        return current;
      }
      return {
        state: "ENDED",
        startedAt: current.startedAt,
        errorCode: current.errorCode,
        errorMessage: current.errorMessage,
      };
  }
}

export function setCompactionControlState(
  sessionState: { compaction: OpenCodeSessionCompactionState },
  event: OpenCodeCompactionControlEvent,
  options?: {
    now?: number;
    errorCode?: OpenCodeCompactionErrorCode;
    errorMessage?: string;
  },
): void {
  sessionState.compaction.control = transitionOpenCodeCompactionControl(
    sessionState.compaction.control,
    event,
    options,
  );
  sessionState.compaction.isCompacting =
    sessionState.compaction.control.state === "COMPACTING";
}

export function toOpenCodeCompactionTerminalError(
  error: unknown,
): OpenCodeCompactionError {
  if (error instanceof OpenCodeCompactionError) {
    return error;
  }

  return new OpenCodeCompactionError(
    "COMPACTION_FAILED",
    COMPACTION_TERMINAL_ERROR_MESSAGE,
  );
}

export function emitOpenCodeCompactionContractFailureObservability(args: {
  sessionId: string;
  code: OpenCodeCompactionErrorCode;
  sourceError: string;
  terminalError: string;
}): void {
  incrementRuntimeParityCounter(
    "workflow.runtime.parity.compaction_timeout_terminated_total",
    {
      provider: "opencode",
      code: args.code,
    },
  );
  incrementRuntimeParityCounter(
    "workflow.runtime.parity.turn_terminated_due_to_contract_error_total",
    {
      provider: "opencode",
      reason: "compaction_terminal_error",
      code: args.code,
    },
  );
  runtimeParityDebug("compaction_contract_failure", {
    provider: "opencode",
    sessionId: args.sessionId,
    code: args.code,
    sourceError: args.sourceError,
    terminalError: args.terminalError,
  });
}

export async function withCompactionTimeout<T>(
  operation: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new OpenCodeCompactionError(
              "COMPACTION_TIMEOUT",
              COMPACTION_TERMINAL_ERROR_MESSAGE,
            ),
          );
        }, MAX_COMPACTION_WAIT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
