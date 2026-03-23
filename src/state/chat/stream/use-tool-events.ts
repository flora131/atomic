import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AgentType } from "@/services/models/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage } from "@/state/chat/shared/types/index.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import {
  isTodoWriteToolName,
  reconcileTodoWriteItems,
} from "@/state/parts/helpers/task-status.ts";
import { isAutoCompactionToolName, type AutoCompactionIndicatorState } from "@/state/chat/shared/helpers/auto-compaction-lifecycle.ts";
import { isAskQuestionToolName, shouldTrackToolAsBlocking } from "@/state/chat/shared/helpers/stream-continuation.ts";
import {
  finalizeCorrelatedSubagentDispatchForToolComplete,
  finalizeSyntheticTaskAgentForToolComplete,
  upsertSyntheticTaskAgentForToolStart,
} from "@/state/chat/shared/helpers/index.ts";
import { applyStreamPartEvent, isSubagentToolName } from "@/state/parts/index.ts";
import { persistWorkflowTasksToDisk } from "@/services/workflows/helpers/persist-workflow-tasks.ts";

interface UseChatStreamToolEventsArgs {
  agentType?: AgentType;
  applyAutoCompactionIndicator: (next: AutoCompactionIndicatorState) => void;
  backgroundAgentMessageIdRef: RefObject<string | null>;
  hasRunningToolRef: RefObject<boolean>;
  isAgentOnlyStreamRef: RefObject<boolean>;
  isWorkflowTaskUpdate: (
    todos: NormalizedTodoItem[],
    previousTodos?: readonly NormalizedTodoItem[],
  ) => boolean;
  lastStreamedMessageIdRef: RefObject<string | null>;
  pendingCompleteRef: RefObject<(() => void) | null>;
  resolveAgentScopedMessageId: (agentId?: string) => string | null;
  runningAskQuestionToolIdsRef: RefObject<Set<string>>;
  runningBlockingToolIdsRef: RefObject<Set<string>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setTodoItems: Dispatch<SetStateAction<NormalizedTodoItem[]>>;
  setToolCompletionVersion: Dispatch<SetStateAction<number>>;
  streamingMessageIdRef: RefObject<string | null>;
  todoItemsRef: RefObject<NormalizedTodoItem[]>;
  toolMessageIdByIdRef: RefObject<Map<string, string>>;
  toolNameByIdRef: RefObject<Map<string, string>>;
  workflowSessionDirRef: RefObject<string | null>;
  workflowSessionIdRef: RefObject<string | null>;
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
  workflowSessionDirRef,
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

    // Root sub-agent dispatch tools (task/agent/launch_agent) must always
    // create a ToolPart in the message so mergeParallelAgentsIntoParts can
    // anchor the sub-agent tree inline. Without this, agent-only streams
    // suppress the ToolPart and the tree stays pinned at the fallback position.
    const isRootSubagentDispatch = !agentId && isSubagentToolName(toolName);
    const shouldApplyMessageToolParts = !isAgentOnlyStreamRef.current || Boolean(agentId) || isRootSubagentDispatch;
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

        // Persist to tasks.json so the TaskListPanel file watcher picks up changes
        const sessionDir = workflowSessionDirRef.current;
        if (sessionDir && workflowSessionIdRef.current) {
          persistWorkflowTasksToDisk(sessionDir, todos);
        }
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
    workflowSessionDirRef,
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

    const isRootSubagentComplete = !agentId && isSubagentToolName(completedToolName);
    const shouldApplyMessageToolParts = !isAgentOnlyStreamRef.current || Boolean(agentId) || isRootSubagentComplete;
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

        // Persist to tasks.json so the TaskListPanel file watcher picks up changes
        const sessionDir = workflowSessionDirRef.current;
        if (sessionDir && workflowSessionIdRef.current) {
          persistWorkflowTasksToDisk(sessionDir, todos);
        }
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
    workflowSessionDirRef,
    workflowSessionIdRef,
  ]);

  return { handleToolComplete, handleToolStart };
}
