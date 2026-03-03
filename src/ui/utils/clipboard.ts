/**
 * Clipboard adapter built on OpenTUI's native clipboard APIs.
 *
 * OpenTUI already handles OSC 52 support detection and clipboard writes via
 * the renderer (`isOsc52Supported` / `copyToClipboardOSC52`).
 *
 * We keep a narrow native fallback for macOS Terminal.app using `pbcopy`.
 */

import type { CliRenderer } from "@opentui/core";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clipboard adapter for OpenTUI renderer.
 *
 * Create one instance per renderer and reuse it for all copy operations.
 *
 * ```ts
 * const clipboard = createClipboardAdapter(renderer);
 * clipboard.copy("Hello, world!");
 * ```
 */
export interface ClipboardAdapter {
  /** Copy `text` to the system clipboard. Returns `true` on success. */
  copy(text: string): boolean;
}

function isAppleTerminal(): boolean {
  return (process.env.TERM_PROGRAM ?? "").toLowerCase() === "apple_terminal";
}

function canUsePbcopy(): boolean {
  return process.platform === "darwin" && Bun.which("pbcopy") !== null;
}

function copyWithPbcopy(text: string): boolean {
  try {
    const proc = Bun.spawnSync({
      cmd: ["pbcopy"],
      stdin: new TextEncoder().encode(text),
      stdout: "ignore",
      stderr: "ignore",
    });
    return proc.success;
  } catch {
    return false;
  }
}

/**
 * Create a {@link ClipboardAdapter} for the given renderer.
 *
 * The adapter caches OpenTUI's OSC 52 support result and performs copy
 * operations only when support is available.
 */
export function createClipboardAdapter(renderer: CliRenderer): ClipboardAdapter {
  let isSupported: boolean | null = null;
  const usePbcopy = canUsePbcopy();
  const preferPbcopy = usePbcopy && isAppleTerminal();

  const getSupport = (): boolean => {
    if (isSupported === null) {
      isSupported = renderer.isOsc52Supported();
    }
    return isSupported;
  };

  return {
    copy(text: string): boolean {
      if (preferPbcopy) {
        if (copyWithPbcopy(text)) return true;
        if (!getSupport()) return false;
        return renderer.copyToClipboardOSC52(text);
      }

      if (getSupport()) {
        if (renderer.copyToClipboardOSC52(text)) return true;
      }

      if (usePbcopy) {
        return copyWithPbcopy(text);
      }

      return false;
    },
  };
}
