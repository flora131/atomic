/**
 * Cross-platform clipboard utilities for terminal applications
 *
 * Paste uses native system commands (pbpaste, xclip, wl-paste, powershell).
 * Copy is handled by the OpenTUI renderer's built-in OSC 52 support.
 */

import { spawn } from "child_process";

/**
 * Detect the current platform and return the paste command
 */
function getPasteCommand(): { cmd: string; args: string[] } | null {
  const platform = process.platform;

  if (platform === "darwin") {
    return { cmd: "pbpaste", args: [] };
  } else if (platform === "win32") {
    return { cmd: "powershell", args: ["-Command", "Get-Clipboard"] };
  } else {
    const isWayland = process.env["XDG_SESSION_TYPE"] === "wayland";
    if (isWayland) {
      return { cmd: "wl-paste", args: ["-n"] };
    }
    return { cmd: "xclip", args: ["-selection", "clipboard", "-o"] };
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
  const pasteCmd = getPasteCommand();

  if (!pasteCmd) {
    throw new Error("Clipboard not supported on this platform");
  }

  const { cmd, args } = pasteCmd;

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
