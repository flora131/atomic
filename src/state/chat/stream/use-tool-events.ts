import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AgentType } from "@/services/models/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage } from "@/state/chat/shared/types/index.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import {
  isTodoWriteToolName,
  normalizeTaskStatus,
  normalizeTodoItem,
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

/** Detect the SQLite-backed task_list CRUD tool by name. */
function isTaskListToolName(name: string): boolean {
  return name === "task_list";
}

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
  setHasRunningTool: Dispatch<SetStateAction<boolean>>;
  streamingMessageIdRef: RefObject<string | null>;
  todoItemsRef: RefObject<NormalizedTodoItem[]>;
  toolMessageIdByIdRef: RefObject<Map<string, string>>;
  toolNameByIdRef: RefObject<Map<string, string>>;
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
  setHasRunningTool,
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
      setHasRunningTool(runningBlockingToolIdsRef.current.size > 0);
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

    // TodoWrite handling — retained for non-Ralph contexts (standalone chat, other
    // workflows). The Ralph workflow disallows TodoWrite via RALPH_DISALLOWED_TOOLS
    // and uses the SQLite-backed `task_list` tool instead (see block below).
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

    // task_list tool mutations (SQLite-backed CRUD tool):
    // Optimistic updates are intentionally skipped in handleToolStart to avoid
    // race conditions with parallel agents. The authoritative task state is
    // applied in handleToolComplete from the tool's output instead.
  }, [
    agentType,
    applyAutoCompactionIndicator,
    hasRunningToolRef,
    isAgentOnlyStreamRef,
    isWorkflowTaskUpdate,
    resolveAgentScopedMessageId,
    runningAskQuestionToolIdsRef,
    runningBlockingToolIdsRef,
    setHasRunningTool,
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
      setHasRunningTool(false);
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

    // TodoWrite completion — retained for non-Ralph contexts (standalone chat,
    // other workflows). The Ralph workflow disallows TodoWrite via
    // RALPH_DISALLOWED_TOOLS and uses the SQLite-backed `task_list` tool instead
    // (see block below).
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

    // Handle task_list tool completion (SQLite-backed CRUD tool).
    // On completion, prefer the authoritative tasks array from the tool output
    // when available; otherwise fall back to optimistic input-based updates.
    // The tool itself persists to SQLite, so we only update TUI state here.
    //
    // NOTE: The outer condition intentionally does NOT gate on `input` because
    // `ToolCompleteEvent.input` is optional (toolInput is optional in the
    // stream.tool.complete schema) and some providers emit an empty `{}` for
    // toolInput on tool-complete. The authoritative path reads from `output`,
    // so it must not be blocked when `input` is absent. Only the fallback
    // paths require `input` for action-specific optimistic updates.
    //
    // The tool output (`toolResult`) may arrive as a JSON string rather than a
    // parsed object depending on the SDK provider, so we parse it defensively.
    if (isTaskListToolName(completedToolName)) {
      let outputRecord: Record<string, unknown>;
      if (typeof output === "string") {
        try {
          const parsed: unknown = JSON.parse(output);
          outputRecord = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
        } catch {
          outputRecord = {};
        }
      } else {
        outputRecord = (typeof output === "object" && output !== null ? output : {}) as Record<string, unknown>;
      }

      // If the output contains a tasks array, use it as the authoritative state
      if (Array.isArray(outputRecord.tasks)) {
        const todos: NormalizedTodoItem[] = (outputRecord.tasks as Array<Record<string, unknown>>).map((t) =>
          normalizeTodoItem(t),
        );
        todoItemsRef.current = todos;
        setTodoItems(todos);
      } else if (input && input.action) {
        // Fallback: apply optimistic update from input when output lacks full task list.
        // Uses functional setTodoItems updater so concurrent calls from parallel agents
        // chain correctly instead of clobbering each other via stale todoItemsRef reads.
        const action = input.action as string;

        if (action === "update_task_status" && input.taskId && input.status) {
          const taskId = String(input.taskId);
          const newStatus = normalizeTaskStatus(input.status);
          setTodoItems((prev) => {
            const updatedTodos = prev.map((t) =>
              t.id === taskId ? { ...t, status: newStatus } : t,
            );
            todoItemsRef.current = updatedTodos;
            return updatedTodos;
          });
        }

        if (action === "add_task" && input.task && typeof input.task === "object") {
          const newTodo = normalizeTodoItem(input.task);
          setTodoItems((prev) => {
            const alreadyExists = prev.some((t) => t.id === newTodo.id);
            if (alreadyExists) return prev;
            const updatedTodos = [...prev, newTodo];
            todoItemsRef.current = updatedTodos;
            return updatedTodos;
          });
        }

        if (action === "delete_task" && input.taskId) {
          const taskId = String(input.taskId);
          setTodoItems((prev) => {
            const updatedTodos = prev.filter((t) => t.id !== taskId);
            todoItemsRef.current = updatedTodos;
            return updatedTodos;
          });
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
    setHasRunningTool,
    streamingMessageIdRef,
    todoItemsRef,
    toolMessageIdByIdRef,
    toolNameByIdRef,
    workflowSessionIdRef,
  ]);

  return { handleToolComplete, handleToolStart };
}
