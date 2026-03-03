/**
 * Tests for ClipboardAdapter built on OpenTUI clipboard APIs with pbcopy fallback.
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

    test("falls back to pbcopy when OSC 52 write fails on macOS", () => {
      const renderer = makeMockRenderer({ osc52Supported: true, copyResult: false });
      const whichSpy = spyOn(Bun, "which").mockImplementation((cmd: string) => {
        if (cmd === "pbcopy") return "/usr/bin/pbcopy" as ReturnType<typeof Bun.which>;
        return null as ReturnType<typeof Bun.which>;
      });
      const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
        success: true,
      } as ReturnType<typeof Bun.spawnSync>);

      const adapter = createClipboardAdapter(renderer);

      expect(adapter.copy("test")).toBe(true);
      expect(renderer.copyToClipboardOSC52).toHaveBeenCalledWith("test");
      expect(spawnSpy).toHaveBeenCalled();

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
    });

    test("prefers pbcopy on Apple Terminal", () => {
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

      expect(adapter.copy("hello")).toBe(true);
      expect(spawnSpy).toHaveBeenCalled();
      expect((renderer.copyToClipboardOSC52 as ReturnType<typeof mock>).mock.calls.length).toBe(0);

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
    });
  });

  describe("when OSC 52 is NOT supported", () => {
    test("falls back to pbcopy on macOS", () => {
      const renderer = makeMockRenderer({ osc52Supported: false });
      const whichSpy = spyOn(Bun, "which").mockImplementation((cmd: string) => {
        if (cmd === "pbcopy") return "/usr/bin/pbcopy" as ReturnType<typeof Bun.which>;
        return null as ReturnType<typeof Bun.which>;
      });
      const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
        success: true,
      } as ReturnType<typeof Bun.spawnSync>);
      const adapter = createClipboardAdapter(renderer);

      expect(adapter.copy("hello")).toBe(true);
      expect((renderer.copyToClipboardOSC52 as ReturnType<typeof mock>).mock.calls.length).toBe(0);

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
    });

    test("returns false when OSC 52 unsupported and pbcopy unavailable", () => {
      const renderer = makeMockRenderer({ osc52Supported: false });
      const whichSpy = spyOn(Bun, "which").mockReturnValue(null as ReturnType<typeof Bun.which>);
      const adapter = createClipboardAdapter(renderer);

      expect(adapter.copy("hello")).toBe(false);

      whichSpy.mockRestore();
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

});
