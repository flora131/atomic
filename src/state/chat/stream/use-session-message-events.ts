import { useBusSubscription } from "@/services/events/hooks.ts";
import { STATUS, MISC } from "@/theme/icons.ts";
import {
  createMessage,
  formatSessionTruncationMessage,
  getAutoCompactionIndicatorState,
  shouldProcessStreamLifecycleEvent,
} from "@/state/chat/shared/helpers/index.ts";
import { isLikelyFilePath } from "@/services/events/session-info-filters.ts";
import type { UseStreamSubscriptionsArgs } from "@/state/chat/stream/subscription-types.ts";

export function useSessionMessageEvents({
  activeStreamRunIdRef,
  applyAutoCompactionIndicator,
  setMessagesWindowed,
}: Pick<
  UseStreamSubscriptionsArgs,
  | "activeStreamRunIdRef"
  | "applyAutoCompactionIndicator"
  | "setMessagesWindowed"
>): void {
  useBusSubscription("stream.session.info", (event) => {
    // Lifecycle guard — only process during active stream (defense-in-depth)
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) return;

    const { message, infoType } = event.data;
    if (infoType === "cancellation") return;
    if (infoType === "configuration") return;
    if (infoType === "snapshot") return;
    if (!message) return;
    if (isLikelyFilePath(message.trim())) return;
    setMessagesWindowed((prev) => [
      ...prev,
      createMessage("system", `${STATUS.active} ${message}`),
    ]);
  });

  useBusSubscription("stream.session.warning", (event) => {
    // Lifecycle guard — only process during active stream (defense-in-depth)
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) return;

    const { message } = event.data;
    if (message) {
      setMessagesWindowed((prev) => [
        ...prev,
        createMessage("system", `${MISC.warning} ${message}`),
      ]);
    }
  });

  useBusSubscription("stream.session.title_changed", (event) => {
    const { title } = event.data;
    if (title) {
      process.stdout.write(`\x1b]2;${title}\x07`);
    }
  });

  useBusSubscription("stream.session.truncation", (event) => {
    const { tokensRemoved, messagesRemoved } = event.data;
    setMessagesWindowed((prev) => [
      ...prev,
      createMessage(
        "system",
        formatSessionTruncationMessage(tokensRemoved, messagesRemoved),
      ),
    ]);
  });

  useBusSubscription("stream.session.compaction", (event) => {
    if (!shouldProcessStreamLifecycleEvent(activeStreamRunIdRef.current, event.runId)) {
      return;
    }

    const { phase, success, error } = event.data;
    applyAutoCompactionIndicator(
      getAutoCompactionIndicatorState(phase, success, error),
    );
  });
}
