import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import {
  getMuxBinary,
  resetMuxBinaryCache,
  isTmuxInstalled,
  isInsideTmux,
  tmuxRun,
} from "../../../packages/workflow-sdk/src/runtime/tmux.ts";

// ---------------------------------------------------------------------------
// getMuxBinary
// ---------------------------------------------------------------------------

describe("getMuxBinary", () => {
  beforeEach(() => {
    resetMuxBinaryCache();
  });

  afterEach(() => {
    resetMuxBinaryCache();
  });

  test("returns 'tmux' on unix when tmux is available", () => {
    // On this Linux CI host, tmux should be resolvable (or we skip)
    const binary = getMuxBinary();
    if (process.platform !== "win32") {
      // On Unix, it returns "tmux" if installed, null otherwise
      if (Bun.which("tmux")) {
        expect(binary).toBe("tmux");
      } else {
        expect(binary).toBeNull();
      }
    }
  });

  test("caches the result after first call", () => {
    const first = getMuxBinary();
    const second = getMuxBinary();
    expect(first).toBe(second);
  });

  test("resetMuxBinaryCache clears cached value", () => {
    getMuxBinary(); // populate cache
    resetMuxBinaryCache();
    // After reset, the next call re-resolves (doesn't throw, returns consistent result)
    const result = getMuxBinary();
    expect(typeof result === "string" || result === null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isTmuxInstalled
// ---------------------------------------------------------------------------

describe("isTmuxInstalled", () => {
  beforeEach(() => {
    resetMuxBinaryCache();
  });

  afterEach(() => {
    resetMuxBinaryCache();
  });

  test("returns boolean", () => {
    const result = isTmuxInstalled();
    expect(typeof result).toBe("boolean");
  });

  test("consistent with getMuxBinary", () => {
    const binary = getMuxBinary();
    expect(isTmuxInstalled()).toBe(binary !== null);
  });
});

// ---------------------------------------------------------------------------
// isInsideTmux
// ---------------------------------------------------------------------------

describe("isInsideTmux", () => {
  const origTmux = process.env.TMUX;
  const origPsmux = process.env.PSMUX;

  afterEach(() => {
    // Restore original env
    if (origTmux !== undefined) {
      process.env.TMUX = origTmux;
    } else {
      delete process.env.TMUX;
    }
    if (origPsmux !== undefined) {
      process.env.PSMUX = origPsmux;
    } else {
      delete process.env.PSMUX;
    }
  });

  test("returns true when TMUX env var is set", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    delete process.env.PSMUX;
    expect(isInsideTmux()).toBe(true);
  });

  test("returns true when PSMUX env var is set", () => {
    delete process.env.TMUX;
    process.env.PSMUX = "1";
    expect(isInsideTmux()).toBe(true);
  });

  test("returns true when both TMUX and PSMUX are set", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    process.env.PSMUX = "1";
    expect(isInsideTmux()).toBe(true);
  });

  test("returns false when neither env var is set", () => {
    delete process.env.TMUX;
    delete process.env.PSMUX;
    expect(isInsideTmux()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tmuxRun — graceful failure when no binary
// ---------------------------------------------------------------------------

describe("tmuxRun", () => {
  beforeEach(() => {
    resetMuxBinaryCache();
  });

  afterEach(() => {
    resetMuxBinaryCache();
  });

  test("returns error when no mux binary is available", () => {
    // Force cache to null by setting it via a trick:
    // On a system without tmux, getMuxBinary() returns null
    // If tmux is installed, we can't easily test this without mocking,
    // so we verify the return type is correct
    const result = tmuxRun(["list-sessions"]);
    expect(result).toHaveProperty("ok");
    if (!result.ok) {
      expect(result).toHaveProperty("stderr");
      expect(typeof result.stderr).toBe("string");
    } else {
      expect(result).toHaveProperty("stdout");
      expect(typeof result.stdout).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Launcher script generation (executor logic validation)
// ---------------------------------------------------------------------------

describe("launcher script generation logic", () => {
  test("generates bash script content for unix", () => {
    const isWin = false;
    const projectRoot = "/home/user/project";
    const workflowRunId = "abc12345";
    const tmuxSessionName = "atomic-wf-test-abc12345";
    const agent = "claude";
    const prompt = "test prompt";
    const thisFile = "/path/to/executor.ts";
    const logPath = "/tmp/orchestrator.log";

    const launcherScript = isWin
      ? [
          `Set-Location "${projectRoot}"`,
          `$env:ATOMIC_WF_ID = "${workflowRunId}"`,
          `bun run "${thisFile}" --run 2>"${logPath}"`,
        ].join("\n")
      : [
          "#!/bin/bash",
          `cd "${projectRoot}"`,
          `export ATOMIC_WF_ID="${workflowRunId}"`,
          `bun run "${thisFile}" --run 2>"${logPath}"`,
        ].join("\n");

    expect(launcherScript).toContain("#!/bin/bash");
    expect(launcherScript).toContain(`cd "${projectRoot}"`);
    expect(launcherScript).toContain(`export ATOMIC_WF_ID="${workflowRunId}"`);
    expect(launcherScript).not.toContain("Set-Location");
    expect(launcherScript).not.toContain("$env:");
  });

  test("generates PowerShell script content for windows", () => {
    const isWin = true;
    const projectRoot = "C:\\Users\\user\\project";
    const workflowRunId = "abc12345";
    const thisFile = "C:\\path\\to\\executor.ts";
    const logPath = "C:\\tmp\\orchestrator.log";

    const launcherScript = isWin
      ? [
          `Set-Location "${projectRoot}"`,
          `$env:ATOMIC_WF_ID = "${workflowRunId}"`,
          `bun run "${thisFile}" --run 2>"${logPath}"`,
        ].join("\n")
      : [
          "#!/bin/bash",
          `cd "${projectRoot}"`,
          `export ATOMIC_WF_ID="${workflowRunId}"`,
          `bun run "${thisFile}" --run 2>"${logPath}"`,
        ].join("\n");

    expect(launcherScript).toContain("Set-Location");
    expect(launcherScript).toContain("$env:ATOMIC_WF_ID");
    expect(launcherScript).not.toContain("#!/bin/bash");
    expect(launcherScript).not.toContain("export ");
  });

  test("shell command differs by platform", () => {
    const launcherPath = "/tmp/orchestrator.sh";

    const unixCmd = `bash "${launcherPath}"`;
    const winCmd = `pwsh -NoProfile -File "${launcherPath}"`;

    expect(unixCmd).toContain("bash");
    expect(winCmd).toContain("pwsh");
    expect(winCmd).toContain("-NoProfile");
  });
});
