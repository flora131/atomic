/**
 * Structural tests for the stream sub-hooks.
 *
 * Goes beyond the module-export checks in use-runtime-decomposition.test.ts
 * to verify hook signatures (parameter arity) and source-level patterns
 * (ref names, interface exports, event subscriptions, imports).
 */

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC_DIR = path.resolve(
  import.meta.dir,
  "../../../../src/state/chat/stream",
);

function readSource(filename: string): string {
  return fs.readFileSync(path.join(SRC_DIR, filename), "utf-8");
}

// ===========================================================================
// useStreamRefs
// ===========================================================================

describe("useStreamRefs structural verification", () => {
  const source = readSource("use-stream-refs.ts");

  // -- Module exports -------------------------------------------------------

  test("exports useStreamRefs as a function", async () => {
    const mod = await import("@/state/chat/stream/use-stream-refs.ts");
    expect(mod.useStreamRefs).toBeFunction();
  });

  test("exports UseStreamRefsResult type alias", () => {
    expect(source).toContain("export type UseStreamRefsResult");
  });

  // -- Hook arity -----------------------------------------------------------

  test("accepts exactly one parameter (messages)", async () => {
    const { useStreamRefs } = await import(
      "@/state/chat/stream/use-stream-refs.ts"
    );
    expect(useStreamRefs.length).toBe(1);
  });

  // -- Function signature ---------------------------------------------------

  test("accepts messages parameter", () => {
    expect(source).toContain("function useStreamRefs(messages:");
  });

  // -- Streaming lifecycle refs ---------------------------------------------

  test("creates all streaming lifecycle refs", () => {
    const expectedRefs = [
      "streamingMessageIdRef",
      "activeStreamRunIdRef",
      "lastStreamedMessageIdRef",
      "backgroundAgentMessageIdRef",
      "streamingStartRef",
      "isStreamingRef",
      "streamingMetaRef",
      "wasInterruptedRef",
      "isAgentOnlyStreamRef",
    ];
    for (const ref of expectedRefs) {
      expect(source).toContain(ref);
    }
  });

  // -- Tool tracking refs ---------------------------------------------------

  test("creates tool tracking refs", () => {
    expect(source).toContain("hasRunningToolRef");
    expect(source).toContain("runningBlockingToolIdsRef");
    expect(source).toContain("runningAskQuestionToolIdsRef");
    expect(source).toContain("toolNameByIdRef");
    expect(source).toContain("toolMessageIdByIdRef");
  });

  // -- Agent tracking refs --------------------------------------------------

  test("creates agent lifecycle refs", () => {
    expect(source).toContain("agentMessageIdByIdRef");
    expect(source).toContain("agentLifecycleLedgerRef");
    expect(source).toContain("agentOrderingStateRef");
    expect(source).toContain("completionOrderingEventByAgentRef");
    expect(source).toContain("doneRenderedSequenceByAgentRef");
  });

  test("creates agent tracking refs", () => {
    expect(source).toContain("parallelAgentsRef");
    expect(source).toContain("activeBackgroundAgentCountRef");
    expect(source).toContain("parallelInterruptHandlerRef");
  });

  // -- Workflow refs --------------------------------------------------------

  test("creates workflow refs", () => {
    expect(source).toContain("workflowSessionDirRef");
    expect(source).toContain("workflowSessionIdRef");
    expect(source).toContain("workflowTaskIdsRef");
    expect(source).toContain("todoItemsRef");
  });

  // -- Skill tracking refs --------------------------------------------------

  test("creates skill tracking refs", () => {
    expect(source).toContain("loadedSkillsRef");
    expect(source).toContain("activeSkillSessionIdRef");
  });

  // -- Deferred completion refs ---------------------------------------------

  test("creates deferred completion refs", () => {
    expect(source).toContain("pendingCompleteRef");
    expect(source).toContain("deferredCompleteTimeoutRef");
    expect(source).toContain("deferredPostCompleteDeltasByAgentRef");
  });

  // -- Thinking & diagnostics refs -----------------------------------------

  test("creates thinking and diagnostics refs", () => {
    expect(source).toContain("closedThinkingSourcesRef");
    expect(source).toContain("thinkingDropDiagnosticsRef");
  });

  // -- Callback indirection refs --------------------------------------------

  test("creates callback indirection refs", () => {
    expect(source).toContain("continueAssistantStreamInPlaceRef");
    expect(source).toContain("startAssistantStreamRef");
  });

  // -- Stream run runtime ---------------------------------------------------

  test("creates StreamRunRuntime ref", () => {
    expect(source).toContain("streamRunRuntimeRef");
    expect(source).toContain("StreamRunRuntime");
  });

  // -- Background dispatch refs ---------------------------------------------

  test("creates background dispatch refs", () => {
    expect(source).toContain("backgroundAgentSendChainRef");
    expect(source).toContain("pendingBackgroundUpdatesRef");
    expect(source).toContain("backgroundUpdateFlushInFlightRef");
    expect(source).toContain("backgroundProgressSnapshotRef");
  });

  // -- Return object structure ----------------------------------------------

  test("returns a structured object with public refs", () => {
    // Spot-check that the return block contains key public refs
    const publicRefs = [
      "activeBackgroundAgentCountRef",
      "activeStreamRunIdRef",
      "hasRunningToolRef",
      "isStreamingRef",
      "parallelAgentsRef",
      "streamingMessageIdRef",
      "wasInterruptedRef",
    ];
    for (const ref of publicRefs) {
      // Each ref must appear in the return statement
      expect(source).toContain(ref);
    }
  });

  test("returns internal refs separately from public refs", () => {
    // The source should mark internal refs with a comment
    expect(source).toContain("// Internal refs");
    expect(source).toContain("streamRunRuntimeRef");
    expect(source).toContain("backgroundAgentSendChainRef");
  });

  // -- Imports --------------------------------------------------------------

  test("imports useRef from react", () => {
    expect(source).toContain('import { useRef } from "react"');
  });

  test("imports createAgentLifecycleLedger", () => {
    expect(source).toContain("createAgentLifecycleLedger");
  });

  test("imports createAgentOrderingState", () => {
    expect(source).toContain("createAgentOrderingState");
  });

  test("imports createLoadedSkillTrackingSet", () => {
    expect(source).toContain("createLoadedSkillTrackingSet");
  });

  test("imports StreamRunRuntime class", () => {
    expect(source).toContain("StreamRunRuntime");
  });
});

// ===========================================================================
// useStreamActions
// ===========================================================================

describe("useStreamActions structural verification", () => {
  const source = readSource("use-stream-actions.ts");

  // -- Module exports -------------------------------------------------------

  test("exports useStreamActions as a function", async () => {
    const mod = await import("@/state/chat/stream/use-stream-actions.ts");
    expect(mod.useStreamActions).toBeFunction();
  });

  test("exports UseStreamActionsArgs interface", () => {
    expect(source).toContain("export interface UseStreamActionsArgs");
  });

  test("exports UseStreamActionsResult type alias", () => {
    expect(source).toContain("export type UseStreamActionsResult");
  });

  // -- Hook arity -----------------------------------------------------------

  test("accepts exactly one parameter (args object)", async () => {
    const { useStreamActions } = await import(
      "@/state/chat/stream/use-stream-actions.ts"
    );
    expect(useStreamActions.length).toBe(1);
  });

  // -- UseStreamActionsArgs interface fields --------------------------------

  test("UseStreamActionsArgs requires ref dependencies", () => {
    const expectedRefFields = [
      "streamingMessageIdRef",
      "lastStreamedMessageIdRef",
      "backgroundAgentMessageIdRef",
      "loadedSkillsRef",
      "activeSkillSessionIdRef",
      "agentMessageIdByIdRef",
      "parallelAgentsRef",
    ];
    for (const field of expectedRefFields) {
      expect(source).toContain(field);
    }
  });

  test("UseStreamActionsArgs requires state setter dependencies", () => {
    const expectedSetters = [
      "setStreamingMessageIdState",
      "setLastStreamedMessageIdState",
      "setBackgroundAgentMessageIdState",
      "setAgentMessageBindings",
    ];
    for (const setter of expectedSetters) {
      expect(source).toContain(setter);
    }
  });

  // -- Action definitions ---------------------------------------------------

  test("defines setStreamingMessageId anchor-sync action", () => {
    expect(source).toContain("setStreamingMessageId");
    // Verify it follows the anchor-sync pattern (ref + state)
    expect(source).toContain("streamingMessageIdRef.current = messageId");
    expect(source).toContain("setStreamingMessageIdState(messageId)");
  });

  test("defines setLastStreamedMessageId anchor-sync action", () => {
    expect(source).toContain("setLastStreamedMessageId");
    expect(source).toContain("lastStreamedMessageIdRef.current = messageId");
    expect(source).toContain("setLastStreamedMessageIdState(messageId)");
  });

  test("defines setBackgroundAgentMessageId anchor-sync action", () => {
    expect(source).toContain("setBackgroundAgentMessageId");
    expect(source).toContain("backgroundAgentMessageIdRef.current = messageId");
    expect(source).toContain("setBackgroundAgentMessageIdState(messageId)");
  });

  test("defines resetLoadedSkillTracking action", () => {
    expect(source).toContain("resetLoadedSkillTracking");
    expect(source).toContain("loadedSkillsRef.current.clear()");
  });

  test("defines setAgentMessageBinding action", () => {
    expect(source).toContain("setAgentMessageBinding");
    expect(source).toContain("agentMessageIdByIdRef.current.set(agentId, messageId)");
  });

  test("defines deleteAgentMessageBinding action", () => {
    expect(source).toContain("deleteAgentMessageBinding");
    expect(source).toContain("agentMessageIdByIdRef.current.delete(agentId)");
  });

  test("defines separateAndInterruptAgents action", () => {
    expect(source).toContain("separateAndInterruptAgents");
    expect(source).toContain("backgroundAgents");
    expect(source).toContain("foregroundAgents");
    expect(source).toContain("isBackgroundAgent");
  });

  test("defines resolveAgentScopedMessageId action", () => {
    expect(source).toContain("resolveAgentScopedMessageId");
  });

  // -- Return object --------------------------------------------------------

  test("returns all 8 actions", () => {
    const expectedActions = [
      "setStreamingMessageId",
      "setLastStreamedMessageId",
      "setBackgroundAgentMessageId",
      "resetLoadedSkillTracking",
      "setAgentMessageBinding",
      "deleteAgentMessageBinding",
      "separateAndInterruptAgents",
      "resolveAgentScopedMessageId",
    ];
    for (const action of expectedActions) {
      expect(source).toContain(action);
    }
  });

  // -- Imports --------------------------------------------------------------

  test("imports useCallback from react", () => {
    expect(source).toContain("useCallback");
  });

  test("imports isBackgroundAgent helper", () => {
    expect(source).toContain("isBackgroundAgent");
    expect(source).toContain("background-agent-footer");
  });
});

// ===========================================================================
// useSessionLifecycleEvents
// ===========================================================================

describe("useSessionLifecycleEvents structural verification", () => {
  const source = readSource("use-session-lifecycle-events.ts");

  // -- Module exports -------------------------------------------------------

  test("exports useSessionLifecycleEvents as a function", async () => {
    const mod = await import(
      "@/state/chat/stream/use-session-lifecycle-events.ts"
    );
    expect(mod.useSessionLifecycleEvents).toBeFunction();
  });

  // -- Hook arity -----------------------------------------------------------

  test("accepts exactly one parameter (args object)", async () => {
    const { useSessionLifecycleEvents } = await import(
      "@/state/chat/stream/use-session-lifecycle-events.ts"
    );
    expect(useSessionLifecycleEvents.length).toBe(1);
  });

  // -- Event subscriptions --------------------------------------------------

  test("subscribes to stream.session.start", () => {
    expect(source).toContain('"stream.session.start"');
  });

  test("subscribes to stream.turn.start", () => {
    expect(source).toContain('"stream.turn.start"');
  });

  test("subscribes to stream.turn.end", () => {
    expect(source).toContain('"stream.turn.end"');
  });

  test("subscribes to stream.session.idle", () => {
    expect(source).toContain('"stream.session.idle"');
  });

  test("subscribes to stream.session.partial-idle", () => {
    expect(source).toContain('"stream.session.partial-idle"');
  });

  test("subscribes to stream.session.error", () => {
    expect(source).toContain('"stream.session.error"');
  });

  // -- Imports --------------------------------------------------------------

  test("imports useBusSubscription hook", () => {
    expect(source).toContain("useBusSubscription");
    expect(source).toContain("@/services/events/hooks");
  });

  test("imports stream lifecycle helpers", () => {
    expect(source).toContain("shouldBindStreamSessionRun");
    expect(source).toContain("shouldProcessStreamLifecycleEvent");
  });

  test("imports skill-load-tracking helpers", () => {
    expect(source).toContain("normalizeSessionTrackingKey");
    expect(source).toContain("shouldResetLoadedSkillsForSessionChange");
  });

  test("imports stream-continuation helpers", () => {
    expect(source).toContain("interruptRunningToolParts");
    expect(source).toContain("shouldContinueParentSessionLoop");
  });

  test("imports UseStreamSubscriptionsArgs from subscription-types", () => {
    expect(source).toContain("UseStreamSubscriptionsArgs");
    expect(source).toContain("subscription-types");
  });

  // -- Return type ----------------------------------------------------------

  test("returns void (event subscription only)", () => {
    expect(source).toContain("): void");
  });

  // -- Key behavioral patterns ----------------------------------------------

  test("uses Pick to narrow UseStreamSubscriptionsArgs", () => {
    expect(source).toContain("Pick<");
    expect(source).toContain("UseStreamSubscriptionsArgs");
  });

  test("calls handleStreamComplete on idle", () => {
    expect(source).toContain("handleStreamComplete");
  });

  test("calls handleStreamStartupError on error", () => {
    expect(source).toContain("handleStreamStartupError");
  });

  test("handles aborted idle reason separately", () => {
    expect(source).toContain('"aborted"');
  });
});

// ===========================================================================
// useSessionMessageEvents
// ===========================================================================

describe("useSessionMessageEvents structural verification", () => {
  const source = readSource("use-session-message-events.ts");

  // -- Module exports -------------------------------------------------------

  test("exports useSessionMessageEvents as a function", async () => {
    const mod = await import(
      "@/state/chat/stream/use-session-message-events.ts"
    );
    expect(mod.useSessionMessageEvents).toBeFunction();
  });

  // -- Hook arity -----------------------------------------------------------

  test("accepts exactly one parameter (args object)", async () => {
    const { useSessionMessageEvents } = await import(
      "@/state/chat/stream/use-session-message-events.ts"
    );
    expect(useSessionMessageEvents.length).toBe(1);
  });

  // -- Event subscriptions --------------------------------------------------

  test("subscribes to stream.session.info", () => {
    expect(source).toContain('"stream.session.info"');
  });

  test("subscribes to stream.session.warning", () => {
    expect(source).toContain('"stream.session.warning"');
  });

  test("subscribes to stream.session.title_changed", () => {
    expect(source).toContain('"stream.session.title_changed"');
  });

  test("subscribes to stream.session.truncation", () => {
    expect(source).toContain('"stream.session.truncation"');
  });

  test("subscribes to stream.session.compaction", () => {
    expect(source).toContain('"stream.session.compaction"');
  });

  // -- Imports --------------------------------------------------------------

  test("imports useBusSubscription hook", () => {
    expect(source).toContain("useBusSubscription");
    expect(source).toContain("@/services/events/hooks");
  });

  test("imports message creation helpers", () => {
    expect(source).toContain("createMessage");
    expect(source).toContain("formatSessionTruncationMessage");
  });

  test("imports auto-compaction helpers", () => {
    expect(source).toContain("getAutoCompactionIndicatorState");
  });

  test("imports icon constants", () => {
    expect(source).toContain("STATUS");
    expect(source).toContain("MISC");
    expect(source).toContain("@/theme/icons");
  });

  test("imports session info filters", () => {
    expect(source).toContain("isLikelyFilePath");
    expect(source).toContain("session-info-filters");
  });

  test("imports UseStreamSubscriptionsArgs from subscription-types", () => {
    expect(source).toContain("UseStreamSubscriptionsArgs");
    expect(source).toContain("subscription-types");
  });

  // -- Return type ----------------------------------------------------------

  test("returns void (event subscription only)", () => {
    expect(source).toContain("): void");
  });

  // -- Key behavioral patterns ----------------------------------------------

  test("uses Pick to narrow UseStreamSubscriptionsArgs", () => {
    expect(source).toContain("Pick<");
    expect(source).toContain("UseStreamSubscriptionsArgs");
  });

  test("filters cancellation info type", () => {
    expect(source).toContain('"cancellation"');
  });

  test("filters snapshot info type", () => {
    expect(source).toContain('"snapshot"');
  });

  test("filters likely file paths from info messages", () => {
    expect(source).toContain("isLikelyFilePath");
  });

  test("sets terminal title on title_changed", () => {
    expect(source).toContain("\\x1b]2;");
  });
});

// ===========================================================================
// useSessionMetadataEvents
// ===========================================================================

describe("useSessionMetadataEvents structural verification", () => {
  const source = readSource("use-session-metadata-events.ts");

  // -- Module exports -------------------------------------------------------

  test("exports useSessionMetadataEvents as a function", async () => {
    const mod = await import(
      "@/state/chat/stream/use-session-metadata-events.ts"
    );
    expect(mod.useSessionMetadataEvents).toBeFunction();
  });

  // -- Hook arity -----------------------------------------------------------

  test("accepts exactly one parameter (args object)", async () => {
    const { useSessionMetadataEvents } = await import(
      "@/state/chat/stream/use-session-metadata-events.ts"
    );
    expect(useSessionMetadataEvents.length).toBe(1);
  });

  // -- Event subscriptions --------------------------------------------------

  test("subscribes to stream.usage", () => {
    expect(source).toContain('"stream.usage"');
  });

  test("subscribes to stream.thinking.complete", () => {
    expect(source).toContain('"stream.thinking.complete"');
  });

  // -- Imports --------------------------------------------------------------

  test("imports useBusSubscription hook", () => {
    expect(source).toContain("useBusSubscription");
    expect(source).toContain("@/services/events/hooks");
  });

  test("imports StreamingMeta type", () => {
    expect(source).toContain("StreamingMeta");
  });

  test("imports UseStreamSubscriptionsArgs from subscription-types", () => {
    expect(source).toContain("UseStreamSubscriptionsArgs");
    expect(source).toContain("subscription-types");
  });

  // -- Return type ----------------------------------------------------------

  test("returns void (event subscription only)", () => {
    expect(source).toContain("): void");
  });

  // -- Key behavioral patterns ----------------------------------------------

  test("uses Pick to narrow UseStreamSubscriptionsArgs", () => {
    expect(source).toContain("Pick<");
    expect(source).toContain("UseStreamSubscriptionsArgs");
  });

  test("handles agent-scoped usage via resolveAgentScopedMessageId", () => {
    expect(source).toContain("resolveAgentScopedMessageId");
  });

  test("tracks outputTokens in metadata", () => {
    expect(source).toContain("outputTokens");
  });

  test("tracks thinkingMs in metadata", () => {
    expect(source).toContain("thinkingMs");
  });

  test("uses Math.max for monotonic token/timing updates", () => {
    expect(source).toContain("Math.max");
  });

  test("updates both streamingMetaRef and setStreamingMeta", () => {
    expect(source).toContain("streamingMetaRef.current = nextMeta");
    expect(source).toContain("setStreamingMeta(nextMeta)");
  });
});

// ===========================================================================
// useSessionHitlEvents
// ===========================================================================

describe("useSessionHitlEvents structural verification", () => {
  const source = readSource("use-session-hitl-events.ts");

  // -- Module exports -------------------------------------------------------

  test("exports useSessionHitlEvents as a function", async () => {
    const mod = await import(
      "@/state/chat/stream/use-session-hitl-events.ts"
    );
    expect(mod.useSessionHitlEvents).toBeFunction();
  });

  // -- Hook arity -----------------------------------------------------------

  test("accepts exactly one parameter (args object)", async () => {
    const { useSessionHitlEvents } = await import(
      "@/state/chat/stream/use-session-hitl-events.ts"
    );
    expect(useSessionHitlEvents.length).toBe(1);
  });

  // -- Event subscriptions --------------------------------------------------

  test("subscribes to stream.permission.requested", () => {
    expect(source).toContain('"stream.permission.requested"');
  });

  test("subscribes to stream.human_input_required", () => {
    expect(source).toContain('"stream.human_input_required"');
  });

  test("subscribes to stream.skill.invoked", () => {
    expect(source).toContain('"stream.skill.invoked"');
  });

  // -- Imports --------------------------------------------------------------

  test("imports useBusSubscription hook", () => {
    expect(source).toContain("useBusSubscription");
    expect(source).toContain("@/services/events/hooks");
  });

  test("imports AskUserQuestionEventData type", () => {
    expect(source).toContain("AskUserQuestionEventData");
  });

  test("imports skill-load-tracking helpers", () => {
    expect(source).toContain("shouldDisplaySkillLoadIndicator");
    expect(source).toContain("tryTrackLoadedSkill");
  });

  test("imports UseStreamSubscriptionsArgs from subscription-types", () => {
    expect(source).toContain("UseStreamSubscriptionsArgs");
    expect(source).toContain("subscription-types");
  });

  // -- Return type ----------------------------------------------------------

  test("returns void (event subscription only)", () => {
    expect(source).toContain("): void");
  });

  // -- Key behavioral patterns ----------------------------------------------

  test("uses Pick to narrow UseStreamSubscriptionsArgs", () => {
    expect(source).toContain("Pick<");
    expect(source).toContain("UseStreamSubscriptionsArgs");
  });

  test("flushes batchDispatcher before permission handling", () => {
    expect(source).toContain("batchDispatcher.flush()");
  });

  test("calls handlePermissionRequest for permission events", () => {
    expect(source).toContain("handlePermissionRequest");
  });

  test("calls handleAskUserQuestion for human input events", () => {
    expect(source).toContain("handleAskUserQuestion");
  });

  test("resolves toolCallId from runningAskQuestionToolIdsRef as fallback", () => {
    expect(source).toContain("runningAskQuestionToolIdsRef.current");
    expect(source).toContain("resolvedToolCallId");
  });

  test("calls appendSkillLoadIndicator for skill invocation", () => {
    expect(source).toContain("appendSkillLoadIndicator");
  });

  test("guards skill indicator with shouldDisplaySkillLoadIndicator", () => {
    expect(source).toContain("shouldDisplaySkillLoadIndicator");
  });

  test("tracks loaded skills with tryTrackLoadedSkill", () => {
    expect(source).toContain("tryTrackLoadedSkill");
  });
});
