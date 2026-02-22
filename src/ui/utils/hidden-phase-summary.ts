export function buildHiddenPhaseSummary(content: string): string {
  const trimmed = content.trim();
  const looksLikeTaskList =
    trimmed.includes('"status"') && trimmed.includes('"content"');
  const looksLikeReview = /review|finding|overall_correctness/i.test(trimmed);

  if (looksLikeTaskList) {
    try {
      const match = trimmed.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return `[Task Decomposition] Decomposed into ${parsed.length} tasks.`;
        }
      }
    } catch {
      // Fall through to generic decomposition summary.
    }
    return "[Task Decomposition] Completed.";
  }

  if (looksLikeReview) {
    return "[Code Review] Review completed.";
  }

  return "[Workflow Phase] Completed.";
}
