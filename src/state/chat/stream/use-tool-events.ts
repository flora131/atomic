import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AgentType } from "@/services/models/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage } from "@/state/chat/types.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import {
  isTodoWriteToolName,
  reconcileTodoWriteItems,
} from "@/state/parts/helpers/task-status.ts";
import { isAutoCompactionToolName, type AutoCompactionIndicatorState } from "@/lib/ui/auto-compaction-lifecycle.ts";
import { isAskQuestionToolName, shouldTrackToolAsBlocking } from "@/lib/ui/stream-continuation.ts";
import {
  finalizeCorrelatedSubagentDispatchForToolComplete,
  finalizeSyntheticTaskAgentForToolComplete,
  upsertSyntheticTaskAgentForToolStart,
} from "@/state/chat/helpers.ts";
import { applyStreamPartEvent } from "@/state/parts/index.ts";

interface UseChatStreamToolEventsArgs {
  agentType?: AgentType;
  applyAutoCompactionIndicator: (next: AutoCompactionIndicatorState) => void;
  backgroundAgentMessageIdRef: MutableRefObject<string | null>;
  hasRunningToolRef: MutableRefObject<boolean>;
  isAgentOnlyStreamRef: MutableRefObject<boolean>;
  isWorkflowTaskUpdate: (
    todos: NormalizedTodoItem[],
    previousTodos?: readonly NormalizedTodoItem[],
  ) => boolean;
  lastStreamedMessageIdRef: MutableRefObject<string | null>;
  pendingCompleteRef: MutableRefObject<(() => void) | null>;
  resolveAgentScopedMessageId: (agentId?: string) => string | null;
  runningAskQuestionToolIdsRef: MutableRefObject<Set<string>>;
  runningBlockingToolIdsRef: MutableRefObject<Set<string>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setTodoItems: Dispatch<SetStateAction<NormalizedTodoItem[]>>;
  setToolCompletionVersion: Dispatch<SetStateAction<number>>;
  streamingMessageIdRef: MutableRefObject<string | null>;
  todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
  toolMessageIdByIdRef: MutableRefObject<Map<string, string>>;
  toolNameByIdRef: MutableRefObject<Map<string, string>>;
  workflowSessionIdRef: MutableRefObject<string | null>;
}

interface UseChatStreamToolEventsResult {
  handleToolComplete: (
    toolId: string,
    toolName: string,
    output: unknown,
    success: boolean,
    error?: string,
    input?: Record<string, unknown>,
    toolMetadata?: Record<string, unknown>,
    agentId?: string,
  ) => void;
  handleToolStart: (
    toolId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolMetadata?: Record<string, unknown>,
    agentId?: string,
  ) => void;
}

export function useChatStreamToolEvents({
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
}: UseChatStreamToolEventsArgs): UseChatStreamToolEventsResult {
  const handleToolStart = useCallback((
    toolId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolMetadata?: Record<string, unknown>,
    agentId?: string,
  ) => {
    if (isAutoCompactionToolName(toolName)) {
      applyAutoCompactionIndicator({ status: "running" });
    }

    toolNameByIdRef.current.set(toolId, toolName);
    const syntheticStartedAt = new Date().toISOString();
    setParallelAgents((current) =>
      upsertSyntheticTaskAgentForToolStart({
        agents: current,
        provider: agentType,
        toolName,
        toolId,
        input,
        startedAt: syntheticStartedAt,
        ...(agentId ? { agentId } : {}),
      }),
    );

    if (shouldTrackToolAsBlocking(toolName)) {
      runningBlockingToolIdsRef.current.add(toolId);
      hasRunningToolRef.current = runningBlockingToolIdsRef.current.size > 0;
    }
    if (isAskQuestionToolName(toolName)) {
      runningAskQuestionToolIdsRef.current.add(toolId);
    }

    const shouldApplyMessageToolParts = !isAgentOnlyStreamRef.current || Boolean(agentId);
    if (shouldApplyMessageToolParts) {
      const messageId = resolveAgentScopedMessageId(agentId);
      if (messageId) {
        toolMessageIdByIdRef.current.set(toolId, messageId);
        setMessagesWindowed((prev) =>
          prev.map((msg) => {
            if (msg.id === messageId) {
              return applyStreamPartEvent(msg, {
                type: "tool-start",
                toolId,
                toolName,
                input,
                ...(toolMetadata ? { toolMetadata } : {}),
                ...(agentId ? { agentId } : {}),
              });
            }
            return msg;
          }),
        );
      } else {
        setMessagesWindowed((prev) => {
          let targetId: string | undefined;
          for (let index = prev.length - 1; index >= 0; index--) {
            const message = prev[index];
            if (message?.role === "assistant") {
              targetId = message.id;
              break;
            }
          }
          if (!targetId) return prev;
          toolMessageIdByIdRef.current.set(toolId, targetId);
          return prev.map((msg) => {
            if (msg.id === targetId) {
              return applyStreamPartEvent(msg, {
                type: "tool-start",
                toolId,
                toolName,
                input,
                ...(toolMetadata ? { toolMetadata } : {}),
                ...(agentId ? { agentId } : {}),
              });
            }
            return msg;
          });
        });
      }
    }

    if (isTodoWriteToolName(toolName) && input.todos && Array.isArray(input.todos)) {
      const previousTodos = todoItemsRef.current;
      const todos = reconcileTodoWriteItems(input.todos, previousTodos);
      const isWorkflowUpdate = isWorkflowTaskUpdate(todos, previousTodos);
      const shouldApplyTodoState = !workflowSessionIdRef.current || isWorkflowUpdate;
      if (shouldApplyTodoState) {
        todoItemsRef.current = todos;
        setTodoItems(todos);
      }
    }
  }, [
    agentType,
    applyAutoCompactionIndicator,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isWorkflowTaskUpdate,
    resolveAgentScopedMessageId,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    setMessagesWindowed,
    setParallelAgents,
    setTodoItems,
    todoItemsRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
    workflowSessionIdRef,
  ]);

  const handleToolComplete = useCallback((
    toolId: string,
    toolName: string,
    output: unknown,
    success: boolean,
    error?: string,
    input?: Record<string, unknown>,
    toolMetadata?: Record<string, unknown>,
    agentId?: string,
  ) => {
    const completedToolName = toolNameByIdRef.current.get(toolId) ?? toolName;
    if (completedToolName && completedToolName !== "unknown" && isAutoCompactionToolName(completedToolName)) {
      applyAutoCompactionIndicator(
        success
          ? { status: "completed" }
          : { status: "error", errorMessage: error?.trim() || undefined },
      );
    }

    const completedAskQuestion = isAskQuestionToolName(completedToolName);
    toolNameByIdRef.current.delete(toolId);
    if (completedAskQuestion) {
      runningAskQuestionToolIdsRef.current.delete(toolId);
    }

    const hadBlockingTool = hasRunningToolRef.current;
    runningBlockingToolIdsRef.current.delete(toolId);
    hasRunningToolRef.current = runningBlockingToolIdsRef.current.size > 0;
    if (hadBlockingTool && !hasRunningToolRef.current && pendingCompleteRef.current) {
      setToolCompletionVersion((version) => version + 1);
    }

    const shouldApplyMessageToolParts = !isAgentOnlyStreamRef.current || Boolean(agentId);
    if (shouldApplyMessageToolParts) {
      const messageId =
        streamingMessageIdRef.current
        ?? toolMessageIdByIdRef.current.get(toolId)
        ?? backgroundAgentMessageIdRef.current
        ?? lastStreamedMessageIdRef.current;
      if (messageId) {
        setMessagesWindowed((prev) =>
          prev.map((msg) => {
            if (msg.id === messageId) {
              return applyStreamPartEvent(msg, {
                type: "tool-complete",
                toolId,
                toolName: completedToolName,
                output,
                success,
                error,
                input,
                ...(toolMetadata ? { toolMetadata } : {}),
                ...(agentId ? { agentId } : {}),
              });
            }
            return msg;
          }),
        );
      }
    }
    toolMessageIdByIdRef.current.delete(toolId);
    setParallelAgents((current) => {
      const completedAtMs = Date.now();
      const withSyntheticFinalization = finalizeSyntheticTaskAgentForToolComplete({
        agents: current,
        provider: agentType,
        toolName: completedToolName,
        toolId,
        success,
        output,
        error,
        completedAtMs,
        ...(agentId ? { agentId } : {}),
      });
      return finalizeCorrelatedSubagentDispatchForToolComplete({
        agents: withSyntheticFinalization,
        provider: agentType,
        toolName: completedToolName,
        toolId,
        success,
        error,
        completedAtMs,
        ...(agentId ? { agentId } : {}),
      });
    });

    const isTodoWriteCompletion = isTodoWriteToolName(completedToolName);
    if (isTodoWriteCompletion && input && input.todos && Array.isArray(input.todos)) {
      const previousTodos = todoItemsRef.current;
      const todos = reconcileTodoWriteItems(input.todos, previousTodos);
      const isWorkflowUpdate = isWorkflowTaskUpdate(todos, previousTodos);
      const shouldApplyTodoState = !workflowSessionIdRef.current || isWorkflowUpdate;
      if (shouldApplyTodoState) {
        todoItemsRef.current = todos;
        setTodoItems(todos);
      }
    }
  }, [
    agentType,
    applyAutoCompactionIndicator,
    backgroundAgentMessageIdRef,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isWorkflowTaskUpdate,
    lastStreamedMessageIdRef,
    pendingCompleteRef,
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
  ]);

  return { handleToolComplete, handleToolStart };
}
