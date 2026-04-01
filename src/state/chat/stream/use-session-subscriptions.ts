import { useSessionLifecycleEvents } from "@/state/chat/stream/use-session-lifecycle-events.ts";
import { useSessionMessageEvents } from "@/state/chat/stream/use-session-message-events.ts";
import { useSessionMetadataEvents } from "@/state/chat/stream/use-session-metadata-events.ts";
import { useSessionHitlEvents } from "@/state/chat/stream/use-session-hitl-events.ts";
import type { UseStreamSubscriptionsArgs } from "@/state/chat/stream/subscription-types.ts";

/**
 * Thin façade composing the four session-event sub-hooks.
 *
 * Each sub-hook registers its own `useBusSubscription` calls:
 * - **Lifecycle**: session.start, turn.start/end, session.idle/partial-idle/error
 * - **Message**: session.info, warning, title_changed, truncation, compaction
 * - **Metadata**: stream.usage, stream.thinking.complete
 * - **HITL**: stream.permission.requested, human_input_required, skill.invoked
 */
export function useStreamSessionSubscriptions(
  args: Pick<
    UseStreamSubscriptionsArgs,
    | "activeBackgroundAgentCountRef"
    | "activeSkillSessionIdRef"
    | "activeStreamRunIdRef"
    | "appendSkillLoadIndicator"
    | "applyAutoCompactionIndicator"
    | "asSessionLoopFinishReason"
    | "batchDispatcher"
    | "handleAskUserQuestion"
    | "handlePermissionRequest"
    | "handleStreamComplete"
    | "handleStreamStartupError"
    | "hasRunningToolRef"
    | "isStreamingRef"
    | "lastStreamedMessageIdRef"
    | "lastTurnFinishReasonRef"
    | "loadedSkillsRef"
    | "nextRunIdFloorRef"
    | "parallelAgentsRef"
    | "resetLoadedSkillTracking"
    | "resolveAgentScopedMessageId"
    | "runningAskQuestionToolIdsRef"
    | "runningBlockingToolIdsRef"
    | "setActiveBackgroundAgentCount"
    | "setIsStreaming"
    | "setMessagesWindowed"
    | "setParallelAgents"
    | "setStreamingMeta"
    | "setHasRunningTool"
    | "streamingMessageIdRef"
    | "streamingMetaRef"
    | "streamingStartRef"
    | "toolMessageIdByIdRef"
    | "toolNameByIdRef"
  >,
): void {
  useSessionLifecycleEvents(args);
  useSessionMessageEvents(args);
  useSessionMetadataEvents(args);
  useSessionHitlEvents(args);
}
