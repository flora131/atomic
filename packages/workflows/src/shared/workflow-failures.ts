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

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

const AUTH_FAILURE_PATTERNS: readonly RegExp[] = [
  /\bno api key\b/,
  /\bapi key not found\b/,
  /\bmissing api key\b/,
  /\bno model selected\b/,
  /\bno models available\b/,
  /\bnot logged in\b/,
  /\blog\s+in\b/,
  /\blogin required\b/,
  /\bauthentication required\b/,
  /\bunauthorized\b/,
  /\boauth(?:2)?\b[^\n.?!]{0,120}\b(?:token|credential|credentials|required|expired|invalid|missing|unauthorized|login|log\s+in|sign[-\s]?in)\b/,
  /\b(?:token|credential|credentials|required|expired|invalid|missing|unauthorized|login|log\s+in|sign[-\s]?in)\b[^\n.?!]{0,120}\boauth(?:2)?\b/,
];

const RATE_LIMIT_FAILURE_PATTERNS: readonly RegExp[] = [
  /\brate\s*limit\b/,
  /\brate-limit\b/,
  /\b429\b/,
  /\bquota\b/,
  /\btoo many requests\b/,
];

const CANCELLED_FAILURE_PATTERNS: readonly RegExp[] = [
  /\baborted\b/,
  /\bcancelled\b/,
  /\bcanceled\b/,
];

const PROVIDER_FAILURE_PATTERNS: readonly RegExp[] = [
  /\bmodel\b[^\n.?!]{0,120}\b(?:not found|unavailable|overloaded|temporarily unavailable|service unavailable)\b/,
  /\b(?:not found|unavailable|overloaded|temporarily unavailable|service unavailable)\b[^\n.?!]{0,120}\bmodel\b/,
  /\bprovider\b[^\n.?!]{0,120}\b(?:error|failure|failed|overloaded|unavailable|temporarily unavailable|service unavailable|returned error)\b/,
  /\b(?:overloaded|temporarily unavailable|service unavailable)\b/,
  /\b503\b/,
];

export function classifyWorkflowFailure(error: unknown): WorkflowFailure {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  const name = errorName(error)?.toLowerCase();

  if (matchesAny(lower, AUTH_FAILURE_PATTERNS)) {
    return makeWorkflowFailure("auth", message, {
      userMessage: WORKFLOW_AUTH_FAILURE_MESSAGE,
      retryable: true,
      resumable: true,
      cause: error,
    });
  }

  if (matchesAny(lower, RATE_LIMIT_FAILURE_PATTERNS)) {
    return makeWorkflowFailure("rate_limit", message, {
      retryable: true,
      resumable: true,
      cause: error,
    });
  }

  if (name === "aborterror" || matchesAny(lower, CANCELLED_FAILURE_PATTERNS)) {
    return makeWorkflowFailure("cancelled", message, {
      retryable: false,
      resumable: false,
      cause: error,
    });
  }

  if (matchesAny(lower, PROVIDER_FAILURE_PATTERNS)) {
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
