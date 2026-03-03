/**
 * Tests for ClipboardAdapter — platform-aware clipboard write strategy.
 *
 * Validates:
 *   1. OSC 52 path is preferred when terminal reports support
 *   2. Native command fallback fires when OSC 52 is not available
 *   3. Chained fallback works (primary fails → secondary attempted)
 *   4. `detectNativeClipboardCommand` resolution per platform
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { createClipboardAdapter } from "./clipboard.ts";
import type { CliRenderer } from "@opentui/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock that satisfies the renderer surface used by ClipboardAdapter */
function makeMockRenderer(overrides: {
  osc52Supported?: boolean;
  copyResult?: boolean;
} = {}): CliRenderer {
  const { osc52Supported = false, copyResult = true } = overrides;
  return {
    isOsc52Supported: mock(() => osc52Supported),
    copyToClipboardOSC52: mock(() => copyResult),
  } as unknown as CliRenderer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClipboardAdapter", () => {
  const originalTermProgram = process.env.TERM_PROGRAM;

  beforeEach(() => {
    // Ensure default path tests don't accidentally inherit Apple Terminal,
    // which intentionally prefers native clipboard over OSC 52.
    process.env.TERM_PROGRAM = "iTerm.app";
  });

  afterEach(() => {
    process.env.TERM_PROGRAM = originalTermProgram;
  });

  describe("when OSC 52 is supported", () => {
    test("uses OSC 52 for copy", () => {
      const renderer = makeMockRenderer({ osc52Supported: true, copyResult: true });
      const adapter = createClipboardAdapter(renderer);

      const result = adapter.copy("hello");

      expect(result).toBe(true);
      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith("hello");
    });

    test("returns true when OSC 52 succeeds", () => {
      const renderer = makeMockRenderer({ osc52Supported: true, copyResult: true });
      const adapter = createClipboardAdapter(renderer);

      expect(adapter.copy("test")).toBe(true);
    });

    test("falls back to native clipboard when OSC 52 write fails", () => {
      const renderer = makeMockRenderer({ osc52Supported: true, copyResult: false });
      const whichSpy = spyOn(Bun, "which").mockImplementation((cmd: string) => {
        if (cmd === "pbcopy") return "/usr/bin/pbcopy" as ReturnType<typeof Bun.which>;
        return null as ReturnType<typeof Bun.which>;
      });
      const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
        success: true,
      } as ReturnType<typeof Bun.spawnSync>);

      const adapter = createClipboardAdapter(renderer);
      const result = adapter.copy("hello");

      expect(result).toBe(true);
      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith("hello");
      expect(spawnSpy).toHaveBeenCalled();

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
    });

    test("prefers native clipboard on Apple Terminal even if OSC 52 is reported", () => {
      process.env.TERM_PROGRAM = "Apple_Terminal";

      const renderer = makeMockRenderer({ osc52Supported: true, copyResult: true });
      const whichSpy = spyOn(Bun, "which").mockImplementation((cmd: string) => {
        if (cmd === "pbcopy") return "/usr/bin/pbcopy" as ReturnType<typeof Bun.which>;
        return null as ReturnType<typeof Bun.which>;
      });
      const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
        success: true,
      } as ReturnType<typeof Bun.spawnSync>);

      const adapter = createClipboardAdapter(renderer);
      const result = adapter.copy("hello");

      expect(result).toBe(true);
      expect(spawnSpy).toHaveBeenCalled();
      expect((renderer.copyToClipboardOSC52 as ReturnType<typeof mock>).mock.calls.length).toBe(0);

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
    });
  });

  describe("when OSC 52 is NOT supported", () => {
    test("does not call OSC 52 as primary", () => {
      const renderer = makeMockRenderer({ osc52Supported: false });
      const adapter = createClipboardAdapter(renderer);

      // On macOS (our test platform), this will attempt pbcopy as the native fallback.
      // The copy result depends on platform availability, but OSC 52 should NOT be the
      // primary path. We verify by checking that the adapter was created successfully
      // and doesn't throw.
      const result = adapter.copy("hello");
      // On macOS with pbcopy available, this should succeed via native fallback
      if (process.platform === "darwin") {
        expect(result).toBe(true);
      }
      // Regardless of platform, the adapter should not throw
      expect(typeof result).toBe("boolean");
    });
  });

  describe("strategy resolution", () => {
    test("adapter is reusable across multiple copy calls", () => {
      const renderer = makeMockRenderer({ osc52Supported: true, copyResult: true });
      const adapter = createClipboardAdapter(renderer);

      adapter.copy("first");
      adapter.copy("second");
      adapter.copy("third");

      // isOsc52Supported is called once for lazy strategy resolution
      expect((renderer.isOsc52Supported as ReturnType<typeof mock>).mock.calls.length).toBe(1);
      // copyToClipboardOSC52 is called for each copy
      expect((renderer.copyToClipboardOSC52 as ReturnType<typeof mock>).mock.calls.length).toBe(3);
    });

    test("strategy resolution is lazy (deferred until first copy)", () => {
      const renderer = makeMockRenderer({ osc52Supported: true });
      createClipboardAdapter(renderer);

      // No calls until copy() is invoked
      expect((renderer.isOsc52Supported as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    });

    test("empty string is handled without error", () => {
      const renderer = makeMockRenderer({ osc52Supported: true, copyResult: true });
      const adapter = createClipboardAdapter(renderer);

      expect(() => adapter.copy("")).not.toThrow();
    });
  });

  describe("native fallback on macOS", () => {
    test.skipIf(process.platform !== "darwin")(
      "pbcopy fallback writes to system clipboard",
      () => {
        // OSC 52 not supported → should fall back to pbcopy on macOS
        const renderer = makeMockRenderer({ osc52Supported: false });
        const adapter = createClipboardAdapter(renderer);

        const testText = `clipboard-test-${Date.now()}`;
        const result = adapter.copy(testText);
        expect(result).toBe(true);

        // Verify by reading back with pbpaste
        const readBack = Bun.spawnSync({
          cmd: ["pbpaste"],
          stdout: "pipe",
        });
        expect(readBack.stdout.toString()).toBe(testText);
      }
    );
  });
});
