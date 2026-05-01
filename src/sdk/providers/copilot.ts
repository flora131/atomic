/**
 * Copilot workflow source validation + helpers.
 *
 * Checks that Copilot workflow source files use the runtime-managed
 * `s.client` and `s.session` instead of manual SDK client creation.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, join, sep } from "node:path";
import type { CopilotClientOptions, SessionConfig as CopilotSessionConfig } from "@github/copilot-sdk";
import { normalizedTerminalEnv } from "../../lib/terminal-env.ts";
import { getCommandPath } from "../../services/system/detect.ts";
import { createProviderValidator } from "../types.ts";

// ---------------------------------------------------------------------------
// Shim detection — internal, narrow filesystem errors per candidate
// ---------------------------------------------------------------------------

/** File extensions that identify a JavaScript loader/shim. */
const JS_EXT_RE = /\.(js|mjs|cjs)$/i;

/** Shebang pattern matching any Node.js invocation. */
const NODE_SHEBANG_RE = /^#!.*\bnode\b/;

/** Content marker present in the @github/copilot npm-loader shim. */
const NPM_LOADER_MARKER = "npm-loader.js";

/** Number of bytes read from candidate header for shebang / marker check. */
const HEADER_BYTES = 256;

/**
 * Read the first {@link HEADER_BYTES} of a file as a UTF-8 string.
 * Returns `null` on any filesystem error (file missing, not readable, etc.).
 */
function readCandidateHeader(filePath: string): string | null {
  try {
    const buf = readFileSync(filePath);
    return buf.subarray(0, HEADER_BYTES).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Resolve symlink chain to final target path.
 * Returns the original path on any filesystem error.
 */
function safeRealpath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * Return `true` when `candidate` is a Node.js / npm-loader JavaScript shim
 * that should not be passed to the Copilot SDK as the CLI executable.
 *
 * Shim criteria (any one is sufficient):
 *  1. File extension is `.js`, `.mjs`, or `.cjs`.
 *  2. Candidate lives in `node_modules/.bin` and its realpath target has a
 *     JS extension (covers `@github/copilot` npm-loader symlink).
 *  3. First {@link HEADER_BYTES} bytes contain a `node` shebang.
 *  4. First {@link HEADER_BYTES} bytes reference `npm-loader.js`.
 *
 * Filesystem errors for a given candidate are treated as "not a shim" so
 * that the SDK can surface the real error (e.g. permission denied, ENOENT).
 *
 * Exported for unit testing.
 */
export function isCopilotShim(candidate: string): boolean {
  // 1. JS extension check — no I/O required.
  if (JS_EXT_RE.test(candidate)) return true;

  // 2. node_modules/.bin symlink: resolve and re-check extension.
  if (candidate.includes(`node_modules${sep}.bin`) || candidate.includes("node_modules/.bin")) {
    const real = safeRealpath(candidate);
    if (JS_EXT_RE.test(real)) return true;
  }

  // 3 & 4. Read small header for shebang and npm-loader marker.
  const header = readCandidateHeader(candidate);
  if (header === null) {
    // Filesystem error — assume valid; let SDK handle executable errors.
    return false;
  }

  if (NODE_SHEBANG_RE.test(header)) return true;
  if (header.includes(NPM_LOADER_MARKER)) return true;

  return false;
}

/**
 * Build the subprocess environment for the Copilot CLI process.
 * Normalises locale to UTF-8 and suppresses Node.js deprecation warnings.
 */
export function copilotSubprocessEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  return { ...normalizedTerminalEnv(baseEnv), NODE_NO_WARNINGS: "1" };
}

/**
 * Resolve the absolute path to the Copilot CLI executable.
 *
 * Precedence:
 * 1. `COPILOT_CLI_PATH` env var — returned verbatim when non-empty.
 * 2. PATH resolution — enumerates candidates via {@link getCommandPath};
 *    each candidate is checked for Node.js / npm-loader shims.
 *    The first non-shim candidate is returned.
 * 3. `undefined` — no valid candidate found (only shims or nothing on PATH);
 *    let the SDK fall back to its bundled CLI.
 *
 * Shim detection covers: JS file extensions, `node` shebangs, `npm-loader.js`
 * content markers, and `node_modules/.bin` symlinks whose realpath target is
 * a JS file (e.g. the `@github/copilot` npm package loader).
 *
 * Does NOT validate by spawning; SDK start surfaces executable errors.
 */
/**
 * Enumerate every occurrence of `cmd` across all directories in `pathEnv`.
 * Returns ordered list of absolute paths that exist on the filesystem.
 * Exported for unit testing.
 */
export function enumeratePathCandidates(cmd: string, pathEnv: string): string[] {
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const results: string[] = [];
  for (const dir of dirs) {
    const full = join(dir, cmd);
    if (existsSync(full)) results.push(full);
  }
  return results;
}

export function resolveCopilotCliPath(): string | undefined {
  // 1. Explicit env var — trusted verbatim, no shim check.
  const envPath = process.env["COPILOT_CLI_PATH"];
  if (envPath) return envPath;

  // 2. Use getCommandPath as primary lookup (testable/mockable via detect.ts).
  //    If the first candidate is not a shim, return it immediately.
  const primary = getCommandPath("copilot");
  if (primary === null) return undefined;
  if (!isCopilotShim(primary)) return primary;

  // 3. Primary is a shim — enumerate all PATH dirs to find a non-shim candidate.
  const pathEnv = process.env["PATH"] ?? "";
  const candidates = enumeratePathCandidates("copilot", pathEnv);
  for (const candidate of candidates) {
    if (!isCopilotShim(candidate)) return candidate;
  }

  // 4. No valid standalone binary found.
  return undefined;
}

/**
 * Build options suitable for `new CopilotClient(...)`.
 *
 * Includes:
 * - `env` from {@link copilotSubprocessEnv} (UTF-8 locale + `NODE_NO_WARNINGS=1`).
 * - `cliPath` from {@link resolveCopilotCliPath} when resolvable; omitted
 *   otherwise so the SDK falls back to its bundled CLI.
 */
export function copilotSdkLaunchOptions(): CopilotClientOptions {
  const options: CopilotClientOptions = {
    env: copilotSubprocessEnv(),
  };
  const cliPath = resolveCopilotCliPath();
  if (cliPath !== undefined) {
    options.cliPath = cliPath;
  }
  return options;
}

/**
 * Fold the atomic-managed additional instructions into a caller's
 * `systemMessage` value on `client.createSession`. Behavior:
 *
 *   - **No caller value** → `{ mode: "append", content: extra }`. The
 *     SDK's default mode is append and preserves the SDK persona.
 *   - **Append/customize mode** → concatenate our content to the existing
 *     `content` field (newline-separated when both are present).
 *   - **Replace mode** → leave alone. The caller has explicitly opted out
 *     of SDK-managed sections; silently re-adding the persona-style append
 *     would violate that contract.
 *
 * Exported for unit testing.
 */
export function mergeCopilotSystemMessage(
  existing: CopilotSessionConfig["systemMessage"],
  extra: string,
): CopilotSessionConfig["systemMessage"] {
  if (!extra) return existing;
  if (existing === undefined) {
    return { mode: "append", content: extra };
  }
  if (existing.mode === "replace") return existing;
  const prev = existing.content ?? "";
  const merged = prev ? `${prev}\n\n${extra}` : extra;
  return { ...existing, content: merged };
}

/**
 * Validate a Copilot workflow source file for common mistakes.
 */
export const validateCopilotWorkflow = createProviderValidator([
  {
    pattern: /\bnew\s+CopilotClient\b/,
    rule: "copilot/manual-client",
    message:
      "Manual CopilotClient creation detected. Use s.client instead — " +
      "the runtime auto-creates and cleans up the client.",
  },
  {
    pattern: /\bclient\.createSession\b/,
    rule: "copilot/manual-session",
    message:
      "Manual createSession() call detected. Use s.session instead — " +
      "the runtime auto-creates the session. Pass session config as the third arg to ctx.stage().",
  },
]);
