/**
 * Shared timeout utility for SDK send operations.
 *
 * Both the Copilot and OpenCode session runtimes need to guard against
 * hung SDK calls (e.g. expired API tokens, stale sessions).  This module
 * provides a single `withSendTimeout` implementation so the timeout
 * logic, error messages, and env-var overrides live in one place.
 *
 * @module
 */

/**
 * Default maximum time (ms) to wait for an SDK `send()` / `prompt()` call
 * to complete before treating the remote process as hung.
 *
 * Override at runtime with the `SESSION_SEND_TIMEOUT_MS` environment
 * variable (must be a positive integer).
 *
 * The 60-second default is generous — `send()` only dispatches the prompt
 * over IPC and returns; the response streams back asynchronously via events.
 */
const DEFAULT_SEND_TIMEOUT_MS = 60_000;

/**
 * Default maximum time (ms) to wait for the next SDK event during an active
 * stream before considering the session stale.
 *
 * Override at runtime with the `SESSION_STREAM_STALE_TIMEOUT_MS` environment
 * variable (must be a positive integer).
 *
 * 90 s accommodates reasoning models that may pause before responding.
 */
const DEFAULT_STREAM_STALE_TIMEOUT_MS = 90_000;

/**
 * Read a positive-integer env var, falling back to `defaultValue` when the
 * variable is unset, empty, or not a valid positive integer.
 */
function readPositiveIntEnv(name: string, defaultValue: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		return defaultValue;
	}
	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed) || parsed <= 0) {
		return defaultValue;
	}
	return parsed;
}

/**
 * Resolved send-timeout value (ms).
 *
 * Reads `SESSION_SEND_TIMEOUT_MS` from the environment once at module load.
 * Falls back to {@link DEFAULT_SEND_TIMEOUT_MS} when unset.
 */
export const SEND_TIMEOUT_MS: number = readPositiveIntEnv(
	"SESSION_SEND_TIMEOUT_MS",
	DEFAULT_SEND_TIMEOUT_MS,
);

/**
 * Resolved stale-stream-timeout value (ms).
 *
 * Reads `SESSION_STREAM_STALE_TIMEOUT_MS` from the environment once at
 * module load.  Falls back to {@link DEFAULT_STREAM_STALE_TIMEOUT_MS}
 * when unset.
 */
export const STREAM_STALE_TIMEOUT_MS: number = readPositiveIntEnv(
	"SESSION_STREAM_STALE_TIMEOUT_MS",
	DEFAULT_STREAM_STALE_TIMEOUT_MS,
);

/**
 * Error thrown when an SDK send/prompt operation exceeds the allowed timeout.
 *
 * The error message always starts with `"session expired:"` so it is
 * recognised by the downstream {@link isSessionExpiredMessage} check and
 * triggers the automatic session-recovery flow in the TUI controller.
 *
 * @example
 * ```ts
 * try {
 *   await withSendTimeout(sdk.send({ prompt }));
 * } catch (err) {
 *   if (err instanceof SendTimeoutError) { … }
 * }
 * ```
 */
export class SendTimeoutError extends Error {
	override readonly name = "SendTimeoutError";

	/** The timeout threshold (ms) that was exceeded. */
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(
			`session expired: send timed out after ${Math.round(timeoutMs / 1000)}s`,
		);
		this.timeoutMs = timeoutMs;
	}
}

/**
 * Error thrown when an active stream receives no events within the
 * stale-stream timeout window.
 *
 * Like {@link SendTimeoutError}, the message starts with `"session expired:"`
 * so it is picked up by the session-recovery machinery.
 *
 * @example
 * ```ts
 * staleTimer = setTimeout(() => {
 *   throw new StaleStreamError(STREAM_STALE_TIMEOUT_MS);
 * }, STREAM_STALE_TIMEOUT_MS);
 * ```
 */
export class StaleStreamError extends Error {
	override readonly name = "StaleStreamError";

	/** The stale-stream timeout threshold (ms) that was exceeded. */
	readonly timeoutMs: number;

	/**
	 * Marked `true` so {@link classifyError} in `retry.ts` treats this as a
	 * retryable error, enabling the adapter-level retry/resume loop to
	 * silently recover instead of surfacing a fatal session-expired error.
	 */
	readonly isRetryable = true;

	constructor(timeoutMs: number) {
		super(
			`session expired: no response received for ${Math.round(timeoutMs / 1000)}s`,
		);
		this.timeoutMs = timeoutMs;
	}
}

/**
 * Race an SDK operation against a timeout.
 *
 * When the timeout fires a {@link SendTimeoutError} is thrown so the
 * existing recovery path in the TUI controller can create a fresh session
 * and retry transparently.
 *
 * The timer is **always** cleaned up (via `finally`) regardless of whether
 * the operation resolves, rejects, or the timeout fires.
 *
 * @typeParam T - The resolved type of the SDK operation.
 * @param operation - The promise returned by the SDK call.
 * @param timeoutMs - Override for the timeout threshold (defaults to
 *   {@link SEND_TIMEOUT_MS}).
 * @returns The resolved value of `operation`.
 * @throws {SendTimeoutError} When the operation does not settle within
 *   `timeoutMs` milliseconds.
 */
export function withSendTimeout<T>(
	operation: Promise<T>,
	timeoutMs: number = SEND_TIMEOUT_MS,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return Promise.race([
		operation,
		new Promise<T>((_resolve, reject) => {
			timer = setTimeout(() => {
				reject(new SendTimeoutError(timeoutMs));
			}, timeoutMs);
		}),
	]).finally(() => {
		if (timer !== null) {
			clearTimeout(timer);
		}
	});
}
