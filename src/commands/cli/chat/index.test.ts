import { describe, expect, test } from "bun:test";
import { buildLauncherScript } from "./index.ts";

function withMockPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  }
}

describe("buildLauncherScript", () => {
  test("builds a PowerShell launcher with cwd, env, args, and exit code", () => {
    const { script, ext } = withMockPlatform("win32", () =>
      buildLauncherScript(
        "copilot",
        ["--debug"],
        "C:\\repo",
        { ATOMIC_AGENT: "copilot" },
      )
    );

    expect(ext).toBe("ps1");
    expect(script).toContain('Set-Location "C:\\repo"');
    expect(script).toContain('$env:ATOMIC_AGENT = "copilot"');
    expect(script).toContain('& "copilot" @("--debug")');
    expect(script).toContain('if ($LASTEXITCODE -is [int]) { $atomicExitCode = $LASTEXITCODE }');
    expect(script).toContain("exit $atomicExitCode");
    expect(script).not.toContain("Invoke-AtomicSessionCleanup");
  });

  test("builds a bash launcher without tmux input suppression", () => {
    const { script, ext } = withMockPlatform("linux", () =>
      buildLauncherScript(
        "claude",
        ["--dangerously-skip-permissions"],
        "/repo",
        { ATOMIC_AGENT: "claude" },
      )
    );

    expect(ext).toBe("sh");
    expect(script).toContain('cd "/repo"');
    expect(script).toContain('export ATOMIC_AGENT="claude"');
    expect(script).toContain('"claude" "--dangerously-skip-permissions"');
    expect(script).toContain("atomic_exit_code=$?");
    expect(script).not.toContain("exec ");
    expect(script).not.toContain("stty -echo -icanon");
    expect(script).not.toContain("atomic_original_tty_state");
    expect(script).not.toContain("trap atomic_cleanup");
  });
});
