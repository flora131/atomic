/**
 * Tests for ClipboardAdapter modeled after OpenCode clipboard behavior.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createClipboardAdapter } from "@/lib/ui/clipboard.ts";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClipboardAdapter", () => {
  const originalPlatform = process.platform;
  const originalWayland = process.env.WAYLAND_DISPLAY;
  const originalTmux = process.env.TMUX;
  const originalStdoutIsTTY = process.stdout.isTTY;

  const setPlatform = (platform: NodeJS.Platform): void => {
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
  };

  beforeEach(() => {
    process.env.WAYLAND_DISPLAY = undefined;
    process.env.TMUX = undefined;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    process.env.WAYLAND_DISPLAY = originalWayland;
    process.env.TMUX = originalTmux;
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });
    setPlatform(originalPlatform);
  });

  describe("copy", () => {
    test("writes OSC52 and uses pbcopy first on macOS", () => {
      setPlatform("darwin");

      const writeSpy = spyOn(process.stdout, "write").mockReturnValue(true);
      const whichSpy = spyOn(Bun, "which").mockImplementation((cmd: string) => {
        if (cmd === "pbcopy") return "/usr/bin/pbcopy" as ReturnType<typeof Bun.which>;
        if (cmd === "osascript") return "/usr/bin/osascript" as ReturnType<typeof Bun.which>;
        return null as ReturnType<typeof Bun.which>;
      });
      const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
        success: true,
      } as ReturnType<typeof Bun.spawnSync>);

      const adapter = createClipboardAdapter();

      const result = adapter.copy("hello\nworld");

      expect(result).toBe(true);
      expect(writeSpy).toHaveBeenCalled();
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: ["pbcopy"],
          stdin: new TextEncoder().encode("hello\nworld"),
        }),
      );

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
      writeSpy.mockRestore();
    });

    test("uses tmux load-buffer inside tmux sessions", () => {
      setPlatform("linux");
      process.env.TMUX = "/tmp/tmux-1000/default,123,0";

      const writeSpy = spyOn(process.stdout, "write").mockReturnValue(true);
      const whichSpy = spyOn(Bun, "which").mockImplementation((cmd: string) => {
        if (cmd === "tmux") return "/usr/bin/tmux" as ReturnType<typeof Bun.which>;
        return null as ReturnType<typeof Bun.which>;
      });
      const spawnSpy = spyOn(Bun, "spawnSync").mockReturnValue({
        success: true,
      } as ReturnType<typeof Bun.spawnSync>);

      const adapter = createClipboardAdapter();

      expect(adapter.copy("hello from tmux")).toBe(true);
      expect(writeSpy).toHaveBeenCalledWith("\x1b]52;c;aGVsbG8gZnJvbSB0bXV4\x07");
      expect(spawnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: ["tmux", "load-buffer", "-w", "-"],
          stdin: new TextEncoder().encode("hello from tmux"),
        }),
      );

      spawnSpy.mockRestore();
      whichSpy.mockRestore();
      writeSpy.mockRestore();
    });

    test("uses wl-copy on Wayland Linux", () => {
      setPlatform("linux");
      process.env.WAYLAND_DISPLAY = "wayland-0";

      const writeSpy = spyOn(process.stdout, "write").mockReturnValue(true);
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
      writeSpy.mockRestore();
    });

    test("falls back to OSC52-only when no native command is available", () => {
      const writeSpy = spyOn(process.stdout, "write").mockReturnValue(true);
      const whichSpy = spyOn(Bun, "which").mockReturnValue(null as ReturnType<typeof Bun.which>);

      const adapter = createClipboardAdapter();

      expect(adapter.copy("hello")).toBe(true);
      expect(writeSpy).toHaveBeenCalledWith("\x1b]52;c;aGVsbG8=\x07");

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
