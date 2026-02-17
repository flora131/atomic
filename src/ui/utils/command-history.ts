import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const DEFAULT_MAX_HISTORY = 1000;
const FILE_MODE = 0o600;

/** Get the history file path: ~/.atomic/.command_history */
export function getCommandHistoryPath(): string {
  const home = process.env.ATOMIC_SETTINGS_HOME ?? homedir();
  return join(home, ".atomic", ".command_history");
}

/**
 * Encode a command string into the history file format.
 * - Escapes a trailing backslash as `\\` to prevent false continuation.
 * - Replaces internal newlines with backslash-continuation (`\` + newline).
 */
function encodeEntry(command: string): string {
  let encoded = command;
  // Escape trailing backslash to avoid false continuation on read
  if (encoded.endsWith("\\")) {
    encoded = encoded + "\\";
  }
  // Replace internal newlines with backslash continuation
  encoded = encoded.replace(/\n/g, "\\\n");
  return encoded + "\n";
}

/**
 * Parse a history file's content into an array of command strings.
 * Lines ending with `\` (but not `\\`) are joined via `\n` with the next line.
 * Trailing `\\` is unescaped back to `\`.
 */
function parseHistoryContent(content: string): string[] {
  const lines = content.split("\n");
  const entries: string[] = [];
  let current = "";
  let inContinuation = false;

  for (const line of lines) {
    if (inContinuation) {
      current += "\n";
    }

    if (line.endsWith("\\") && !line.endsWith("\\\\")) {
      // Single trailing backslash → continuation marker
      current += line.slice(0, -1);
      inContinuation = true;
    } else if (line.endsWith("\\\\")) {
      // Double trailing backslash → escaped literal backslash, not continuation
      current += line.slice(0, -2) + "\\";
      if (current) entries.push(current);
      current = "";
      inContinuation = false;
    } else {
      // No trailing backslash → complete entry
      current += line;
      if (current) entries.push(current);
      current = "";
      inContinuation = false;
    }
  }

  // Handle any remaining content from an unterminated continuation
  if (current) entries.push(current);

  return entries;
}

/** Load all command history entries from disk. Returns string[] (oldest first). */
export function loadCommandHistory(): string[] {
  try {
    const filePath = getCommandHistoryPath();
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf-8");
    if (!content.trim()) return [];

    const entries = parseHistoryContent(content);

    // Lazy truncation: if over limit, keep only the most recent entries and rewrite
    if (entries.length > DEFAULT_MAX_HISTORY) {
      const truncated = entries.slice(entries.length - DEFAULT_MAX_HISTORY);
      try {
        const encoded = truncated.map(encodeEntry).join("");
        writeFileSync(filePath, encoded, { encoding: "utf-8", mode: FILE_MODE });
      } catch {
        // Silent failure on truncation write
      }
      return truncated;
    }

    return entries;
  } catch {
    return [];
  }
}

/** Append a single command to the history file. Skips if empty. */
export function appendCommandHistory(command: string): void {
  if (!command.trim()) return;

  try {
    const filePath = getCommandHistoryPath();
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const encoded = encodeEntry(command);
    appendFileSync(filePath, encoded, { encoding: "utf-8", mode: FILE_MODE });
  } catch {
    // Silent failure
  }
}

/** Clear the history file (for testing). */
export function clearCommandHistory(): void {
  try {
    const filePath = getCommandHistoryPath();
    writeFileSync(filePath, "", { encoding: "utf-8", mode: FILE_MODE });
  } catch {
    // Silent failure
  }
}
