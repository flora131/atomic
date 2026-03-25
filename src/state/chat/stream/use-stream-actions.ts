/**
 * Stream Actions Hook
 *
 * Owns the 8 locally-defined useCallback actions for the chat stream runtime.
 * Extracted from use-runtime.ts to isolate action definitions from state and
 * ref declarations. Each callback accesses refs directly (identity-stable).
 */

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { isBackgroundAgent } from "@/state/chat/shared/helpers/background-agent-footer.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";

export interface UseStreamActionsArgs {
  /** Refs consumed by the actions */
  streamingMessageIdRef: RefObject<string | null>;
  lastStreamedMessageIdRef: RefObject<string | null>;
  backgroundAgentMessageIdRef: RefObject<string | null>;
  loadedSkillsRef: RefObject<Set<string>>;
  activeSkillSessionIdRef: RefObject<string | null>;
  agentMessageIdByIdRef: RefObject<Map<string, string>>;
  parallelAgentsRef: RefObject<ParallelAgent[]>;
  /** Setter consumed by anchor-sync actions */
  setAgentAnchorSyncVersion: Dispatch<SetStateAction<number>>;
}

export function useStreamActions({
  streamingMessageIdRef,
  lastStreamedMessageIdRef,
  backgroundAgentMessageIdRef,
  loadedSkillsRef,
  activeSkillSessionIdRef,
  agentMessageIdByIdRef,
  parallelAgentsRef,
  setAgentAnchorSyncVersion,
}: UseStreamActionsArgs) {
  // -- Anchor-sync wrappers (set ref + bump version counter) --

  const setStreamingMessageId = useCallback((messageId: string | null): void => {
    if (streamingMessageIdRef.current === messageId) return;
    streamingMessageIdRef.current = messageId;
    setAgentAnchorSyncVersion((version) => version + 1);
  }, [streamingMessageIdRef, setAgentAnchorSyncVersion]);

  const setLastStreamedMessageId = useCallback((messageId: string | null): void => {
    if (lastStreamedMessageIdRef.current === messageId) return;
    lastStreamedMessageIdRef.current = messageId;
    setAgentAnchorSyncVersion((version) => version + 1);
  }, [lastStreamedMessageIdRef, setAgentAnchorSyncVersion]);

  const setBackgroundAgentMessageId = useCallback((messageId: string | null): void => {
    if (backgroundAgentMessageIdRef.current === messageId) return;
    backgroundAgentMessageIdRef.current = messageId;
    setAgentAnchorSyncVersion((version) => version + 1);
  }, [backgroundAgentMessageIdRef, setAgentAnchorSyncVersion]);

  // -- Skill tracking --

  const resetLoadedSkillTracking = useCallback((options?: {
    resetSessionBinding?: boolean;
  }) => {
    loadedSkillsRef.current.clear();
    if (options?.resetSessionBinding) {
      activeSkillSessionIdRef.current = null;
    }
  }, [loadedSkillsRef, activeSkillSessionIdRef]);

  // -- Agent message binding --

  const setAgentMessageBinding = useCallback((agentId: string, messageId: string): void => {
    if (agentMessageIdByIdRef.current.get(agentId) === messageId) return;
    agentMessageIdByIdRef.current.set(agentId, messageId);
    setAgentAnchorSyncVersion((version) => version + 1);
  }, [agentMessageIdByIdRef, setAgentAnchorSyncVersion]);

  const deleteAgentMessageBinding = useCallback((agentId: string): void => {
    if (!agentMessageIdByIdRef.current.has(agentId)) return;
    agentMessageIdByIdRef.current.delete(agentId);
    setAgentAnchorSyncVersion((version) => version + 1);
  }, [agentMessageIdByIdRef, setAgentAnchorSyncVersion]);

  // -- Agent partitioning --

  const separateAndInterruptAgents = useCallback((agents: ParallelAgent[]) => {
    const backgroundAgents: ParallelAgent[] = [];
    const foregroundAgents: ParallelAgent[] = [];
    for (const agent of agents) {
      if (isBackgroundAgent(agent)) {
        backgroundAgents.push(agent);
      } else {
        foregroundAgents.push(agent);
      }
    }

    return {
      interruptedAgents: [
        ...foregroundAgents.map((agent) =>
          agent.status === "running" || agent.status === "pending"
            ? {
              ...agent,
              status: "interrupted" as const,
              currentTool: undefined,
              durationMs: Date.now() - new Date(agent.startedAt).getTime(),
            }
            : agent,
        ),
        ...backgroundAgents,
      ],
      remainingLiveAgents: backgroundAgents,
    };
  }, []);

  // -- Scoped message resolution --

  const resolveAgentScopedMessageId = useCallback((agentId?: string): string | null => {
    if (!agentId) {
      return streamingMessageIdRef.current ?? lastStreamedMessageIdRef.current;
    }

    const mappedMessageId = agentMessageIdByIdRef.current.get(agentId);
    if (mappedMessageId) {
      return mappedMessageId;
    }

    const scopedAgent = parallelAgentsRef.current.find((agent) => agent.id === agentId);
    const shouldPreferBackgroundMessage = scopedAgent ? isBackgroundAgent(scopedAgent) : false;

    if (shouldPreferBackgroundMessage) {
      return (
        backgroundAgentMessageIdRef.current
        ?? streamingMessageIdRef.current
        ?? lastStreamedMessageIdRef.current
      );
    }

    return streamingMessageIdRef.current ?? lastStreamedMessageIdRef.current;
  }, [streamingMessageIdRef, lastStreamedMessageIdRef, agentMessageIdByIdRef, parallelAgentsRef, backgroundAgentMessageIdRef]);

  return {
    setStreamingMessageId,
    setLastStreamedMessageId,
    setBackgroundAgentMessageId,
    resetLoadedSkillTracking,
    setAgentMessageBinding,
    deleteAgentMessageBinding,
    separateAndInterruptAgents,
    resolveAgentScopedMessageId,
  };
}

export type UseStreamActionsResult = ReturnType<typeof useStreamActions>;
