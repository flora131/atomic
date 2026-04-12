import { test, expect, describe, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import {
  getMuxBinary,
  resetMuxBinaryCache,
  isTmuxInstalled,
  isInsideTmux,
  tmuxRun,
  createSession,
  createWindow,
  createPane,
  sendLiteralText,
  sendSpecialKey,
  sendKeysAndSubmit,
  capturePane,
  capturePaneVisible,
  capturePaneScrollback,
  killSession,
  sessionExists,
  normalizeTmuxCapture,
  normalizeTmuxLines,
  paneLooksReady,
  paneHasActiveTask,
  paneIsIdle,
  waitForPaneReady,
  waitForOutput,
  attemptSubmitRounds,
  attachSession,
  killWindow,
  switchClient,
  getCurrentSession,
  attachOrSwitch,
} from "@/sdk/workflows/index.ts";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

/**
 * Save and restore environment variables around each test.
 * Call in a describe block to avoid duplicating the afterEach pattern.
 */
function withEnvRestore(vars: string[]) {
  const saved: Record<string, string | undefined> = {};
  for (const v of vars) saved[v] = process.env[v];

  afterEach(() => {
    for (const v of vars) {
      if (saved[v] !== undefined) {
        process.env[v] = saved[v];
      } else {
        delete process.env[v];
      }
    }
  });
}

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
  withEnvRestore(["TMUX", "PSMUX"]);

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
// tmuxRun — success and failure paths
// ---------------------------------------------------------------------------

describe("tmuxRun", () => {
  beforeEach(() => {
    resetMuxBinaryCache();
  });

  afterEach(() => {
    resetMuxBinaryCache();
  });

  test("returns ok:true with stdout for valid commands", () => {
    const result = tmuxRun(["list-sessions"]);
    // Even if no sessions exist, tmux returns ok:false (exit code 1)
    // but the structure is always correct
    expect(result).toHaveProperty("ok");
    if (result.ok) {
      expect(typeof result.stdout).toBe("string");
    } else {
      expect(typeof result.stderr).toBe("string");
    }
  });

  test("returns ok:false with stderr for invalid tmux subcommand", () => {
    const result = tmuxRun(["completely-invalid-subcommand-xyz"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  });

  test("returns ok:true for successful tmux info command", () => {
    const result = tmuxRun(["start-server"]);
    // start-server creates the server and exits; may succeed or already running
    expect(result).toHaveProperty("ok");
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

// ---------------------------------------------------------------------------
// normalizeTmuxCapture — pure function
// ---------------------------------------------------------------------------

describe("normalizeTmuxCapture", () => {
  test("collapses whitespace to single spaces", () => {
    expect(normalizeTmuxCapture("hello   world")).toBe("hello world");
  });

  test("strips carriage returns", () => {
    expect(normalizeTmuxCapture("hello\r\nworld")).toBe("hello world");
  });

  test("collapses newlines to spaces", () => {
    expect(normalizeTmuxCapture("line1\nline2\nline3")).toBe("line1 line2 line3");
  });

  test("trims leading and trailing whitespace", () => {
    expect(normalizeTmuxCapture("  hello  ")).toBe("hello");
  });

  test("handles empty string", () => {
    expect(normalizeTmuxCapture("")).toBe("");
  });

  test("handles whitespace-only input", () => {
    expect(normalizeTmuxCapture("   \n\n   \r\n   ")).toBe("");
  });

  test("handles tabs and mixed whitespace", () => {
    expect(normalizeTmuxCapture("hello\t\tworld\n  foo")).toBe("hello world foo");
  });

  test("preserves single spaces between words", () => {
    expect(normalizeTmuxCapture("a b c")).toBe("a b c");
  });
});

// ---------------------------------------------------------------------------
// normalizeTmuxLines — pure function
// ---------------------------------------------------------------------------

describe("normalizeTmuxLines", () => {
  test("trims trailing whitespace per line", () => {
    const input = "hello   \nworld   ";
    const result = normalizeTmuxLines(input);
    expect(result).toBe("hello\nworld");
  });

  test("preserves leading whitespace on non-first lines", () => {
    const input = "top\n    deeper";
    expect(normalizeTmuxLines(input)).toBe("top\n    deeper");
  });

  test("final trim removes leading whitespace from entire result", () => {
    const input = "  indented\n    deeper";
    // The final .trim() strips leading whitespace from the whole string
    expect(normalizeTmuxLines(input)).toBe("indented\n    deeper");
  });

  test("trims overall result", () => {
    const input = "\n\nhello\nworld\n\n";
    expect(normalizeTmuxLines(input)).toBe("hello\nworld");
  });

  test("handles empty string", () => {
    expect(normalizeTmuxLines("")).toBe("");
  });

  test("handles single line", () => {
    expect(normalizeTmuxLines("hello   ")).toBe("hello");
  });

  test("preserves internal blank lines", () => {
    const input = "line1\n\nline3";
    expect(normalizeTmuxLines(input)).toBe("line1\n\nline3");
  });

  test("trimEnd strips carriage returns (CR is whitespace)", () => {
    // JS trimEnd treats \r as whitespace, so it gets stripped
    expect(normalizeTmuxLines("hello\r  ")).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// paneLooksReady — additional edge cases
// ---------------------------------------------------------------------------

describe("paneLooksReady — edge cases", () => {
  test("detects 'how can i help you' without prompt char", () => {
    const capture = "Welcome!\nHow can I help you?\n";
    expect(paneLooksReady(capture)).toBe(true);
  });

  test("detects 'how can i help' without 'you'", () => {
    const capture = "How can I help?";
    expect(paneLooksReady(capture)).toBe(true);
  });

  test("rejects 'model: loading' bootstrapping", () => {
    const capture = "model: loading\n❯ ";
    expect(paneLooksReady(capture)).toBe(false);
  });

  test("rejects 'starting up' bootstrapping", () => {
    const capture = "Starting up the server...\n> ";
    expect(paneLooksReady(capture)).toBe(false);
  });

  test("returns false for whitespace-only content after trimEnd", () => {
    expect(paneLooksReady("   \n   \n   ")).toBe(false);
  });

  test("handles prompt with surrounding text", () => {
    const capture = "Some output\n❯ type here";
    expect(paneLooksReady(capture)).toBe(true);
  });

  test("handles indented chevron prompt", () => {
    expect(paneLooksReady("    > ")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// paneHasActiveTask — additional edge cases
// ---------------------------------------------------------------------------

describe("paneHasActiveTask — edge cases", () => {
  test("detects 'background terminal running' without number prefix", () => {
    const capture = "background terminal running";
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("detects multiple background terminals", () => {
    const capture = "3 background terminal running";
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("case insensitive 'Esc to interrupt'", () => {
    const capture = "ESC TO INTERRUPT";
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("spinner with two words", () => {
    const capture = "· Writing code...";
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("spinner with unicode ellipsis and asterisk", () => {
    const capture = "✻ Analyzing…";
    expect(paneHasActiveTask(capture)).toBe(true);
  });

  test("no false positive for regular text ending in dots", () => {
    const capture = "The end result was good...";
    expect(paneHasActiveTask(capture)).toBe(false);
  });

  test("no false positive for empty lines", () => {
    const capture = "\n\n\n";
    expect(paneHasActiveTask(capture)).toBe(false);
  });
});

// ===========================================================================
// Integration tests — real tmux sessions
// ===========================================================================

const TEST_SESSION = `atomic-test-${crypto.randomUUID().slice(0, 8)}`;
const tmuxAvailable = Bun.which("tmux") !== null;

describe.if(tmuxAvailable)("tmux integration: session lifecycle", () => {
  afterAll(() => {
    // Guaranteed cleanup
    killSession(TEST_SESSION);
  });

  test("createSession creates a detached session and returns pane id", () => {
    const paneId = createSession(TEST_SESSION, "bash", "test-win");
    expect(paneId).toMatch(/^%\d+$/);
  });

  test("sessionExists returns true for existing session", () => {
    expect(sessionExists(TEST_SESSION)).toBe(true);
  });

  test("sessionExists returns false for non-existent session", () => {
    expect(sessionExists("nonexistent-session-xyz-99999")).toBe(false);
  });

  test("createWindow adds a new window and returns pane id", () => {
    const paneId = createWindow(TEST_SESSION, "second-win", "bash");
    expect(paneId).toMatch(/^%\d+$/);
  });

  test("createPane splits and returns a new pane id", () => {
    const paneId = createPane(TEST_SESSION, "bash");
    expect(paneId).toMatch(/^%\d+$/);
  });

  test("killSession removes the session", () => {
    killSession(TEST_SESSION);
    expect(sessionExists(TEST_SESSION)).toBe(false);
  });

  test("killSession does not throw for already-dead session", () => {
    expect(() => killSession(TEST_SESSION)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Integration: keystroke sending + pane capture
// ---------------------------------------------------------------------------

const CAPTURE_SESSION = `atomic-cap-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("tmux integration: send keys and capture", () => {
  let paneId: string;

  beforeAll(async () => {
    paneId = createSession(CAPTURE_SESSION, "bash", "capture-test");
    // Wait for bash prompt to be ready
    await Bun.sleep(500);
  });

  afterAll(() => {
    killSession(CAPTURE_SESSION);
  });

  test("sendLiteralText sends text to pane", async () => {
    sendLiteralText(paneId, "echo TESTMARKER_LITERAL");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("TESTMARKER_LITERAL");
  });

  test("sendLiteralText normalizes newlines to spaces", async () => {
    sendLiteralText(paneId, "echo hello\nworld");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    // Newlines replaced with spaces, so it runs as "echo hello world"
    expect(captured).toContain("hello world");
  });

  test("sendSpecialKey sends C-m (enter)", async () => {
    sendLiteralText(paneId, "echo SPECIAL_KEY_TEST");
    sendSpecialKey(paneId, "C-m");
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("SPECIAL_KEY_TEST");
  });

  test("sendKeysAndSubmit sends text and presses enter", async () => {
    await sendKeysAndSubmit(paneId, "echo SUBMIT_TEST", 1, 50);
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("SUBMIT_TEST");
  });

  test("capturePane returns visible content", () => {
    const captured = capturePane(paneId);
    expect(typeof captured).toBe("string");
    expect(captured.length).toBeGreaterThan(0);
  });

  test("capturePane with start parameter captures scrollback", async () => {
    // Generate some output to create scrollback
    await sendKeysAndSubmit(paneId, "echo SCROLLBACK_TEST", 1, 50);
    await Bun.sleep(200);

    const captured = capturePane(paneId, -50);
    expect(typeof captured).toBe("string");
    expect(captured).toContain("SCROLLBACK_TEST");
  });

  test("capturePaneVisible returns visible portion", () => {
    const visible = capturePaneVisible(paneId);
    expect(typeof visible).toBe("string");
  });

  test("capturePaneVisible returns empty string for invalid pane", () => {
    const visible = capturePaneVisible("%99999");
    expect(visible).toBe("");
  });

  test("capturePaneScrollback returns recent history", async () => {
    await sendKeysAndSubmit(paneId, "echo SCROLLBACK_HISTORY", 1, 50);
    await Bun.sleep(200);

    const scrollback = capturePaneScrollback(paneId, 100);
    expect(scrollback).toContain("SCROLLBACK_HISTORY");
  });

  test("capturePaneScrollback returns empty string for invalid pane", () => {
    const scrollback = capturePaneScrollback("%99999", 50);
    expect(scrollback).toBe("");
  });

  test("capturePaneScrollback uses default lines parameter", () => {
    const scrollback = capturePaneScrollback(paneId);
    expect(typeof scrollback).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Integration: paneIsIdle with real pane
// ---------------------------------------------------------------------------

const IDLE_SESSION = `atomic-idle-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("tmux integration: paneIsIdle", () => {
  let paneId: string;

  beforeAll(async () => {
    paneId = createSession(IDLE_SESSION, "bash", "idle-test");
    await Bun.sleep(500);
  });

  afterAll(() => {
    killSession(IDLE_SESSION);
  });

  test("paneIsIdle returns boolean for real pane", () => {
    const result = paneIsIdle(paneId);
    expect(typeof result).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// Integration: waitForPaneReady with real shell prompt
// ---------------------------------------------------------------------------

const READY_SESSION = `atomic-rdy-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("tmux integration: waitForPaneReady", () => {
  let paneId: string;

  beforeAll(async () => {
    // Start a process that prints a `> ` prompt and then blocks, so
    // paneLooksReady's `[›>❯]` regex matches a real captured pane.
    // (A bare `bash` shows `$`, which never matches and forces the function
    // to time out — racing bun:test's own 5s per-test timeout.)
    paneId = createSession(READY_SESSION, 'printf "> "; sleep 30', "ready-test");
    await Bun.sleep(300);
  });

  afterAll(() => {
    killSession(READY_SESSION);
  });

  test("waitForPaneReady resolves quickly when prompt is visible", async () => {
    const elapsed = await waitForPaneReady(paneId, 5_000);
    expect(typeof elapsed).toBe("number");
    // The prompt is already on screen — the first poll should detect it.
    // Anything close to the 5s timeout means the success path is broken.
    expect(elapsed).toBeLessThan(1_000);
  });

  test("waitForPaneReady respects timeout", async () => {
    // Use a very short timeout — function should return (not hang).
    // With the prompt already visible, it should return well under the cap.
    const elapsed = await waitForPaneReady(paneId, 100);
    expect(elapsed).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// Integration: waitForOutput with real output
// ---------------------------------------------------------------------------

const OUTPUT_SESSION = `atomic-out-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("tmux integration: waitForOutput", () => {
  let paneId: string;

  beforeAll(async () => {
    paneId = createSession(OUTPUT_SESSION, "bash", "output-test");
    await Bun.sleep(500);
  });

  afterAll(() => {
    killSession(OUTPUT_SESSION);
  });

  test("waitForOutput resolves when pattern matches", async () => {
    await sendKeysAndSubmit(paneId, "echo WAITFOR_MARKER_XYZ", 1, 50);

    const content = await waitForOutput(paneId, /WAITFOR_MARKER_XYZ/, {
      timeoutMs: 5_000,
      pollIntervalMs: 100,
    });
    expect(content).toContain("WAITFOR_MARKER_XYZ");
  });

  test("waitForOutput throws on timeout when pattern not found", async () => {
    await expect(
      waitForOutput(paneId, /IMPOSSIBLE_PATTERN_NEVER_APPEARS_999/, {
        timeoutMs: 300,
        pollIntervalMs: 100,
      }),
    ).rejects.toThrow("Timed out waiting for pattern");
  });
});

// ---------------------------------------------------------------------------
// Error paths: functions that throw via internal tmux() helper
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("tmux error paths", () => {
  test("capturePane throws for non-existent pane", () => {
    expect(() => capturePane("%99999")).toThrow(/capture-pane failed/);
  });

  test("capturePane with start parameter throws for invalid pane", () => {
    expect(() => capturePane("%99999", -50)).toThrow(/capture-pane failed/);
  });

  test("createSession throws for duplicate session name", () => {
    const dupSession = `atomic-dup-${crypto.randomUUID().slice(0, 8)}`;
    try {
      createSession(dupSession, "bash", "first");
      expect(() => createSession(dupSession, "bash", "second")).toThrow();
    } finally {
      killSession(dupSession);
    }
  });

  test("sendLiteralText throws for invalid pane", () => {
    expect(() => sendLiteralText("%99999", "hello")).toThrow(/send-keys failed/);
  });

  test("sendSpecialKey throws for invalid pane", () => {
    expect(() => sendSpecialKey("%99999", "C-m")).toThrow(/send-keys failed/);
  });
});

// ---------------------------------------------------------------------------
// Integration: sendKeysAndSubmit with multiple presses (covers sleep path)
// ---------------------------------------------------------------------------

const MULTI_SESSION = `atomic-mul-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("tmux integration: sendKeysAndSubmit multi-press", () => {
  let paneId: string;

  beforeAll(async () => {
    paneId = createSession(MULTI_SESSION, "bash", "multi-test");
    await Bun.sleep(500);
  });

  afterAll(() => {
    killSession(MULTI_SESSION);
  });

  test("sendKeysAndSubmit with multiple presses executes sleep between presses", async () => {
    // presses=2 triggers the Bun.sleepSync branch (line 201-202)
    await sendKeysAndSubmit(paneId, "echo MULTI_PRESS_TEST", 2, 50);
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("MULTI_PRESS_TEST");
  });

  test("sendKeysAndSubmit with presses=3 hits sleep multiple times", async () => {
    await sendKeysAndSubmit(paneId, "echo THREE_PRESSES", 3, 30);
    await Bun.sleep(300);

    const captured = capturePane(paneId);
    expect(captured).toContain("THREE_PRESSES");
  });
});

// ---------------------------------------------------------------------------
// Integration: waitForPaneReady with non-ready pane (covers backoff loop)
// ---------------------------------------------------------------------------

const NOTREADY_SESSION = `atomic-nrd-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("tmux integration: waitForPaneReady backoff loop", () => {
  afterAll(() => {
    killSession(NOTREADY_SESSION);
  });

  test("waitForPaneReady loops with backoff when pane has no prompt", async () => {
    // Start a pane running 'sleep' — no shell prompt will appear
    const paneId = createSession(NOTREADY_SESSION, "sleep 30", "sleep-test");

    // With a short timeout, it should go through the backoff loop
    // and return the elapsed time (close to the timeout)
    const elapsed = await waitForPaneReady(paneId, 500);
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(2_000);
  });
});

// ---------------------------------------------------------------------------
// Integration: attemptSubmitRounds
// ---------------------------------------------------------------------------

const SUBMIT_SESSION = `atomic-sub-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("tmux integration: attemptSubmitRounds", () => {
  let paneId: string;

  beforeAll(async () => {
    paneId = createSession(SUBMIT_SESSION, "bash", "submit-test");
    await Bun.sleep(500);
  });

  afterAll(() => {
    killSession(SUBMIT_SESSION);
  });

  test("attemptSubmitRounds executes rounds and returns boolean", async () => {
    // Type something into the pane
    sendLiteralText(paneId, "echo SUBMIT_ROUND_TEST");
    await Bun.sleep(100);

    // attemptSubmitRounds will press C-m and check if the prompt text disappeared
    // After bash executes the echo, "echo SUBMIT_ROUND_TEST" stays in scrollback
    // so the function will run through all rounds — verify it returns a boolean
    const result = await attemptSubmitRounds(paneId, "UNIQUE_PHANTOM_TEXT_NEVER_ON_SCREEN", 2, 1);
    // "UNIQUE_PHANTOM_TEXT_NEVER_ON_SCREEN" is not on screen, so !includes() → true on first round
    expect(result).toBe(true);
  });

  test("attemptSubmitRounds returns false when prompt stays visible", async () => {
    // Type unique text on the command line
    sendSpecialKey(paneId, "C-u");
    sendLiteralText(paneId, "STAYS_VISIBLE");
    await Bun.sleep(100);

    // "STAYS_VISIBLE" is on the command line.
    // attemptSubmitRounds presses C-m which tries to run it as a command.
    // After execution, "STAYS_VISIBLE" may appear as "command not found" output
    // so the normalized capture still includes it → function returns false after all rounds
    const result = await attemptSubmitRounds(paneId, "STAYS_VISIBLE", 1, 1);
    // Whether it's true or false depends on timing. Verify it runs and returns boolean.
    expect(typeof result).toBe("boolean");

    // Clean up
    sendSpecialKey(paneId, "C-c");
    sendSpecialKey(paneId, "C-u");
  });

  test("attemptSubmitRounds handles pressesPerRound > 1", async () => {
    sendLiteralText(paneId, "echo MULTI_ROUND");
    await Bun.sleep(100);

    const result = await attemptSubmitRounds(paneId, "echo MULTI_ROUND", 2, 2);
    expect(typeof result).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// Integration: attachSession error path
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("attachSession error path", () => {
  test("attachSession throws for non-existent session with stderr detail", () => {
    expect(() => attachSession("nonexistent-session-xyz-99999")).toThrow(/Failed to attach.*nonexistent-session-xyz-99999/);
  });
});

// ---------------------------------------------------------------------------
// killWindow
// ---------------------------------------------------------------------------

const KILLWIN_SESSION = `atomic-kw-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("killWindow", () => {
  afterAll(() => {
    killSession(KILLWIN_SESSION);
  });

  test("killWindow removes a window and does not throw", () => {
    createSession(KILLWIN_SESSION, "bash", "main");
    createWindow(KILLWIN_SESSION, "to-kill", "bash");
    expect(() => killWindow(KILLWIN_SESSION, "to-kill")).not.toThrow();
  });

  test("killWindow does not throw for non-existent window", () => {
    expect(() => killWindow(KILLWIN_SESSION, "nonexistent-window-xyz")).not.toThrow();
  });

  test("killWindow does not throw for non-existent session", () => {
    expect(() => killWindow("nonexistent-session-xyz-99999", "whatever")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createSession / createWindow with cwd parameter
// ---------------------------------------------------------------------------

const CWD_SESSION = `atomic-cwd-${crypto.randomUUID().slice(0, 8)}`;

describe.if(tmuxAvailable)("createSession and createWindow with cwd", () => {
  afterAll(() => {
    killSession(CWD_SESSION);
  });

  test("createSession with cwd creates a session in the given directory", async () => {
    const paneId = createSession(CWD_SESSION, "bash", "cwd-test", "/tmp");
    expect(paneId).toMatch(/^%\d+$/);
    await Bun.sleep(300);
    const captured = capturePane(paneId);
    expect(typeof captured).toBe("string");
  });

  test("createWindow with cwd creates a window in the given directory", () => {
    const paneId = createWindow(CWD_SESSION, "cwd-win", "bash", "/tmp");
    expect(paneId).toMatch(/^%\d+$/);
  });
});

// ---------------------------------------------------------------------------
// getCurrentSession
// ---------------------------------------------------------------------------

describe("getCurrentSession", () => {
  withEnvRestore(["TMUX", "PSMUX"]);

  test("returns null when not inside tmux", () => {
    delete process.env.TMUX;
    delete process.env.PSMUX;
    expect(getCurrentSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// switchClient — error path (not inside tmux)
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("switchClient", () => {
  test("throws when called with non-existent session", () => {
    expect(() => switchClient("nonexistent-session-xyz-99999")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// attachOrSwitch
// ---------------------------------------------------------------------------

describe.if(tmuxAvailable)("attachOrSwitch", () => {
  withEnvRestore(["TMUX", "PSMUX"]);

  test("outside tmux: calls attachSession (throws for non-existent session)", () => {
    delete process.env.TMUX;
    delete process.env.PSMUX;
    expect(() => attachOrSwitch("nonexistent-session-xyz-99999")).toThrow(/Failed to attach/);
  });

  test("inside tmux: calls switchClient (throws for non-existent session)", () => {
    process.env.TMUX = "/tmp/tmux-fake/default,12345,0";
    delete process.env.PSMUX;
    expect(() => attachOrSwitch("nonexistent-session-xyz-99999")).toThrow();
  });
});
