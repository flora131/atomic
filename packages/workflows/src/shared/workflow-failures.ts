import type { WorkflowFailureKind } from "./store-types.js";

export interface WorkflowFailure {
  readonly kind: WorkflowFailureKind;
  /** Original error text, preserved for diagnostics. */
  readonly message: string;
  /** Sanitized workflow-facing text shown on run/stage snapshots. */
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly resumable: boolean;
  readonly cause?: unknown;
}

export const WORKFLOW_AUTH_FAILURE_MESSAGE =
  "You must be logged in to run workflows. Run /login and try again.";

const WORKFLOW_FAILURE_KINDS: ReadonlySet<WorkflowFailureKind> = new Set([
  "auth",
  "rate_limit",
  "provider",
  "cancelled",
  "unknown",
]);

export function isWorkflowFailureKind(kind: string): kind is WorkflowFailureKind {
  return WORKFLOW_FAILURE_KINDS.has(kind as WorkflowFailureKind);
}

function makeWorkflowFailure(
  kind: WorkflowFailureKind,
  message: string,
  opts: {
    readonly retryable: boolean;
    readonly resumable: boolean;
    readonly cause: unknown;
    readonly userMessage?: string;
  },
): WorkflowFailure {
  return {
    kind,
    message,
    userMessage: opts.userMessage ?? message,
    retryable: opts.retryable,
    resumable: opts.resumable,
    cause: opts.cause,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

function includesAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

export function classifyWorkflowFailure(error: unknown): WorkflowFailure {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  const name = errorName(error)?.toLowerCase();

  if (includesAny(lower, [
    "no api key",
    "api key not found",
    "missing api key",
    "no model selected",
    "no models available",
    "not logged in",
    "log in",
    "login required",
    "authentication required",
    "unauthorized",
    "oauth",
  ])) {
    return makeWorkflowFailure("auth", message, {
      userMessage: WORKFLOW_AUTH_FAILURE_MESSAGE,
      retryable: true,
      resumable: true,
      cause: error,
    });
  }

  if (includesAny(lower, ["rate limit", "rate-limit", "429", "quota", "too many requests"])) {
    return makeWorkflowFailure("rate_limit", message, {
      retryable: true,
      resumable: true,
      cause: error,
    });
  }

  if (name === "aborterror" || includesAny(lower, ["aborted", "cancelled", "canceled"])) {
    return makeWorkflowFailure("cancelled", message, {
      retryable: false,
      resumable: false,
      cause: error,
    });
  }

  if (includesAny(lower, [
    "model",
    "provider",
    "overloaded",
    "temporarily unavailable",
    "service unavailable",
    "503",
  ])) {
    return makeWorkflowFailure("provider", message, {
      retryable: true,
      resumable: true,
      cause: error,
    });
  }

  return makeWorkflowFailure("unknown", message, {
    retryable: false,
    resumable: true,
    cause: error,
  });
}
