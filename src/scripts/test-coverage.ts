/**
 * Wrapper around `bun test --coverage` that retries on Bun crashes.
 *
 * Bun's coverage reporter (CodeCoverage.zig) can intermittently crash with
 * SIGFPE, SIGSEGV, or SIGABRT on Linux due to known bugs where
 * JavaScriptCore returns invalid values during coverage report generation.
 * The crash happens *after* tests pass, so a retry is safe — it won't mask
 * real test failures.
 *
 * See: https://github.com/oven-sh/bun/issues/10836
 */

const MAX_RETRIES = 3;

/** Signals produced by known Bun coverage-reporter crashes. */
const RETRYABLE_SIGNALS = new Set(["SIGFPE", "SIGSEGV", "SIGABRT"]);

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  const proc = Bun.spawnSync(["bun", "test", "--coverage"], {
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  });

  if (proc.exitCode === 0) {
    process.exit(0);
  }

  // Bun.spawnSync reports signal kills via signalCode (not exitCode).
  const crashSignal = proc.signalCode;
  const isRetryable = crashSignal != null && RETRYABLE_SIGNALS.has(crashSignal);

  if (isRetryable && attempt < MAX_RETRIES) {
    console.error(
      `\n⚠ Coverage report crashed with ${crashSignal} (attempt ${attempt}/${MAX_RETRIES}), retrying…\n`,
    );
    continue;
  }

  if (isRetryable) {
    console.error(
      `\n✗ Coverage report crashed with ${crashSignal} after ${MAX_RETRIES} attempts\n`,
    );
  }

  process.exit(proc.exitCode ?? 1);
}
