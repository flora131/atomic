import { MISC } from "@/theme/icons.ts";
import type { AutoCompactionIndicatorState } from "@/state/chat/shared/helpers/auto-compaction-lifecycle.ts";

export function formatSessionTruncationMessage(
  tokensRemoved: number,
  messagesRemoved: number,
): string {
  return `${MISC.warning} Context truncated: ${tokensRemoved.toLocaleString()} tokens removed (${messagesRemoved} message${messagesRemoved === 1 ? "" : "s"})`;
}

export function getAutoCompactionIndicatorState(
  phase: "start" | "complete",
  success?: boolean,
  error?: string,
): AutoCompactionIndicatorState {
  if (phase === "start") {
    return { status: "running" };
  }

  if (success === false) {
    return { status: "error", errorMessage: error?.trim() || undefined };
  }

  return { status: "completed" };
}
