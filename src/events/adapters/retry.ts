/**
 * Stream Retry Module
 *
 * Provides provider-level retry with exponential backoff for failed LLM calls.
 * Modeled after OpenCode's session/retry.ts and provider/error.ts patterns.
 *
 * Key features:
 * - Error classification: retryable (429, 503, ECONNRESET) vs permanent
 * - Exponential backoff with retry-after header parsing
 * - Abort-aware sleep (respects AbortSignal)
 * - Human-readable retry messages for UI broadcast
 */

/** Initial retry delay in milliseconds */
const RETRY_INITIAL_DELAY = 2000;
/** Backoff multiplier applied per attempt */
const RETRY_BACKOFF_FACTOR = 2;
/** Maximum delay when no retry-after headers are present */
const RETRY_MAX_DELAY_NO_HEADERS = 30_000;
/** Default maximum retry attempts */
const DEFAULT_MAX_RETRIES = 5;

/** HTTP status codes that are always retryable */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Error message substrings that indicate transient failures */
const TRANSIENT_ERROR_PATTERNS = [
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "network",
  "failed to fetch",
  "load failed",
  "overloaded",
  "rate limit",
  "too many requests",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "internal server error",
] as const;

/**
 * Classified error with retryability information.
 */
export interface ClassifiedError {
  /** Whether this error can be retried */
  isRetryable: boolean;
  /** Human-readable error message */
  message: string;
  /** HTTP status code if available */
  statusCode?: number;
  /** Response headers for retry-after parsing */
  responseHeaders?: Record<string, string>;
}

/**
 * Retry state broadcast to the UI via stream.session.retry events.
 */
export interface RetryState {
  /** Current attempt number (1-based) */
  attempt: number;
  /** Delay in milliseconds before next retry */
  delay: number;
  /** Human-readable reason for retry */
  message: string;
  /** Unix timestamp when next retry will occur */
  nextRetryAt: number;
}

/**
 * Classify an error as retryable or permanent.
 *
 * Checks HTTP status codes, error messages, and known transient patterns.
 */
export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { isRetryable: false, message: "Aborted" };
  }

  const errorRecord = error as Record<string, unknown>;
  const statusCode = typeof errorRecord?.statusCode === "number"
    ? errorRecord.statusCode
    : typeof errorRecord?.status === "number"
      ? errorRecord.status
      : undefined;
  const responseHeaders = extractResponseHeaders(errorRecord);
  const message = error instanceof Error ? error.message : String(error);
  const messageLower = message.toLowerCase();

  // Check system-level connection errors
  const systemCode = (errorRecord as { code?: string })?.code;
  if (systemCode === "ECONNRESET" || systemCode === "ECONNREFUSED" || systemCode === "ETIMEDOUT") {
    return {
      isRetryable: true,
      message: `Connection error: ${systemCode}`,
      statusCode,
      responseHeaders,
    };
  }

  // Check HTTP status code
  if (statusCode !== undefined && RETRYABLE_STATUS_CODES.has(statusCode)) {
    const retryMessage = statusCode === 429
      ? "Rate limited"
      : statusCode === 503
        ? "Service unavailable"
        : `Server error (${statusCode})`;
    return {
      isRetryable: true,
      message: retryMessage,
      statusCode,
      responseHeaders,
    };
  }

  // Check error message patterns
  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (messageLower.includes(pattern)) {
      return {
        isRetryable: true,
        message: messageLower.includes("overloaded")
          ? "Provider is overloaded"
          : messageLower.includes("rate limit") || messageLower.includes("too many requests")
            ? "Rate limited"
            : message,
        statusCode,
        responseHeaders,
      };
    }
  }

  // Check if the error itself declares retryability (AI SDK pattern)
  if (typeof errorRecord?.isRetryable === "boolean") {
    return {
      isRetryable: errorRecord.isRetryable as boolean,
      message,
      statusCode,
      responseHeaders,
    };
  }

  // Default: not retryable
  return { isRetryable: false, message, statusCode, responseHeaders };
}

/**
 * Compute the delay before the next retry attempt.
 *
 * Priority:
 * 1. `retry-after-ms` header (milliseconds)
 * 2. `retry-after` header (seconds or HTTP date)
 * 3. Exponential backoff: RETRY_INITIAL_DELAY * RETRY_BACKOFF_FACTOR^(attempt-1)
 */
export function computeDelay(attempt: number, classified?: ClassifiedError): number {
  if (classified?.responseHeaders) {
    const headers = classified.responseHeaders;

    // Check retry-after-ms header (milliseconds)
    const retryAfterMs = headers["retry-after-ms"];
    if (retryAfterMs) {
      const parsedMs = Number.parseFloat(retryAfterMs);
      if (!Number.isNaN(parsedMs) && parsedMs > 0) return parsedMs;
    }

    // Check retry-after header (seconds or HTTP date)
    const retryAfter = headers["retry-after"];
    if (retryAfter) {
      const parsedSeconds = Number.parseFloat(retryAfter);
      if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
        return Math.ceil(parsedSeconds * 1000);
      }
      // Try parsing as HTTP date
      const parsed = Date.parse(retryAfter) - Date.now();
      if (!Number.isNaN(parsed) && parsed > 0) return Math.ceil(parsed);
    }

    // Headers present but no usable retry-after — use uncapped backoff
    return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1);
  }

  // No headers — capped backoff
  return Math.min(
    RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
    RETRY_MAX_DELAY_NO_HEADERS,
  );
}

/**
 * Sleep for a given number of milliseconds, respecting an AbortSignal.
 *
 * @throws DOMException with name "AbortError" if signal is aborted
 */
export function retrySleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const abortHandler = () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abortHandler);
      resolve();
    }, ms);

    signal.addEventListener("abort", abortHandler, { once: true });
  });
}

/** Extract response headers from an error object */
function extractResponseHeaders(
  error: Record<string, unknown>,
): Record<string, string> | undefined {
  const headers = error?.responseHeaders ?? error?.headers;
  if (typeof headers === "object" && headers !== null) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof value === "string") {
        result[key.toLowerCase()] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return undefined;
}

export { DEFAULT_MAX_RETRIES };
