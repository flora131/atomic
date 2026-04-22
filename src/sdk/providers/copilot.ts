/**
 * Copilot workflow source validation.
 *
 * Checks that Copilot workflow source files use the runtime-managed
 * `s.client` and `s.session` instead of manual SDK client creation.
 */

import { createProviderValidator } from "../types.ts";

/**
 * Env inherited by the Copilot CLI subprocess the SDK spawns.
 *
 * `NODE_NO_WARNINGS=1` silences the
 * `ExperimentalWarning: SQLite is an experimental feature` banner that
 * Node prints via the CLI's bundled `require("node:sqlite")`. The SDK
 * pipes the subprocess's stderr through `process.stderr` with a
 * `[CLI subprocess]` prefix, so without this override the warning
 * leaks into every `atomic chat -a copilot` and `atomic workflow -a
 * copilot` invocation.
 *
 * The SDK uses `options.env ?? process.env` as-is (no merge) when
 * spawning, so we must fold the existing env in ourselves. Returns a
 * fresh object per call so callers can layer additional env without
 * mutating shared state.
 */
export function copilotSubprocessEnv(): Record<string, string | undefined> {
  return { ...process.env, NODE_NO_WARNINGS: "1" };
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
