import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useStreamConsumer } from "@/services/events/hooks.ts";
import type { AgentType } from "@/services/models/index.ts";
import type { StreamRunRuntime } from "@/state/runtime/stream-run-runtime.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage, StreamingMeta, ThinkingDropDiagnostics } from "@/state/chat/shared/types/index.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { AgentLifecycleLedger } from "@/state/chat/shared/helpers/agent-lifecycle-ledger.ts";
import type { AgentOrderingEvent, AgentOrderingState } from "@/state/chat/shared/helpers/agent-ordering-contract.ts";
import type { AutoCompactionIndicatorState } from "@/state/chat/shared/helpers/auto-compaction-lifecycle.ts";
import {
  isRuntimeEnvelopePartEvent,
  resolveValidatedThinkingMetaEvent,
  shouldProcessStreamPartEvent,
} from "@/state/chat/shared/helpers/index.ts";
import { joinThinkingBlocks } from "@/lib/ui/format.ts";
import { createStreamPartBatch, applyStreamPartBatchToMessages } from "@/state/chat/stream/part-batch.ts";
import { useChatStreamAgentOrdering } from "@/state/chat/stream/use-agent-ordering.ts";
import { useChatStreamToolEvents } from "@/state/chat/stream/use-tool-events.ts";

export interface UseChatStreamConsumerArgs {
  agentType?: AgentType;
  activeForegroundRunHandleIdRef: MutableRefObject<string | null>;
  activeStreamRunIdRef: MutableRefObject<number | null>;
  agentLifecycleLedgerRef: MutableRefObject<AgentLifecycleLedger>;
  agentOrderingStateRef: MutableRefObject<AgentOrderingState>;
  applyAutoCompactionIndicator: (next: AutoCompactionIndicatorState) => void;
  backgroundAgentMessageIdRef: MutableRefObject<string | null>;
  clearDeferredCompletion: () => void;
  closedThinkingSourcesRef: MutableRefObject<Set<string>>;
  completionOrderingEventByAgentRef: MutableRefObject<Map<string, AgentOrderingEvent>>;
  deferredPostCompleteDeltasByAgentRef: MutableRefObject<Map<string, Array<{
    messageId: string;
    runId?: number;
    delta: string;
    completionSequence: number;
  }>>>;
  hasRunningToolRef: MutableRefObject<boolean>;
  isAgentOnlyStreamRef: MutableRefObject<boolean>;
  isStreamingRef: MutableRefObject<boolean>;
  isWorkflowTaskUpdate: (
    todos: NormalizedTodoItem[],
    previousTodos?: readonly NormalizedTodoItem[],
  ) => boolean;
  lastStreamedMessageIdRef: MutableRefObject<string | null>;
  lastStreamingContentRef: MutableRefObject<string>;
  pendingCompleteRef: MutableRefObject<(() => void) | null>;
  resolveAgentScopedMessageId: (agentId?: string) => string | null;
  runningAskQuestionToolIdsRef: MutableRefObject<Set<string>>;
  runningBlockingToolIdsRef: MutableRefObject<Set<string>>;
  sendBackgroundMessageToAgent: (content: string) => void;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setStreamingMeta: Dispatch<SetStateAction<StreamingMeta | null>>;
  setTodoItems: Dispatch<SetStateAction<NormalizedTodoItem[]>>;
  setToolCompletionVersion: Dispatch<SetStateAction<number>>;
  shouldHideActiveStreamContent: () => boolean;
  streamRunRuntimeRef: MutableRefObject<StreamRunRuntime>;
  streamingMessageIdRef: MutableRefObject<string | null>;
  streamingMetaRef: MutableRefObject<StreamingMeta | null>;
  thinkingDropDiagnosticsRef: MutableRefObject<ThinkingDropDiagnostics>;
  todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
  toolMessageIdByIdRef: MutableRefObject<Map<string, string>>;
  toolNameByIdRef: MutableRefObject<Map<string, string>>;
  workflowSessionIdRef: MutableRefObject<string | null>;
}

export function useChatStreamConsumer({
  agentType,
  activeForegroundRunHandleIdRef,
  activeStreamRunIdRef,
  agentLifecycleLedgerRef,
  agentOrderingStateRef,
  applyAutoCompactionIndicator,
  backgroundAgentMessageIdRef,
  clearDeferredCompletion,
  closedThinkingSourcesRef,
  completionOrderingEventByAgentRef,
  deferredPostCompleteDeltasByAgentRef,
  hasRunningToolRef,
  isAgentOnlyStreamRef,
  isStreamingRef,
  isWorkflowTaskUpdate,
  lastStreamedMessageIdRef,
  lastStreamingContentRef,
  pendingCompleteRef,
  resolveAgentScopedMessageId,
  runningAskQuestionToolIdsRef,
  runningBlockingToolIdsRef,
  sendBackgroundMessageToAgent,
  setMessagesWindowed,
  setParallelAgents,
  setStreamingMeta,
  setTodoItems,
  setToolCompletionVersion,
  shouldHideActiveStreamContent,
  streamRunRuntimeRef,
  streamingMessageIdRef,
  streamingMetaRef,
  thinkingDropDiagnosticsRef,
  todoItemsRef,
  toolMessageIdByIdRef,
  toolNameByIdRef,
  workflowSessionIdRef,
}: UseChatStreamConsumerArgs) {
  const { handleToolComplete, handleToolStart } = useChatStreamToolEvents({
    agentType,
    applyAutoCompactionIndicator,
    backgroundAgentMessageIdRef,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isWorkflowTaskUpdate,
    lastStreamedMessageIdRef,
    pendingCompleteRef,
    resolveAgentScopedMessageId,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    setMessagesWindowed,
    setParallelAgents,
    setTodoItems,
    setToolCompletionVersion,
    streamingMessageIdRef,
    todoItemsRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
    workflowSessionIdRef,
  });
  const { handleAgentTerminalPart, handleTextDeltaOrdering } = useChatStreamAgentOrdering({
    agentType,
    activeStreamRunIdRef,
    agentLifecycleLedgerRef,
    agentOrderingStateRef,
    completionOrderingEventByAgentRef,
    deferredPostCompleteDeltasByAgentRef,
  });

  const { resetConsumers, getOwnershipTracker } = useStreamConsumer((parts) => {
    const { queueMessagePartUpdate, updatesByMessageId } = createStreamPartBatch();

    for (const part of parts) {
      // Sub-agent tool events use independent runIds that differ from the
      // main session's activeStreamRunId. Bypass the staleness check only
      // for tool events so tool call blocks render in workflow sub-agent
      // trees, while text/thinking deltas are intentionally excluded.
      const isSubagentToolEvent =
        "agentId" in part
        && Boolean(part.agentId)
        && (part.type === "tool-start" || part.type === "tool-complete" || part.type === "tool-partial-result");
      if (!isSubagentToolEvent && !shouldProcessStreamPartEvent({
        activeRunId: activeStreamRunIdRef.current,
        partRunId: typeof part.runId === "number" ? part.runId : undefined,
        isStreaming: isStreamingRef.current,
      })) {
        continue;
      }

      if (part.type === "tool-start") {
        // Flush any pending text-delta updates for this tool's target message
        // BEFORE processing the tool-start.  In the Copilot SDK flow, text
        // deltas (from assistant.message_delta) and tool-start events (from
        // assistant.message with toolRequests) can arrive in the same batch.
        // Text deltas are queued via queueMessagePartUpdate while tool-start
        // events call handleToolStart immediately, which inverts the intended
        // ordering: the tool-start would be applied first, then the deferred
        // text deltas would create a NEW TextPart AFTER the ToolPart, causing
        // text to "leak" below the tool indicators.  Flushing the pending text
        // deltas first restores correct chronological ordering so that the
        // tool-start's removeLastStreamingTextPart() can clean them up.
        if (updatesByMessageId.size > 0) {
          applyStreamPartBatchToMessages(updatesByMessageId, setMessagesWindowed);
          updatesByMessageId.clear();
        }
        handleToolStart(part.toolId, part.toolName, part.input, part.toolMetadata, part.agentId);
        continue;
      }
      if (part.type === "tool-complete") {
        handleToolComplete(
          part.toolId,
          part.toolName ?? "unknown",
          part.output,
          part.success,
          part.error,
          part.input,
          part.toolMetadata,
          part.agentId,
        );
        continue;
      }
      if (part.type === "tool-partial-result") {
        if (isAgentOnlyStreamRef.current && !part.agentId) continue;
        const messageId =
          resolveAgentScopedMessageId(part.agentId)
          ?? toolMessageIdByIdRef.current.get(part.toolId)
          ?? streamingMessageIdRef.current
          ?? backgroundAgentMessageIdRef.current
          ?? lastStreamedMessageIdRef.current;
        if (!messageId) continue;
        queueMessagePartUpdate(messageId, {
          type: "tool-partial-result",
          runId: part.runId,
          toolId: part.toolId,
          partialOutput: part.partialOutput,
          ...(part.agentId ? { agentId: part.agentId } : {}),
        });
        continue;
      }
      if (part.type === "agent-terminal") {
        const messageId = resolveAgentScopedMessageId(part.agentId);
        if (!messageId) continue;
        handleAgentTerminalPart(part, messageId, queueMessagePartUpdate);
        continue;
      }
      if (part.type === "text-delta") {
        if (!part.agentId && !isStreamingRef.current) continue;
        if (pendingCompleteRef.current) {
          clearDeferredCompletion();
        }
        if (!part.agentId) {
          lastStreamingContentRef.current += part.delta;
          streamRunRuntimeRef.current.appendContent(activeForegroundRunHandleIdRef.current, part.delta);
        }
        if (!part.agentId && shouldHideActiveStreamContent()) continue;
        const messageId = resolveAgentScopedMessageId(part.agentId);
        if (part.agentId) {
          if (handleTextDeltaOrdering(part, messageId, queueMessagePartUpdate)) {
            continue;
          }
        }
        if (!messageId) continue;
        queueMessagePartUpdate(messageId, {
          type: "text-delta",
          runId: part.runId,
          delta: part.delta,
          ...(part.agentId ? { agentId: part.agentId } : {}),
        });
        continue;
      }
      if (part.type === "text-complete") {
        const accumulated = lastStreamingContentRef.current;
        const fullText = part.fullText;
        if (fullText.length > accumulated.length && fullText.startsWith(accumulated)) {
          const missing = fullText.slice(accumulated.length);
          lastStreamingContentRef.current = fullText;
          if (!shouldHideActiveStreamContent()) {
            const messageId = streamingMessageIdRef.current;
            if (messageId) {
              queueMessagePartUpdate(messageId, { type: "text-delta", delta: missing });
            }
          }
        } else {
          lastStreamingContentRef.current = fullText;
        }
        continue;
      }
      if (part.type === "thinking-complete") {
        const messageId = resolveAgentScopedMessageId(part.agentId);
        if (!messageId) continue;
        // Clear accumulated text so the next thinking block with the
        // same sourceKey starts fresh instead of appending.
        const previousMeta = streamingMetaRef.current;
        if (previousMeta?.thinkingTextBySource?.[part.sourceKey] !== undefined) {
          const thinkingTextBySource = { ...previousMeta.thinkingTextBySource };
          delete thinkingTextBySource[part.sourceKey];
          const nextMeta: StreamingMeta = {
            ...previousMeta,
            thinkingTextBySource,
            thinkingText: joinThinkingBlocks(Object.values(thinkingTextBySource)),
          };
          streamingMetaRef.current = nextMeta;
          setStreamingMeta(nextMeta);
        }
        queueMessagePartUpdate(messageId, part);
        continue;
      }
      if (part.type === "thinking-meta") {
        const messageId = resolveAgentScopedMessageId(part.agentId);
        if (!messageId) continue;
        if (part.agentId) {
          queueMessagePartUpdate(messageId, {
            type: "thinking-meta",
            runId: part.runId,
            thinkingSourceKey: part.thinkingSourceKey,
            targetMessageId: part.targetMessageId,
            streamGeneration: part.streamGeneration,
            thinkingMs: part.thinkingMs,
            thinkingText: part.thinkingText,
            includeReasoningPart: true,
            agentId: part.agentId,
          });
          continue;
        }
        const previousMeta = streamingMetaRef.current ?? {
          outputTokens: 0,
          thinkingMs: 0,
          thinkingText: "",
          thinkingTextBySource: {},
          thinkingGenerationBySource: {},
          thinkingMessageBySource: {},
        };
        const sourceKey = part.thinkingSourceKey;
        const thinkingTextBySource = { ...previousMeta.thinkingTextBySource };
        thinkingTextBySource[sourceKey] = `${thinkingTextBySource[sourceKey] ?? ""}${part.thinkingText}`;
        const thinkingGenerationBySource = {
          ...previousMeta.thinkingGenerationBySource,
          [sourceKey]: part.streamGeneration,
        };
        const thinkingMessageBySource = {
          ...previousMeta.thinkingMessageBySource,
          [sourceKey]: messageId,
        };
        const thinkingText = joinThinkingBlocks(Object.values(thinkingTextBySource));
        const nextMeta: StreamingMeta = {
          ...previousMeta,
          thinkingSourceKey: sourceKey,
          thinkingText,
          thinkingTextBySource,
          thinkingGenerationBySource,
          thinkingMessageBySource,
        };
        streamingMetaRef.current = nextMeta;
        setStreamingMeta(nextMeta);
        const thinkingMetaEvent = resolveValidatedThinkingMetaEvent(
          nextMeta,
          messageId,
          closedThinkingSourcesRef.current,
          thinkingDropDiagnosticsRef.current,
        );
        if (!thinkingMetaEvent) continue;
        queueMessagePartUpdate(messageId, {
          type: "thinking-meta",
          runId: part.runId,
          thinkingSourceKey: thinkingMetaEvent.thinkingSourceKey,
          targetMessageId: thinkingMetaEvent.targetMessageId,
          streamGeneration: thinkingMetaEvent.streamGeneration,
          thinkingMs: nextMeta.thinkingMs,
          thinkingText: thinkingMetaEvent.thinkingText,
          includeReasoningPart: true,
          ...(part.agentId ? { agentId: part.agentId } : {}),
        });
        continue;
      }
      if (isRuntimeEnvelopePartEvent(part)) {
        if (part.type === "task-result-upsert") {
          const resultText = part.envelope.output_text;
          if (typeof resultText === "string" && resultText.trim().length > 0) {
            const statusLabel = part.envelope.status === "error" ? "failed" : "completed";
            sendBackgroundMessageToAgent(
              `Task "${part.envelope.title}" (${part.envelope.task_id}) ${statusLabel}:\n\n${resultText}`,
            );
          }
        }
        const messageId = resolveAgentScopedMessageId();
        if (!messageId) continue;
        queueMessagePartUpdate(messageId, part);
      }
    }

    applyStreamPartBatchToMessages(updatesByMessageId, setMessagesWindowed);
  });

  return { getOwnershipTracker, resetConsumers };
}
