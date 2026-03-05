/**
 * Clipboard adapter modeled after OpenCode's terminal implementation.
 *
 * Strategy:
 * 1) Always emit OSC 52 for terminals that support it
 * 2) In tmux, prefer tmux's own clipboard command instead of passthrough
 * 3) Also write to native OS clipboard command for local reliability
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clipboard adapter for the terminal UI.
 *
 * Create one instance and reuse it for all copy operations.
 *
 * ```ts
 * const clipboard = createClipboardAdapter();
 * clipboard.copy("Hello, world!");
 * ```
 */
export interface ClipboardAdapter {
  /** Copy `text` to the system clipboard. Returns `true` on success. */
  copy(text: string): boolean;
  /** Read plain text from the system clipboard when available. */
  readText(): string | undefined;
}

function spawnWithTextInput(command: string[], text: string): boolean {
  try {
    const proc = Bun.spawnSync({
      cmd: command,
      stdin: new TextEncoder().encode(text),
      stdout: "ignore",
      stderr: "ignore",
    });
    return proc.success;
  } catch {
    return false;
  }
}

function spawnReadText(command: string[]): string | undefined {
  try {
    const proc = Bun.spawnSync({
      cmd: command,
      stdout: "pipe",
      stderr: "ignore",
    });
    if (!proc.success || !proc.stdout) return undefined;
    const output = new TextDecoder().decode(proc.stdout).replace(/\0/g, "");
    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}

function writeOsc52(text: string): boolean {
  if (!process.stdout.isTTY) return false;
  try {
    const base64 = Buffer.from(text).toString("base64");
    process.stdout.write(`\x1b]52;c;${base64}\x07`);
    return true;
  } catch {
    return false;
  }
}

type NativeCopyMethod = (text: string) => boolean;
type NativeReadMethod = () => string | undefined;

function resolveNativeCopyMethod(): NativeCopyMethod | null {
  // tmux's built-in clipboard command is more reliable than DCS passthrough:
  // it does not depend on allow-passthrough and works with tmux's default
  // clipboard model.
  if (process.env.TMUX && Bun.which("tmux") !== null) {
    return (text: string): boolean => spawnWithTextInput(["tmux", "load-buffer", "-w", "-"], text);
  }

  if (process.platform === "darwin" && Bun.which("pbcopy") !== null) {
    return (text: string): boolean => spawnWithTextInput(["pbcopy"], text);
  }

  if (process.platform === "darwin" && Bun.which("osascript") !== null) {
    return (text: string): boolean => {
      const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return spawnWithTextInput(["osascript", "-e", `set the clipboard to "${escaped}"`], "");
    };
  }

  if (process.platform === "linux") {
    if (process.env.WAYLAND_DISPLAY && Bun.which("wl-copy") !== null) {
      return (text: string): boolean => spawnWithTextInput(["wl-copy"], text);
    }

    if (Bun.which("xclip") !== null) {
      return (text: string): boolean => spawnWithTextInput(["xclip", "-selection", "clipboard"], text);
    }

    if (Bun.which("xsel") !== null) {
      return (text: string): boolean => spawnWithTextInput(["xsel", "--clipboard", "--input"], text);
    }
  }

  if (process.platform === "win32") {
    return (text: string): boolean =>
      spawnWithTextInput(
        [
          "powershell.exe",
          "-NonInteractive",
          "-NoProfile",
          "-Command",
          "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ],
        text,
      );
  }

  return null;
}

function resolveNativeReadMethod(): NativeReadMethod | null {
  if (process.platform === "darwin") {
    if (Bun.which("pbpaste") !== null) {
      return (): string | undefined => spawnReadText(["pbpaste"]);
    }
  }

  if (process.platform === "linux") {
    if (process.env.WAYLAND_DISPLAY && Bun.which("wl-paste") !== null) {
      return (): string | undefined => spawnReadText(["wl-paste", "-n"]);
    }

    if (Bun.which("xclip") !== null) {
      return (): string | undefined => spawnReadText(["xclip", "-selection", "clipboard", "-o"]);
    }

    if (Bun.which("xsel") !== null) {
      return (): string | undefined => spawnReadText(["xsel", "--clipboard", "--output"]);
    }
  }

  if (process.platform === "win32") {
    return (): string | undefined =>
      spawnReadText([
        "powershell.exe",
        "-NonInteractive",
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw",
      ]);
  }

  return null;
}

/**
 * Create a {@link ClipboardAdapter}.
 */
export function createClipboardAdapter(): ClipboardAdapter {
  const nativeCopyMethod = resolveNativeCopyMethod();
  const nativeReadMethod = resolveNativeReadMethod();

  return {
    copy(text: string): boolean {
      const osc52Ok = writeOsc52(text);
      const nativeOk = nativeCopyMethod ? nativeCopyMethod(text) : false;
      return osc52Ok || nativeOk;
    },
    readText(): string | undefined {
      const text = nativeReadMethod ? nativeReadMethod() : undefined;
      if (text === undefined) return undefined;
      return text;
    },
  };
}
