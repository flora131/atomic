export function buildHiddenPhaseSummary(content: string): string | null {
  const trimmed = content.trim();
  const looksLikeTaskList =
    trimmed.includes('"status"') && trimmed.includes('"content"');
  const looksLikeReview = /review|finding|overall_correctness/i.test(trimmed);

  if (looksLikeTaskList) {
    return null;
  }

  if (looksLikeReview) {
    return "[Code Review] Review completed.";
  }

  return "[Workflow Phase] Completed.";
}
