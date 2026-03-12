import type { UseStreamSubscriptionsArgs } from "@/state/chat/stream/subscription-types.ts";
import { useStreamAgentSubscriptions } from "@/state/chat/stream/use-agent-subscriptions.ts";
import { useStreamSessionSubscriptions } from "@/state/chat/stream/use-session-subscriptions.ts";

export function useStreamSubscriptions({
  ...args
}: UseStreamSubscriptionsArgs): void {
  useStreamSessionSubscriptions(args);
  useStreamAgentSubscriptions(args);
}
