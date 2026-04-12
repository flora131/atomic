/**
 * Copilot workflow source validation.
 *
 * Checks that Copilot workflow source files use the runtime-managed
 * `s.client` and `s.session` instead of manual SDK client creation.
 */

import { createProviderValidator } from "../types.ts";

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
