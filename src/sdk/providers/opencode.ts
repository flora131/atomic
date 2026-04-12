/**
 * OpenCode workflow source validation.
 *
 * Checks that OpenCode workflow source files use the runtime-managed
 * `s.client` and `s.session` instead of manual SDK client creation.
 */

import { createProviderValidator } from "../types.ts";

/**
 * Validate an OpenCode workflow source file for common mistakes.
 */
export const validateOpenCodeWorkflow = createProviderValidator([
  {
    pattern: /\bcreateOpencodeClient\b/,
    rule: "opencode/manual-client",
    message:
      "Manual createOpencodeClient() call detected. Use s.client instead — " +
      "the runtime auto-creates the client. Pass client config as the second arg to ctx.stage().",
  },
  {
    pattern: /\bclient\.session\.create\b/,
    rule: "opencode/manual-session",
    message:
      "Manual client.session.create() call detected. Use s.session instead — " +
      "the runtime auto-creates the session. Pass session config as the third arg to ctx.stage().",
  },
]);
