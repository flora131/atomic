/**
 * Unit tests for the decomposed use-ui-controller-stack hooks.
 *
 * Tests verify:
 * - Module exports are functions
 * - useOrchestrationState correctly flattens nested args
 * - useOrchestrationState.dequeueMessage works correctly
 * - useDialogController exports
 * - useChatShellPropsBuilder exports
 * - Façade re-exports unchanged
 *
 * Full React lifecycle testing (renderHook) is deferred to task #14.
 */

import { describe, test, expect } from "bun:test";

// ── Module imports ─────────────────────────────────────────────────────
import { useOrchestrationState } from "@/state/chat/controller/use-ui-controller-stack/use-orchestration-state.ts";
import { useDialogController } from "@/state/chat/controller/use-ui-controller-stack/use-dialog-controller.ts";
import { useChatShellPropsBuilder } from "@/state/chat/controller/use-ui-controller-stack/use-chat-shell-props-builder.ts";
import { useChatUiControllerStack } from "@/state/chat/controller/use-ui-controller-stack/controller.ts";
import type { UseChatUiControllerStackArgs } from "@/state/chat/controller/use-ui-controller-stack/types.ts";

// ============================================================================
// Helpers
// ============================================================================

/** Creates minimal mock args for useOrchestrationState testing. */
function createMockArgs(): UseChatUiControllerStackArgs {
  const noop = () => {};
  const noopAsync = async () => {};
  const noopRef = { current: null };
  const noopSetState = () => {};

  return {
    agentType: "opencode",
    app: {
      createSubagentSession: noopAsync as any,
      streamWithSession: noopAsync as any,
      ensureSession: noopAsync as any,
      getModelDisplayInfo: (() => ({ model: "test", tier: "test" })) as any,
      getSession: (() => null) as any,
      initialModelId: "test-model",
      initialPrompt: undefined,
      model: "claude-sonnet-4",
      modelOps: {} as any,
      onCommandExecutionTelemetry: noop as any,
      onExit: noop as any,
      onInterrupt: noop as any,
      onModelChange: noop as any,
      onResetSession: noop as any,
      onSendMessage: noop as any,
      onSessionMcpServersChange: noop as any,
      onTerminateBackgroundAgents: noop as any,
      setStreamingState: noop as any,
      tier: "pro",
      version: "1.0.0",
      workingDir: "/test",
    },
    hitl: {
      activeHitlToolCallIdRef: noopRef as any,
      activeQuestion: null,
      handleAgentDoneRendered: noop as any,
      handleQuestionAnswer: noop as any,
      resetHitlState: noop,
    },
    isStreaming: false,
    messageQueue: {
      enqueue: noop,
      dequeue: () => undefined,
      peek: () => undefined,
      isEmpty: () => true,
      size: 0,
    } as any,
    messages: [],
    orchestration: {
      continueQueuedConversation: noop,
      dynamicPlaceholder: "Type a message...",
      emitMessageSubmitTelemetry: noop as any,
      finalizeTaskItemsOnInterrupt: noop as any,
      updateWorkflowState: noop as any,
    },
    runtime: {
      state: {
        activeBackgroundAgentCount: 0,
        compactionSummary: null,
        parallelAgents: [],
        showCompactionHistory: false,
        streamingElapsedMs: 0,
        todoItems: [],
        workflowSessionDir: null,
      },
      setters: {
        setActiveBackgroundAgentCount: noopSetState,
        setCompactionSummary: noopSetState,
        setIsAutoCompacting: noopSetState,
        setParallelAgents: noopSetState,
        setShowCompactionHistory: noopSetState,
        setTodoItems: noopSetState,
        setWorkflowSessionDir: noopSetState,
        setWorkflowSessionId: noopSetState,
      },
      refs: {
        activeBackgroundAgentCountRef: { current: 0 },
        activeStreamRunIdRef: noopRef,
        autoCompactionIndicatorRef: noopRef,
        awaitedStreamRunIdsRef: { current: new Set() },
        backgroundAgentMessageIdRef: noopRef,
        backgroundProgressSnapshotRef: noopRef,
        hasRunningToolRef: { current: false },
        isAgentOnlyStreamRef: { current: false },
        isStreamingRef: { current: false },
        lastStreamedMessageIdRef: noopRef,
        lastStreamingContentRef: noopRef,
        loadedSkillsRef: { current: new Set() },
        parallelAgentsRef: { current: [] },
        parallelInterruptHandlerRef: noopRef,
        pendingCompleteRef: noopRef,
        runningAskQuestionToolIdsRef: { current: new Set() },
        streamingMessageIdRef: noopRef,
        streamingMetaRef: noopRef,
        streamingStartRef: noopRef,
        todoItemsRef: { current: [] },
        wasInterruptedRef: { current: false },
        workflowSessionDirRef: noopRef,
        workflowSessionIdRef: noopRef,
        workflowTaskIdsRef: noopRef,
      },
      actions: {
        appendSkillLoadIndicator: noop as any,
        clearDeferredCompletion: noop,
        finalizeThinkingSourceTracking: noop as any,
        getActiveStreamRunId: () => null,
        getOwnershipTracker: () => null,
        resetLoadedSkillTracking: noop,
        resolveTrackedRun: (() => null) as any,
        separateAndInterruptAgents: (() => ({})) as any,
        setLastStreamedMessageId: noop as any,
        setStreamingMessageId: noop as any,
        shouldHideActiveStreamContent: () => false,
        startAssistantStream: noop as any,
        stopSharedStreamState: noop as any,
        trackAwaitedRun: noop as any,
      },
    } as any,
    deferredCommandQueueRef: noopRef as any,
    eventBus: {} as any,
    setIsStreaming: noopSetState,
    setMessagesWindowed: noop,
    setStreamingMeta: noopSetState,
    shellState: {
      availableModels: [],
      clipboard: { copy: noop, paste: () => "" } as any,
      commandStyleIdRef: { current: 0 },
      copyRendererSelection: () => false,
      currentModelId: "test-model",
      currentReasoningEffort: undefined,
      currentModelRef: { current: "test-model" },
      dispatchDeferredCommandMessageRef: noopRef as any,
      dispatchQueuedMessageRef: noopRef as any,
      displayModel: "Claude Sonnet",
      handleMouseUp: noop,
      hasRendererSelection: () => false,
      historyBufferMessages: [],
      inputFocused: true,
      inputSyntaxStyle: {} as any,
      markdownSyntaxStyle: {} as any,
      mcpServerToggles: {} as any,
      scrollAcceleration: {} as any,
      scrollboxRef: noopRef as any,
      setAvailableModels: noopSetState,
      setCurrentModelDisplayName: noopSetState,
      setCurrentModelId: noopSetState,
      setCurrentReasoningEffort: noopSetState,
      setMcpServerToggles: noopSetState,
      setShowModelSelector: noopSetState,
      setShowTodoPanel: noopSetState,
      setTranscriptMode: noopSetState,
      setTheme: noop as any,
      showModelSelector: false,
      showTodoPanel: false,
      tasksExpanded: false,
      themeColors: {} as any,
      toggleVerbose: noop,
      toggleTheme: noop as any,
      transcriptMode: false,
      conductorInterruptRef: noopRef as any,
      conductorResumeRef: noopRef as any,
      waitForUserInputResolverRef: noopRef as any,
      workflowActiveRef: { current: false },
      actions: {
        appendCompactionSummaryAndSync: noop as any,
        appendHistoryBufferAndSync: noop as any,
        clearHistoryBufferAndSync: noop,
      },
    } as any,
    streamingMeta: null,
    workflowState: {
      autocompleteInput: "",
      autocompleteMode: "slash",
      selectedSuggestionIndex: 0,
      argumentHint: null,
      showAutocomplete: false,
    } as any,
  };
}

// ============================================================================
// Tests: Module exports
// ============================================================================

describe("use-ui-controller-stack module exports", () => {
  test("useOrchestrationState is exported as a function", () => {
    expect(typeof useOrchestrationState).toBe("function");
  });

  test("useDialogController is exported as a function", () => {
    expect(typeof useDialogController).toBe("function");
  });

  test("useChatShellPropsBuilder is exported as a function", () => {
    expect(typeof useChatShellPropsBuilder).toBe("function");
  });

  test("useChatUiControllerStack façade is exported as a function", () => {
    expect(typeof useChatUiControllerStack).toBe("function");
  });
});

// ============================================================================
// Tests: useOrchestrationState
// ============================================================================

describe("useOrchestrationState", () => {
  test("flattens app values to top level", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    // App values should be flattened
    expect(result.model).toBe("claude-sonnet-4");
    expect(result.tier).toBe("pro");
    expect(result.version).toBe("1.0.0");
    expect(result.workingDir).toBe("/test");
    expect(result.initialModelId).toBe("test-model");
    expect(typeof result.ensureSession).toBe("function");
    expect(typeof result.onExit).toBe("function");
    expect(typeof result.onInterrupt).toBe("function");
    expect(typeof result.setStreamingState).toBe("function");
  });

  test("flattens HITL values to top level", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    expect(result.activeQuestion).toBeNull();
    expect(typeof result.handleQuestionAnswer).toBe("function");
    expect(typeof result.resetHitlState).toBe("function");
    expect(result.activeHitlToolCallIdRef).toBeDefined();
  });

  test("flattens shell state values to top level", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    expect(result.currentModelId).toBe("test-model");
    expect(result.displayModel).toBe("Claude Sonnet");
    expect(result.showModelSelector).toBe(false);
    expect(result.inputFocused).toBe(true);
    expect(result.transcriptMode).toBe(false);
    expect(Array.isArray(result.availableModels)).toBe(true);
    expect(typeof result.clipboard).toBe("object");
    expect(typeof result.handleMouseUp).toBe("function");
    expect(typeof result.toggleVerbose).toBe("function");
  });

  test("flattens shell state nested actions to top level", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    expect(typeof result.appendCompactionSummaryAndSync).toBe("function");
    expect(typeof result.appendHistoryBufferAndSync).toBe("function");
    expect(typeof result.clearHistoryBufferAndSync).toBe("function");
  });

  test("flattens orchestration values to top level", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    expect(result.dynamicPlaceholder).toBe("Type a message...");
    expect(typeof result.continueQueuedConversation).toBe("function");
    expect(typeof result.emitMessageSubmitTelemetry).toBe("function");
    expect(typeof result.updateWorkflowState).toBe("function");
  });

  test("flattens runtime state to top level", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    expect(result.activeBackgroundAgentCount).toBe(0);
    expect(result.compactionSummary).toBeNull();
    expect(Array.isArray(result.parallelAgents)).toBe(true);
    expect(result.showCompactionHistory).toBe(false);
    expect(result.streamingElapsedMs).toBe(0);
    expect(Array.isArray(result.todoItems)).toBe(true);
    expect(result.workflowSessionDir).toBeNull();
  });

  test("flattens runtime setters to top level", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    expect(typeof result.setActiveBackgroundAgentCount).toBe("function");
    expect(typeof result.setCompactionSummary).toBe("function");
    expect(typeof result.setIsAutoCompacting).toBe("function");
    expect(typeof result.setParallelAgents).toBe("function");
    expect(typeof result.setTodoItems).toBe("function");
    expect(typeof result.setWorkflowSessionDir).toBe("function");
    expect(typeof result.setWorkflowSessionId).toBe("function");
  });

  test("flattens runtime refs to top level", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    expect(result.activeBackgroundAgentCountRef.current).toBe(0);
    expect(result.isStreamingRef.current).toBe(false);
    expect(result.hasRunningToolRef.current).toBe(false);
    expect(result.wasInterruptedRef.current).toBe(false);
    expect(result.streamingMessageIdRef).toBeDefined();
    expect(result.streamingMetaRef).toBeDefined();
    expect(result.todoItemsRef).toBeDefined();
  });

  test("flattens runtime actions to top level", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    expect(typeof result.appendSkillLoadIndicator).toBe("function");
    expect(typeof result.clearDeferredCompletion).toBe("function");
    expect(typeof result.getActiveStreamRunId).toBe("function");
    expect(typeof result.getOwnershipTracker).toBe("function");
    expect(typeof result.startAssistantStream).toBe("function");
    expect(typeof result.stopSharedStreamState).toBe("function");
    expect(typeof result.shouldHideActiveStreamContent).toBe("function");
  });

  test("preserves top-level args as pass-through", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    expect(result.isStreaming).toBe(false);
    expect(result.messages).toBe(args.messages);
    expect(result.messageQueue).toBe(args.messageQueue);
    expect(result.streamingMeta).toBeNull();
    expect(result.workflowState).toBe(args.workflowState);
    expect(result.deferredCommandQueueRef).toBe(args.deferredCommandQueueRef);
    expect(result.eventBus).toBe(args.eventBus);
    expect(typeof result.setIsStreaming).toBe("function");
    expect(typeof result.setMessagesWindowed).toBe("function");
  });

  test("dequeueMessage returns content when queue has items", () => {
    const args = createMockArgs();
    args.messageQueue = {
      ...args.messageQueue,
      dequeue: () => ({ content: "hello from queue" }),
    } as any;

    const result = useOrchestrationState(args);
    expect(result.dequeueMessage()).toBe("hello from queue");
  });

  test("dequeueMessage returns null when queue is empty", () => {
    const args = createMockArgs();
    args.messageQueue = {
      ...args.messageQueue,
      dequeue: () => undefined,
    } as any;

    const result = useOrchestrationState(args);
    expect(result.dequeueMessage()).toBeNull();
  });

  test("dequeueMessage returns null when content is undefined", () => {
    const args = createMockArgs();
    args.messageQueue = {
      ...args.messageQueue,
      dequeue: () => ({ content: undefined }),
    } as any;

    const result = useOrchestrationState(args);
    expect(result.dequeueMessage()).toBeNull();
  });

  test("values reference the same objects as the input args", () => {
    const args = createMockArgs();
    const result = useOrchestrationState(args);

    // Verify referential identity for objects/arrays
    expect(result.messages).toBe(args.messages);
    expect(result.clipboard).toBe(args.shellState.clipboard);
    expect(result.scrollboxRef).toBe(args.shellState.scrollboxRef);
    expect(result.parallelAgents).toBe(args.runtime.state.parallelAgents);
    expect(result.todoItems).toBe(args.runtime.state.todoItems);
    expect(result.isStreamingRef).toBe(args.runtime.refs.isStreamingRef);
  });
});
