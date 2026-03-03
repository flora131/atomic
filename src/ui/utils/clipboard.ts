/**
 * Clipboard Strategy Module
 *
 * Provides a platform-aware clipboard write abstraction using the Strategy
 * pattern (GoF). The module selects the best available clipboard mechanism
 * at runtime:
 *
 *   1. **OSC 52** — terminal escape sequence (fastest, no subprocess). Works
 *      in iTerm2, Kitty, Alacritty, WezTerm, Ghostty, and other modern
 *      terminals.
 *   2. **Platform command** — subprocess fallback (`pbcopy` on macOS, `xclip`
 *      / `xsel` / `wl-copy` on Linux). Works universally on platforms that
 *      ship these tools (macOS Terminal.app, VS Code terminal, etc.).
 *
 * ## Why this is needed
 *
 * Mouse tracking is always enabled for scroll-wheel and OpenTUI's Selection
 * API. When the user mouse-drags to select text, the TUI copies it to the
 * clipboard programmatically via this module. OSC 52 is tried first, with a
 * native command fallback for terminals that don't support it.
 *
 * For native terminal text selection, users can hold Shift (Linux/Windows) or
 * Option (macOS/iTerm2) while clicking — a built-in terminal emulator bypass.
 *
 * @module
 */

import type { CliRenderer } from "@opentui/core";

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

/**
 * A clipboard write strategy.
 *
 * Implementations return `true` when the text was (or is expected to have
 * been) written successfully, and `false` otherwise.
 */
export interface ClipboardWriteStrategy {
  /** Copy `text` to the system clipboard. */
  copy(text: string): boolean;
}

// ---------------------------------------------------------------------------
// Concrete strategies
// ---------------------------------------------------------------------------

/**
 * Writes to the clipboard via the OSC 52 terminal escape sequence.
 *
 * This is the fastest mechanism (no subprocess) and works in modern terminal
 * emulators that advertise OSC 52 support through their capability response.
 */
class Osc52Strategy implements ClipboardWriteStrategy {
  constructor(private readonly renderer: CliRenderer) {}

  copy(text: string): boolean {
    return this.renderer.copyToClipboardOSC52(text);
  }
}

/**
 * Writes to the clipboard by spawning a platform-native command.
 *
 * Supported commands (checked in order):
 *   - **macOS**: `pbcopy`
 *   - **Linux / Wayland**: `wl-copy`
 *   - **Linux / X11**: `xclip -selection clipboard`
 *   - **Linux / X11 (alt)**: `xsel --clipboard --input`
 */
class NativeCommandStrategy implements ClipboardWriteStrategy {
  private readonly cmd: string[];

  constructor(cmd: string[]) {
    this.cmd = cmd;
  }

  copy(text: string): boolean {
    try {
      const proc = Bun.spawnSync({
        cmd: this.cmd,
        stdin: new TextEncoder().encode(text),
        stdout: "ignore",
        stderr: "ignore",
      });
      return proc.success;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Strategy resolution
// ---------------------------------------------------------------------------

/** A resolved write strategy with optional fallback strategy. */
interface ResolvedStrategies {
  /** Primary strategy to use. */
  primary: ClipboardWriteStrategy;
  /** Optional fallback strategy when primary fails. */
  fallback: ClipboardWriteStrategy | null;
}

/**
 * macOS Terminal.app is inconsistent with OSC 52 clipboard writes.
 *
 * Even when the renderer reports OSC 52 support, clipboard writes may be
 * dropped. Prefer native `pbcopy` there when available.
 */
function shouldPreferNativeClipboard(): boolean {
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  return termProgram === "apple_terminal";
}

/**
 * Detect the best native clipboard command for the current platform.
 * Returns the command argv or `null` if no suitable tool is found.
 */
function detectNativeClipboardCommand(): string[] | null {
  const platform = process.platform;

  if (platform === "darwin") {
    if (Bun.which("pbcopy")) return ["pbcopy"];
  }

  if (platform === "linux") {
    // Wayland first, then X11
    if (Bun.which("wl-copy")) return ["wl-copy"];
    if (Bun.which("xclip")) return ["xclip", "-selection", "clipboard"];
    if (Bun.which("xsel")) return ["xsel", "--clipboard", "--input"];
  }

  // Windows: PowerShell Set-Clipboard could be added here in the future
  return null;
}

/**
 * Resolve the clipboard write strategies for the current environment.
 *
 * Resolution order:
 *   1. If OSC 52 is supported → use it as primary, native as fallback
 *   2. If OSC 52 is NOT supported → use native as primary
 *   3. If neither is available → use OSC 52 as a best-effort (write goes to
 *      terminal which may or may not honour it)
 */
function resolveStrategies(renderer: CliRenderer): ResolvedStrategies {
  const osc52 = new Osc52Strategy(renderer);
  const nativeCmd = detectNativeClipboardCommand();
  const native = nativeCmd ? new NativeCommandStrategy(nativeCmd) : null;

  const osc52Supported = renderer.isOsc52Supported();
  const preferNative = shouldPreferNativeClipboard();

  if (preferNative && native) {
    return { primary: native, fallback: osc52Supported ? osc52 : null };
  }

  if (osc52Supported && native) {
    // Best case: fast path via OSC 52, native fallback for runtime failures
    return { primary: osc52, fallback: native };
  }

  if (osc52Supported) {
    return { primary: osc52, fallback: null };
  }

  if (native) {
    // OSC 52 not supported — use native as primary, try OSC 52 as secondary
    return { primary: native, fallback: osc52 };
  }

  // Nothing detected — best-effort OSC 52
  return { primary: osc52, fallback: null };
}

// ---------------------------------------------------------------------------
// Public API — ClipboardAdapter (Adapter pattern wrapping strategies)
// ---------------------------------------------------------------------------

/**
 * Platform-aware clipboard adapter.
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

/**
 * Create a {@link ClipboardAdapter} for the given renderer.
 *
 * The adapter internally selects the best strategy (OSC 52 or native
 * command) and chains them so that if the primary fails, the secondary
 * is attempted.
 */
export function createClipboardAdapter(renderer: CliRenderer): ClipboardAdapter {
  // Resolve once per adapter — strategy selection is stable for the
  // lifetime of a renderer because terminal capabilities don't change.
  let strategies: ResolvedStrategies | null = null;

  const getStrategies = (): ResolvedStrategies => {
    if (!strategies) {
      strategies = resolveStrategies(renderer);
    }
    return strategies;
  };

  return {
    copy(text: string): boolean {
      const { primary, fallback } = getStrategies();

      // Try primary first
      if (primary.copy(text)) return true;

      // If there's a fallback strategy, try it as well
      if (fallback && fallback.copy(text)) return true;

      return false;
    },
  };
}
