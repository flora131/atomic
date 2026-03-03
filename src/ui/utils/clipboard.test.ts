/**
 * Tests for ClipboardAdapter modeled after OpenCode clipboard behavior.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createClipboardAdapter } from "./clipboard.ts";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClipboardAdapter", () => {
  const originalPlatform = process.platform;
  const originalWayland = process.env.WAYLAND_DISPLAY;
  const originalStdoutIsTTY = process.stdout.isTTY;

  const setPlatform = (platform: NodeJS.Platform): void => {
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
  };

  beforeEach(() => {
    process.env.WAYLAND_DISPLAY = undefined;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    process.env.WAYLAND_DISPLAY = originalWayland;
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });
    setPlatform(originalPlatform);
  });

  describe("copy", () => {
    test("writes OSC52 and native clipboard on macOS", () => {
      setPlatform("darwin");

      const writeSpy = spyOn(process.stdout, "write").mockReturnValue(true);
      const whichSpy = spyOn(Bun, "which").mockImplementation((cmd: string) => {
        if (cmd === "osascript") return "/usr/bin/osascript" as ReturnType<typeof Bun.which>;
        return null as ReturnType<typeof Bun.which>;
      });
      const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
        success: true,
      } as ReturnType<typeof Bun.spawnSync>);

      const adapter = createClipboardAdapter();

      const result = adapter.copy("hello");

      expect(result).toBe(true);
      expect(writeSpy).toHaveBeenCalled();
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: ["osascript", "-e", "set the clipboard to \"hello\""],
        }),
      );

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
      writeSpy.mockRestore();
    });

    test("uses wl-copy on Wayland Linux", () => {
      setPlatform("linux");
      process.env.WAYLAND_DISPLAY = "wayland-0";

      const whichSpy = spyOn(Bun, "which").mockImplementation((cmd: string) => {
        if (cmd === "wl-copy") return "/usr/bin/wl-copy" as ReturnType<typeof Bun.which>;
        return null as ReturnType<typeof Bun.which>;
      });
      const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
        success: true,
      } as ReturnType<typeof Bun.spawnSync>);

      const adapter = createClipboardAdapter();

      expect(adapter.copy("test")).toBe(true);
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: ["wl-copy"],
        }),
      );

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
    });

    test("falls back to OSC52-only when no native command is available", () => {
      const writeSpy = spyOn(process.stdout, "write").mockReturnValue(true);
      const whichSpy = spyOn(Bun, "which").mockReturnValue(null as ReturnType<typeof Bun.which>);

      const adapter = createClipboardAdapter();

      expect(adapter.copy("hello")).toBe(true);
      expect(writeSpy).toHaveBeenCalled();

      whichSpy.mockRestore();
      writeSpy.mockRestore();
    });
  });

  describe("readText", () => {
    test("reads clipboard text with pbpaste on macOS", () => {
      setPlatform("darwin");

      const whichSpy = spyOn(Bun, "which").mockImplementation((cmd: string) => {
        if (cmd === "pbpaste") return "/usr/bin/pbpaste" as ReturnType<typeof Bun.which>;
        return null as ReturnType<typeof Bun.which>;
      });
      const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
        success: true,
        stdout: new TextEncoder().encode("from-clipboard"),
      } as ReturnType<typeof Bun.spawnSync>);

      const adapter = createClipboardAdapter();

      expect(adapter.readText()).toBe("from-clipboard");

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
    });

    test("returns undefined when no read strategy exists", () => {
      setPlatform("darwin");
      const whichSpy = spyOn(Bun, "which").mockReturnValue(null as ReturnType<typeof Bun.which>);

      const adapter = createClipboardAdapter();

      expect(adapter.readText()).toBeUndefined();

      whichSpy.mockRestore();
    });
  });

});
