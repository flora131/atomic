/**
 * Cross-platform clipboard utilities for terminal applications
 *
 * Provides copy and paste functionality using native system commands
 * with OSC 52 terminal escape sequence fallback for SSH/headless sessions.
 * Supports macOS (pbcopy/pbpaste), Linux (xclip/xsel), and Windows (powershell).
 */

import { spawn } from "child_process";

/**
 * Copy text to clipboard using OSC 52 terminal escape sequence.
 * Works over SSH and in headless environments because the user's
 * local terminal emulator handles the clipboard operation.
 */
function copyViaOSC52(text: string): void {
  const encoded = Buffer.from(text).toString("base64");
  // OSC 52 ; c ; <base64> ST — sets the clipboard selection
  process.stdout.write(`\x1b]52;c;${encoded}\x07`);
}

/**
 * Detect the current platform and return clipboard commands
 */
function getClipboardCommands(): {
  copy: { cmd: string; args: string[] } | null;
  paste: { cmd: string; args: string[] } | null;
} {
  const platform = process.platform;

  if (platform === "darwin") {
    // macOS
    return {
      copy: { cmd: "pbcopy", args: [] },
      paste: { cmd: "pbpaste", args: [] },
    };
  } else if (platform === "win32") {
    // Windows - use PowerShell
    return {
      copy: {
        cmd: "powershell",
        args: ["-Command", "Set-Clipboard -Value $input"],
      },
      paste: { cmd: "powershell", args: ["-Command", "Get-Clipboard"] },
    };
  } else {
    // Linux/Unix - try xclip first, fall back to xsel
    // Check for Wayland
    const isWayland = process.env["XDG_SESSION_TYPE"] === "wayland";

    if (isWayland) {
      return {
        copy: { cmd: "wl-copy", args: [] },
        paste: { cmd: "wl-paste", args: ["-n"] },
      };
    }

    // X11 - prefer xclip
    return {
      copy: { cmd: "xclip", args: ["-selection", "clipboard"] },
      paste: { cmd: "xclip", args: ["-selection", "clipboard", "-o"] },
    };
  }
}

/**
 * Copy text to the system clipboard
 *
 * @param text - The text to copy to clipboard
 * @returns Promise that resolves when copy is complete, or rejects on error
 *
 * @example
 * ```typescript
 * await copyToClipboard("Hello, world!");
 * ```
 */
export async function copyToClipboard(text: string): Promise<void> {
  const commands = getClipboardCommands();

  if (!commands.copy) {
    // No system clipboard command available — use OSC 52 fallback
    copyViaOSC52(text);
    return;
  }

  const { cmd, args } = commands.copy;

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(cmd, args, {
        stdio: ["pipe", "ignore", "pipe"],
      });

      let stderr = "";

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Failed to copy to clipboard: ${stderr || `exit code ${code}`}`
            )
          );
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to copy to clipboard: ${err.message}`));
      });

      // Write text to stdin and close
      proc.stdin?.write(text);
      proc.stdin?.end();
    });
  } catch {
    // System clipboard failed (e.g., no display, SSH session) — use OSC 52 fallback
    copyViaOSC52(text);
  }
}

/**
 * Read text from the system clipboard
 *
 * @returns Promise that resolves with clipboard contents
 *
 * @example
 * ```typescript
 * const text = await pasteFromClipboard();
 * console.log("Clipboard:", text);
 * ```
 */
export async function pasteFromClipboard(): Promise<string> {
  const commands = getClipboardCommands();

  if (!commands.paste) {
    throw new Error("Clipboard not supported on this platform");
  }

  const { cmd, args } = commands.paste;

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `Failed to paste from clipboard: ${stderr || `exit code ${code}`}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to paste from clipboard: ${err.message}`));
    });
  });
}

/**
 * Check if clipboard operations are available on this platform
 *
 * @returns true if clipboard is supported
 */
export function isClipboardAvailable(): boolean {
  const commands = getClipboardCommands();
  return commands.copy !== null && commands.paste !== null;
}
