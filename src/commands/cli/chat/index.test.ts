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
  test("adds PowerShell session cleanup after the agent exits", () => {
    const { script, ext } = withMockPlatform("win32", () =>
      buildLauncherScript(
        "copilot",
        ["--debug"],
        "C:\\repo",
        { ATOMIC_AGENT: "copilot" },
        "atomic-chat-copilot-abc12345",
      )
    );

    expect(ext).toBe("ps1");
    expect(script).toContain("try {");
    expect(script).toContain("} finally {");
    expect(script).toContain("Invoke-AtomicSessionCleanup");
    expect(script).toContain('-L "atomic" kill-session -t "atomic-chat-copilot-abc12345"');
    expect(script).toContain("exit $atomicExitCode");
  });

  test("adds bash session cleanup without execing away the launcher", () => {
    const { script, ext } = withMockPlatform("linux", () =>
      buildLauncherScript(
        "claude",
        ["--dangerously-skip-permissions"],
        "/repo",
        { ATOMIC_AGENT: "claude" },
        "atomic-chat-claude-abc12345",
      )
    );

    expect(ext).toBe("sh");
    expect(script).toContain("trap atomic_cleanup EXIT");
    expect(script).toContain('tmux -L "atomic" kill-session -t "atomic-chat-claude-abc12345"');
    expect(script).toContain("atomic_exit_code=$?");
    expect(script).not.toContain("exec ");
  });
});
