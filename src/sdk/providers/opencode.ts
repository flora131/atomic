/**
 * OpenCode workflow source validation.
 *
 * Checks that OpenCode workflow source files follow required patterns:
 * - `baseUrl` is wired to the session context's `serverUrl`
 * - `tui.selectSession` is called after creating a session
 */

export interface OpenCodeValidationWarning {
  rule: string;
  message: string;
}

/**
 * Validate an OpenCode workflow source file for common mistakes.
 */
export function validateOpenCodeWorkflow(source: string): OpenCodeValidationWarning[] {
  const warnings: OpenCodeValidationWarning[] = [];

  if (/\bcreateOpencodeClient\b/.test(source)) {
    // Accept any identifier before .serverUrl (e.g., s.serverUrl, ctx.serverUrl)
    // or a destructured `serverUrl` variable
    if (!/baseUrl\s*:\s*(?:\w+\.serverUrl|serverUrl)/.test(source)) {
      warnings.push({
        rule: "opencode/base-url",
        message:
          "Could not verify that createOpencodeClient is called with { baseUrl: s.serverUrl }. " +
          "This is required to connect to the workflow's agent pane.",
      });
    }
  }

  if (/\bsession\.create\b/.test(source)) {
    if (!/\btui\.selectSession\b/.test(source)) {
      warnings.push({
        rule: "opencode/select-session",
        message:
          "Could not verify that tui.selectSession is called after session.create(). " +
          "Call client.tui.selectSession({ sessionID }) so the TUI displays the workflow session.",
      });
    }
  }

  return warnings;
}
