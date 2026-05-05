/**
 * Unit coverage for `resolveSdkCliPath`.
 *
 * Pins the three resolution branches the public contract advertises:
 *   1. `override` → returned verbatim. Mirrors Claude Code SDK's
 *      `pathToClaudeCodeExecutable` semantics, including bare command
 *      names that the shell PATH-resolves at exec time.
 *   2. Compiled-binary runtime → `process.execPath` (the binary IS the CLI).
 *   3. Otherwise → delegated to `import.meta.resolve("@bastani/atomic-sdk/cli")`.
 *      The runtime's package resolver honours `package.json#exports`, so
 *      the resolved path is the canonical bundled dispatcher with no path
 *      walks and no layout assumptions in this code.
 *
 * Each branch encodes a packaging decision: regressing any one of them
 * leaks the SDK's self-exec resolution into the consumer's tree — the
 * pre-fix bug where the SDK walked up out of its own package and into
 * `node_modules/atomic/` looking for the user-facing CLI.
 */

import { test, expect, describe } from "bun:test";
import { existsSync } from "node:fs";
import { resolveSdkCliPath } from "./self-exec.ts";

describe("resolveSdkCliPath", () => {
  test("override is returned verbatim (absolute path)", () => {
    const cli = resolveSdkCliPath({ override: "/usr/local/bin/atomic" });
    expect(cli).toBe("/usr/local/bin/atomic");
  });

  test("override is returned verbatim (bare command name resolves via PATH)", () => {
    // Mirrors the v0.2.63 fix to Claude Code SDK's pathToClaudeCodeExecutable —
    // bare names must round-trip so the shell can resolve them at exec time.
    const cli = resolveSdkCliPath({ override: "atomic" });
    expect(cli).toBe("atomic");
  });

  test("empty override falls through to default resolution", () => {
    const cli = resolveSdkCliPath({ override: "" });
    // Default resolution lands on a real cli.{ts,js} on disk.
    expect(cli.endsWith("cli.ts") || cli.endsWith("cli.js")).toBe(true);
    expect(existsSync(cli)).toBe(true);
  });

  test("compiled-binary caller (POSIX bunfs) returns process.execPath", () => {
    const cli = resolveSdkCliPath({
      callerUrl: "file:///$bunfs/root/atomic/runtime/executor.js",
    });
    expect(cli).toBe(process.execPath);
  });

  test("compiled-binary caller (Windows ~BUN) returns process.execPath", () => {
    const cli = resolveSdkCliPath({
      callerUrl: "file:///C:/~BUN/root/atomic/runtime/executor.js",
    });
    expect(cli).toBe(process.execPath);
  });

  test("default resolution lands inside @bastani/atomic-sdk", () => {
    // The runtime's package resolver consults package.json#exports —
    // for `./cli` that's `./src/cli.ts` in dev (or `./dist/cli.js`
    // post-publish). Either way the resolved path lives inside the SDK
    // package, never in a sibling.
    const cli = resolveSdkCliPath();
    expect(cli).toContain("atomic-sdk");
    expect(cli.endsWith("cli.ts") || cli.endsWith("cli.js")).toBe(true);
  });

  test("default resolution does not walk into a sibling `atomic` package", () => {
    // Pre-fix bug: the resolver walked `../../../atomic/src/cli.ts`,
    // which for SDK-only consumers (those installing only
    // @bastani/atomic-sdk without the user-facing CLI package)
    // resolved into a non-existent sibling. The new resolver delegates
    // to `import.meta.resolve` so it stays inside the SDK's own
    // package layout.
    const cli = resolveSdkCliPath();
    expect(cli).not.toContain("/atomic/src/");
    expect(cli).not.toContain("/atomic/dist/");
    expect(cli).not.toContain("\\atomic\\src\\");
    expect(cli).not.toContain("\\atomic\\dist\\");
  });
});
