/**
 * Validation helpers — refinement loop exit detection and critique parsing.
 */

/**
 * Signal phrases that indicate the user has approved the design and
 * wants to exit the refinement loop. Checked against the feedback
 * stage's extracted assistant text (which includes AskUserQuestion
 * responses and the agent's reaction).
 */
const COMPLETION_SIGNALS = [
  "approve and export",
  "approved",
  "looks good",
  "ship it",
  "done",
  "export",
  "user approved",
  "user selected.*approve",
  "user chose.*approve",
] as const;

/**
 * Detect whether the user signaled "done" via AskUserQuestion in the
 * feedback stage. The feedback stage's prompt instructs the agent to
 * include one of the completion signal phrases when the user approves.
 *
 * Returns `true` if the refinement loop should exit.
 */
export function isRefinementComplete(feedbackResult: string): boolean {
  const lower = feedbackResult.toLowerCase();
  return COMPLETION_SIGNALS.some((signal) => {
    if (signal.includes(".*")) {
      return new RegExp(signal, "i").test(lower);
    }
    return lower.includes(signal);
  });
}
