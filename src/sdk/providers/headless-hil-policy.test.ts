/**
 * Tests for the headless human-in-the-loop (HIL) auto-deny policy.
 *
 * In unattended runs (headless stages), no human is attached to answer
 * interactive questions from the agent. If the SDK's ask-user tool is
 * not disabled, a query will sit blocked forever. These tests verify
 * each provider's headless integration blocks the relevant tool.
 */

import { test, expect, describe } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeDisallowedTools, resolveHeadlessClaudeBin } from "./claude.ts";
import {
  HEADLESS_OPENCODE_CLIENT_ID,
  withHeadlessOpencodeEnv,
} from "./opencode.ts";
import { mergeExcludedTools } from "../runtime/executor.ts";

// ---------------------------------------------------------------------------
// Claude — disallowedTools: ["AskUserQuestion"]
// ---------------------------------------------------------------------------

describe("mergeDisallowedTools (Claude)", () => {
  test("adds AskUserQuestion when no existing disallow list", () => {
    expect(mergeDisallowedTools(undefined, ["AskUserQuestion"])).toEqual([
      "AskUserQuestion",
    ]);
  });

  test("preserves caller-supplied entries", () => {
    expect(
      mergeDisallowedTools(["Bash", "WebFetch"], ["AskUserQuestion"]),
    ).toEqual(["Bash", "WebFetch", "AskUserQuestion"]);
  });

  test("does not duplicate AskUserQuestion if caller already disallowed it", () => {
    expect(
      mergeDisallowedTools(["AskUserQuestion", "Bash"], ["AskUserQuestion"]),
    ).toEqual(["AskUserQuestion", "Bash"]);
  });
});

// ---------------------------------------------------------------------------
// Copilot — excludedTools: ["ask_user"]
// ---------------------------------------------------------------------------

describe("mergeExcludedTools (Copilot)", () => {
  test("adds ask_user when no existing excluded list", () => {
    expect(mergeExcludedTools(undefined, ["ask_user"])).toEqual(["ask_user"]);
  });

  test("preserves caller-supplied entries", () => {
    expect(mergeExcludedTools(["bash"], ["ask_user"])).toEqual([
      "bash",
      "ask_user",
    ]);
  });

  test("does not duplicate ask_user if caller already excluded it", () => {
    expect(mergeExcludedTools(["ask_user", "bash"], ["ask_user"])).toEqual([
      "ask_user",
      "bash",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Claude — headless binary resolution pins to the PATH `claude` CLI
// ---------------------------------------------------------------------------

describe("resolveHeadlessClaudeBin", () => {
  const withPath = (path: string, fn: () => void) => {
    const before = process.env.PATH;
    process.env.PATH = path;
    try {
      fn();
    } finally {
      if (before === undefined) delete process.env.PATH;
      else process.env.PATH = before;
    }
  };

  test("returns the `claude` binary when present on PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-claude-bin-"));
    const bin = join(dir, "claude");
    writeFileSync(bin, "#!/usr/bin/env sh\nexit 0\n");
    chmodSync(bin, 0o755);
    withPath(dir, () => {
      expect(resolveHeadlessClaudeBin()).toBe(bin);
    });
  });

  test("throws with installer URL when PATH has no `claude`", () => {
    const empty = mkdtempSync(join(tmpdir(), "atomic-empty-path-"));
    withPath(empty, () => {
      expect(() => resolveHeadlessClaudeBin()).toThrow(/CLI not found on PATH/);
      expect(() => resolveHeadlessClaudeBin()).toThrow(
        /docs\.claude\.com.*claude-code/,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// OpenCode — OPENCODE_CLIENT override excludes the question tool
// ---------------------------------------------------------------------------
//
// Upstream (`packages/opencode/src/tool/registry.ts`) gates the question
// tool on `["app","cli","desktop"].includes(OPENCODE_CLIENT)`. The SDK
// spawns `opencode serve` via cross-spawn and inherits `process.env` at
// fork time, so scoping the override around `createOpencode()` is
// sufficient to keep the tool off the registry.

describe("withHeadlessOpencodeEnv", () => {
  test("sets OPENCODE_CLIENT to the headless id while fn runs", async () => {
    const seen: string | undefined = await withHeadlessOpencodeEnv(async () =>
      process.env.OPENCODE_CLIENT,
    );
    expect(seen).toBe(HEADLESS_OPENCODE_CLIENT_ID);
  });

  test("restores prior value when it was set before", async () => {
    const before = process.env.OPENCODE_CLIENT;
    process.env.OPENCODE_CLIENT = "preexisting";
    try {
      await withHeadlessOpencodeEnv(async () => {});
      expect(process.env.OPENCODE_CLIENT).toBe("preexisting");
    } finally {
      if (before === undefined) delete process.env.OPENCODE_CLIENT;
      else process.env.OPENCODE_CLIENT = before;
    }
  });

  test("unsets the variable when it was unset before", async () => {
    const before = process.env.OPENCODE_CLIENT;
    delete process.env.OPENCODE_CLIENT;
    try {
      await withHeadlessOpencodeEnv(async () => {});
      expect(
        Object.prototype.hasOwnProperty.call(process.env, "OPENCODE_CLIENT"),
      ).toBe(false);
    } finally {
      if (before === undefined) delete process.env.OPENCODE_CLIENT;
      else process.env.OPENCODE_CLIENT = before;
    }
  });

  test("restores prior value even when fn throws", async () => {
    const before = process.env.OPENCODE_CLIENT;
    process.env.OPENCODE_CLIENT = "preexisting";
    try {
      await expect(
        withHeadlessOpencodeEnv(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(process.env.OPENCODE_CLIENT).toBe("preexisting");
    } finally {
      if (before === undefined) delete process.env.OPENCODE_CLIENT;
      else process.env.OPENCODE_CLIENT = before;
    }
  });

  test("is not one of the values that would enable the question tool", () => {
    // Guard against accidental future edits: picking "cli", "app", or
    // "desktop" here would silently re-enable the interactive question tool
    // and make headless stages hang again.
    expect(["app", "cli", "desktop"]).not.toContain(
      HEADLESS_OPENCODE_CLIENT_ID,
    );
  });

  test("concurrent uses do not leak the override after both unwind", async () => {
    // Race regression: without a reference counter, the second concurrent
    // stage reads the first's already-overridden value as its "prior" and
    // restores "sdk" instead of the true original on unwind.
    const before = process.env.OPENCODE_CLIENT;
    delete process.env.OPENCODE_CLIENT;
    try {
      let releaseA!: () => void;
      let releaseB!: () => void;
      const waitA = new Promise<void>((r) => {
        releaseA = r;
      });
      const waitB = new Promise<void>((r) => {
        releaseB = r;
      });

      const a = withHeadlessOpencodeEnv(async () => {
        await waitA;
      });
      const b = withHeadlessOpencodeEnv(async () => {
        await waitB;
      });

      // Release A first, then B — the order that exposes the naive bug.
      releaseA();
      releaseB();
      await Promise.all([a, b]);

      expect(
        Object.prototype.hasOwnProperty.call(process.env, "OPENCODE_CLIENT"),
      ).toBe(false);
    } finally {
      if (before === undefined) delete process.env.OPENCODE_CLIENT;
      else process.env.OPENCODE_CLIENT = before;
    }
  });
});
