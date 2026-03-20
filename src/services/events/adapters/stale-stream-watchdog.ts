/**
 * StaleStreamWatchdog — safety timer for foreground SDK streams.
 *
 * Detects when a stream has not produced any activity (chunks, events)
 * within a configurable timeout window. Rather than surfacing an error
 * to the user, it aborts the current stream attempt so the existing
 * retry loop can recover transparently (re-create or resume the stream).
 *
 * Each call to {@link kick} resets the internal countdown.
 * Call {@link reset} between retry attempts to allow re-firing.
 * Call {@link dispose} to clean up once the stream completes.
 */

/** Default stale timeout for foreground streams: 5 minutes. */
export const DEFAULT_FOREGROUND_STALE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Sentinel error thrown when the watchdog fires.
 * Classified as retryable by the retry module's `classifyError` (via
 * the `isRetryable` property convention) so the existing retry loop in
 * each streaming runtime handles recovery automatically.
 */
export class StaleStreamError extends Error {
  override readonly name = "StaleStreamError";

  /** Marked true so `classifyError` in retry.ts treats it as retryable. */
  readonly isRetryable = true;

  constructor(timeoutMs: number) {
    super(
      `Stream stalled — no activity for ${Math.round(timeoutMs / 1000)}s`,
    );
  }
}

export interface StaleStreamWatchdogOptions {
  /**
   * Maximum milliseconds of inactivity before the watchdog fires.
   * Pass `0` or a negative value to disable the watchdog entirely.
   * @default 300_000 (5 minutes)
   */
  timeoutMs?: number;

  /** Callback invoked when the stale timeout fires. */
  onStale: () => void;
}

export interface StaleStreamWatchdog {
  /** Reset (kick) the watchdog timer — call on every stream activity. */
  kick: () => void;

  /**
   * Start the watchdog timer.
   * Idempotent — calling start() when already started is equivalent to kick().
   */
  start: () => void;

  /**
   * Reset the watchdog so it can fire again after a retry attempt.
   * Clears the internal timer and resets the fired flag.
   */
  reset: () => void;

  /** Stop and clean up all internal timers. Safe to call multiple times. */
  dispose: () => void;

  /** Whether the stale timeout has fired (resets on {@link reset}). */
  readonly hasFired: boolean;
}

export function createStaleStreamWatchdog(
  options: StaleStreamWatchdogOptions,
): StaleStreamWatchdog {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FOREGROUND_STALE_TIMEOUT_MS;
  const disabled = timeoutMs <= 0;

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let fired = false;

  const clear = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const schedule = (): void => {
    if (disabled || fired) {
      return;
    }
    clear();
    timerId = setTimeout(() => {
      timerId = null;
      fired = true;
      options.onStale();
    }, timeoutMs);
  };

  return {
    kick: schedule,
    start: schedule,
    reset: () => {
      clear();
      fired = false;
    },
    dispose: clear,
    get hasFired() {
      return fired;
    },
  };
}
