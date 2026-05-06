/**
 * Unit coverage for `resolveDispatcher` and `buildSelfExecCommand`.
 *
 * resolveDispatcher resolution order:
 *   1. `override` (non-empty)        → `{ kind: "override-binary" }`
 *   2. SDK cli.ts on disk (host-bun) → `{ kind: "host-bun" }`
 *   3. Nothing                       → throws `NoDispatcherError`
 *
 * Synthetic `resolveSdkCli` mocks keep tests hermetic so they can run
 * in any environment (compiled or otherwise) without depending on the
 * real `import.meta.resolve` behaviour.
 */

import { test, expect, describe, beforeEach, afterEach, spyOn } from "bun:test";
import { pathToFileURL } from "node:url";
import {
  resolveDispatcher,
  buildSelfExecCommand,
  type Dispatcher,
} from "./self-exec.ts";
import { NoDispatcherError } from "../errors.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A `resolveSdkCli` mock that returns a file URL for a given fs path. */
function sdkCliAt(fsPath: string): () => string {
  return () => pathToFileURL(fsPath).href;
}

/** A `resolveSdkCli` mock that throws — simulates an unresolvable specifier. */
function sdkCliThrow(): () => string {
  return () => {
    throw new Error("Cannot find module '@bastani/atomic-sdk/cli'");
  };
}

// ---------------------------------------------------------------------------
// A. Override branch
// ---------------------------------------------------------------------------

describe("resolveDispatcher – override", () => {
  test("absolute path returns override-binary with exact binary", () => {
    const result = resolveDispatcher({ override: "/usr/local/bin/atomic" });
    expect(result).toEqual({ kind: "override-binary", binary: "/usr/local/bin/atomic" });
  });

  test("bare command name returns override-binary (PATH-resolves at exec time)", () => {
    const result = resolveDispatcher({ override: "atomic" });
    expect(result).toEqual({ kind: "override-binary", binary: "atomic" });
  });

  test("empty override falls through (not treated as override)", () => {
    let result: Dispatcher | undefined;
    try {
      result = resolveDispatcher({
        override: "",
        resolveSdkCli: sdkCliThrow(),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(NoDispatcherError);
      return; // expected path
    }
    expect(result?.kind).not.toBe("override-binary");
  });
});

// ---------------------------------------------------------------------------
// B. host-bun branch
// ---------------------------------------------------------------------------

describe("resolveDispatcher – host-bun", () => {
  test("SDK cli.ts on disk returns host-bun with bun runtime + cliPath", () => {
    const fakeCliPath = "/workspace/packages/atomic-sdk/src/cli.ts";
    const result = resolveDispatcher({
      resolveSdkCli: sdkCliAt(fakeCliPath),
    });
    expect(result.kind).toBe("host-bun");
    if (result.kind === "host-bun") {
      expect(result.runtime).toBe(process.execPath);
      expect(result.cliPath).toBe(fakeCliPath);
    }
  });

  test("SDK cli.js post-publish path also returns host-bun", () => {
    const fakeCliPath = "/proj/node_modules/@bastani/atomic-sdk/dist/cli.js";
    const result = resolveDispatcher({
      resolveSdkCli: sdkCliAt(fakeCliPath),
    });
    expect(result.kind).toBe("host-bun");
    if (result.kind === "host-bun") {
      expect(result.cliPath).toBe(fakeCliPath);
    }
  });

  test("bunfs cli path is NOT used as host-bun (must fall through)", () => {
    // When the SDK is bundled into a compiled binary, `import.meta.resolve`
    // returns a `/$bunfs/...` path that's only readable from inside the
    // owning process. Spawning `bun /$bunfs/...` from a separate process
    // can't work, so resolveDispatcher must skip this branch.
    let thrown: unknown;
    try {
      resolveDispatcher({
        resolveSdkCli: () => "file:///$bunfs/root/atomic-sdk/cli.js",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NoDispatcherError);
  });

  test("Windows ~BUN bunfs path is NOT used as host-bun", () => {
    let thrown: unknown;
    try {
      resolveDispatcher({
        resolveSdkCli: () => "file:///C:/~BUN/root/atomic-sdk/cli.js",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NoDispatcherError);
  });

  test("override takes precedence over host-bun", () => {
    const result = resolveDispatcher({
      override: "/explicit/atomic",
      resolveSdkCli: sdkCliAt("/workspace/sdk/cli.ts"),
    });
    expect(result.kind).toBe("override-binary");
    if (result.kind === "override-binary") {
      expect(result.binary).toBe("/explicit/atomic");
    }
  });
});

// ---------------------------------------------------------------------------
// B'. Compiled-host auto-default
// ---------------------------------------------------------------------------

describe("resolveDispatcher – compiled-host auto-default", () => {
  test("compiled binary with no override defaults to process.execPath", () => {
    const result = resolveDispatcher({
      compiledRuntimeProbe: () => true,
      // resolveSdkCli is irrelevant — auto-default fires before host-bun.
    });
    expect(result.kind).toBe("override-binary");
    if (result.kind === "override-binary") {
      expect(result.binary).toBe(process.execPath);
    }
  });

  test("explicit override beats the compiled-host auto-default", () => {
    const result = resolveDispatcher({
      override: "/usr/local/bin/atomic",
      compiledRuntimeProbe: () => true,
    });
    expect(result.kind).toBe("override-binary");
    if (result.kind === "override-binary") {
      expect(result.binary).toBe("/usr/local/bin/atomic");
    }
  });

  test("empty-string override skips the auto-default (explicit opt-out)", () => {
    let thrown: unknown;
    try {
      resolveDispatcher({
        override: "",
        compiledRuntimeProbe: () => true,
        resolveSdkCli: sdkCliThrow(),
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NoDispatcherError);
  });

  test("non-compiled host with no override falls through to host-bun", () => {
    const fakeCliPath = "/proj/node_modules/@bastani/atomic-sdk/dist/cli.js";
    const result = resolveDispatcher({
      compiledRuntimeProbe: () => false,
      resolveSdkCli: sdkCliAt(fakeCliPath),
    });
    expect(result.kind).toBe("host-bun");
  });
});

// ---------------------------------------------------------------------------
// C. NoDispatcherError
// ---------------------------------------------------------------------------

describe("resolveDispatcher – NoDispatcherError", () => {
  test("SDK cli unresolvable → throws NoDispatcherError", () => {
    let thrown: unknown;
    try {
      resolveDispatcher({ resolveSdkCli: sdkCliThrow() });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NoDispatcherError);
  });

  test("searchedFor is single SDK-cli sentinel", () => {
    let thrown: unknown;
    try {
      resolveDispatcher({ resolveSdkCli: sdkCliThrow() });
    } catch (err) {
      thrown = err;
    }
    const err = thrown as NoDispatcherError;
    expect(err.searchedFor).toEqual(["@bastani/atomic-sdk/cli (host-bun)"]);
  });

  test("err.name is 'NoDispatcherError'", () => {
    let thrown: unknown;
    try {
      resolveDispatcher({ resolveSdkCli: sdkCliThrow() });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as NoDispatcherError).name).toBe("NoDispatcherError");
  });
});

// ---------------------------------------------------------------------------
// D. ATOMIC_DEBUG=1 logging
// ---------------------------------------------------------------------------

describe("resolveDispatcher – ATOMIC_DEBUG=1 logging", () => {
  let stderrLines: string[];
  let originalDebug: string | undefined;

  beforeEach(() => {
    stderrLines = [];
    originalDebug = process.env.ATOMIC_DEBUG;
    process.env.ATOMIC_DEBUG = "1";
    spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.join(" "));
    });
  });

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.ATOMIC_DEBUG;
    } else {
      process.env.ATOMIC_DEBUG = originalDebug;
    }
  });

  test("override-binary: logs kind and binary path to stderr", () => {
    resolveDispatcher({ override: "/usr/local/bin/atomic" });
    expect(stderrLines.length).toBe(1);
    expect(stderrLines[0]).toContain("kind=override-binary");
    expect(stderrLines[0]).toContain("/usr/local/bin/atomic");
    expect(stderrLines[0]).toContain("[atomic-sdk:resolveDispatcher]");
  });

  test("host-bun: logs runtime and cliPath", () => {
    const fakeCliPath = "/workspace/packages/atomic-sdk/src/cli.ts";
    resolveDispatcher({ resolveSdkCli: sdkCliAt(fakeCliPath) });
    expect(stderrLines.length).toBe(1);
    expect(stderrLines[0]).toContain("kind=host-bun");
    expect(stderrLines[0]).toContain(fakeCliPath);
    expect(stderrLines[0]).toContain("[atomic-sdk:resolveDispatcher]");
  });

  test("no log when ATOMIC_DEBUG unset", () => {
    delete process.env.ATOMIC_DEBUG;
    resolveDispatcher({ override: "/usr/local/bin/atomic" });
    expect(stderrLines.length).toBe(0);
  });

  test("no log when ATOMIC_DEBUG=0", () => {
    process.env.ATOMIC_DEBUG = "0";
    resolveDispatcher({ override: "/usr/local/bin/atomic" });
    expect(stderrLines.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildSelfExecCommand — argv quoting + dispatcher destructuring
// ---------------------------------------------------------------------------

describe("buildSelfExecCommand", () => {
  describe("posix / bash", () => {
    test("host-bun dispatcher emits `<bun> <cli> <subcommand> <args…>`", () => {
      const dispatcher: Dispatcher = {
        kind: "host-bun",
        runtime: "/usr/bin/bun",
        cliPath: "/repo/packages/atomic-sdk/src/cli.ts",
      };
      const cmd = buildSelfExecCommand({
        dispatcher,
        subcommand: "_orchestrator-entry",
        args: ["session-1", "/work dir/value"],
        platform: "linux",
      });
      expect(cmd).toBe(
        `"/usr/bin/bun" "/repo/packages/atomic-sdk/src/cli.ts" _orchestrator-entry "session-1" "/work dir/value"`,
      );
    });

    test("override-binary dispatcher (runtime === cliPath) drops cli script argument", () => {
      const dispatcher: Dispatcher = {
        kind: "override-binary",
        binary: "/usr/local/bin/atomic",
      };
      const cmd = buildSelfExecCommand({
        dispatcher,
        subcommand: "_cc-debounce",
        args: [],
        platform: "linux",
      });
      expect(cmd).toBe(`"/usr/local/bin/atomic" _cc-debounce`);
    });

    test("flag-shaped argv tokens are emitted bare; values are double-quoted", () => {
      const cmd = buildSelfExecCommand({
        runtime: "/usr/bin/bun",
        cliPath: "/repo/cli.ts",
        subcommand: "_x",
        args: ["--name", "agent-1", "-v", "value with spaces"],
        platform: "linux",
      });
      expect(cmd).toBe(
        `"/usr/bin/bun" "/repo/cli.ts" _x --name "agent-1" -v "value with spaces"`,
      );
    });

    test("special bash characters in values are escaped with a backslash", () => {
      const cmd = buildSelfExecCommand({
        runtime: "/usr/bin/bun",
        cliPath: "/repo/cli.ts",
        subcommand: "_x",
        args: ['a"b', "$VAR", "back`tick", "bang!"],
        platform: "linux",
      });
      expect(cmd).toBe(
        `"/usr/bin/bun" "/repo/cli.ts" _x "a\\"b" "\\$VAR" "back\\\`tick" "bang\\!"`,
      );
    });

    test("newlines and NUL bytes inside argv are flattened to spaces / dropped", () => {
      const cmd = buildSelfExecCommand({
        runtime: "/usr/bin/bun",
        cliPath: "/repo/cli.ts",
        subcommand: "_x",
        args: ["line1\nline2", "with\0nul"],
        platform: "linux",
      });
      expect(cmd).toBe(
        `"/usr/bin/bun" "/repo/cli.ts" _x "line1 line2" "withnul"`,
      );
    });
  });

  describe("win32 / pwsh", () => {
    test("host-bun emits single-quoted pwsh literals for runtime, cli, subcommand and args", () => {
      const dispatcher: Dispatcher = {
        kind: "host-bun",
        runtime: "C:\\Program Files\\bun\\bun.exe",
        cliPath: "C:\\repo\\cli.ts",
      };
      const cmd = buildSelfExecCommand({
        dispatcher,
        subcommand: "_orchestrator-entry",
        args: ["session-1", "C:\\work dir\\value"],
        platform: "win32",
      });
      expect(cmd).toBe(
        `'C:\\Program Files\\bun\\bun.exe' 'C:\\repo\\cli.ts' '_orchestrator-entry' 'session-1' 'C:\\work dir\\value'`,
      );
    });

    test("override-binary dispatcher (runtime === cliPath) drops cli script argument", () => {
      const dispatcher: Dispatcher = {
        kind: "override-binary",
        binary: "C:\\opt\\atomic.exe",
      };
      const cmd = buildSelfExecCommand({
        dispatcher,
        subcommand: "_cc-debounce",
        args: ["a", "b"],
        platform: "win32",
      });
      expect(cmd).toBe(`'C:\\opt\\atomic.exe' '_cc-debounce' 'a' 'b'`);
    });

    test("single quotes inside values are doubled per pwsh single-quoted literal rules", () => {
      const cmd = buildSelfExecCommand({
        runtime: "bun.exe",
        cliPath: "cli.ts",
        subcommand: "_x",
        args: ["it's a value"],
        platform: "win32",
      });
      expect(cmd).toBe(`'bun.exe' 'cli.ts' '_x' 'it''s a value'`);
    });

    test("newlines and NUL bytes inside argv are flattened to spaces / dropped", () => {
      const cmd = buildSelfExecCommand({
        runtime: "bun.exe",
        cliPath: "cli.ts",
        subcommand: "_x",
        args: ["line1\nline2", "with\0nul"],
        platform: "win32",
      });
      expect(cmd).toBe(`'bun.exe' 'cli.ts' '_x' 'line1 line2' 'withnul'`);
    });
  });
});
