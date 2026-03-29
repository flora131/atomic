/**
 * Wrapper around `bun test --coverage` that retries on SIGFPE.
 *
 * Bun's coverage reporter (CodeCoverage.zig) can intermittently crash with
 * SIGFPE on Linux due to a known bug where JavaScriptCore returns negative
 * offset values for coverage blocks. The crash happens *after* tests pass,
 * during coverage report generation, so a retry is safe — it won't mask
 * real test failures.
 *
 * See: https://github.com/oven-sh/bun/issues/10836
 */

const MAX_RETRIES = 3;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  const proc = Bun.spawnSync(["bun", "test", "--coverage"], {
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  });

  if (proc.exitCode === 0) {
    process.exit(0);
  }

  // Bun.spawnSync reports signal kills via signalCode (not exitCode).
  const killedBySigfpe = proc.signalCode === "SIGFPE";

  if (killedBySigfpe && attempt < MAX_RETRIES) {
    console.error(
      `\n⚠ Coverage report crashed with SIGFPE (attempt ${attempt}/${MAX_RETRIES}), retrying…\n`,
    );
    continue;
  }

  if (killedBySigfpe) {
    console.error(
      `\n✗ Coverage report crashed with SIGFPE after ${MAX_RETRIES} attempts\n`,
    );
  }

  process.exit(proc.exitCode ?? 1);
}
