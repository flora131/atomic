/**
 * Copilot workflow source validation.
 *
 * Checks that Copilot workflow source files follow required patterns:
 * - `cliUrl` is wired to `ctx.serverUrl` (or destructured `serverUrl`)
 * - `setForegroundSessionId` is called after creating a session
 */

export interface CopilotValidationWarning {
  rule: string;
  message: string;
}

/**
 * Validate a Copilot workflow source file for common mistakes.
 */
export function validateCopilotWorkflow(source: string): CopilotValidationWarning[] {
  const warnings: CopilotValidationWarning[] = [];

  if (/\bCopilotClient\b/.test(source)) {
    if (!/cliUrl\s*:\s*(?:ctx\.serverUrl|serverUrl)/.test(source)) {
      warnings.push({
        rule: "copilot/cli-url",
        message:
          "Could not verify that CopilotClient is created with { cliUrl: ctx.serverUrl }. " +
          "This is required to connect to the workflow's agent pane.",
      });
    }
  }

  if (/\bcreateSession\b/.test(source)) {
    if (!/\bsetForegroundSessionId\b/.test(source)) {
      warnings.push({
        rule: "copilot/foreground-session",
        message:
          "Could not verify that setForegroundSessionId is called after createSession(). " +
          "Call client.setForegroundSessionId(session.sessionId) so the TUI displays the workflow session.",
      });
    }
  }

  return warnings;
}
