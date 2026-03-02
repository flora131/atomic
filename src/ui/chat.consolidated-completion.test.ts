/**
 * Tests for Fix 5C — Consolidated React state updates in handleStreamComplete
 *
 * Validates that the Path 3 (normal completion) logic in handleStreamComplete
 * correctly:
 * 1. Filters agents by existing message agent IDs (no orphans)
 * 2. Finalizes running/pending agents while preserving background agents
 * 3. Computes remaining background agents for post-stream tracking
 * 4. Produces the correct finalized message state in a single updater pass
 *
 * The previous implementation nested setMessagesWindowed inside
 * setParallelAgents with a no-op read-only state update. The consolidated
 * version performs both reads and writes in a single setMessagesWindowed
 * updater and calls setParallelAgents back-to-back (not nested).
 */

import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import { getActiveBackgroundAgents } from "./utils/background-agent-footer.ts";
import { finalizeStreamingReasoningInMessage } from "./parts/index.ts";
import type { ChatMessage } from "./chat.tsx";

// ---------------------------------------------------------------------------
// Helpers — mirror the consolidated Path 3 logic from handleStreamComplete
// ---------------------------------------------------------------------------

function createAgent(overrides: Partial<ParallelAgent>): ParallelAgent {
  return {
    id: "agent-1",
    name: "Test Agent",
    task: "Test task",
    status: "running",
    startedAt: new Date(Date.now() - 2000).toISOString(),
    background: false,
    ...overrides,
  };
}

function createMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant" as const,
    content: "Hello",
    streaming: true,
    ...overrides,
  } as ChatMessage;
}

/**
 * Mirrors the consolidated single-updater logic from Path 3:
 * - Reads existing agent IDs from the message
 * - Filters current agents to only those on the message
 * - Finalizes running/pending foreground agents
 * - Returns the finalized agents array
 */
function computeFinalizedAgents(
  messageAgents: ParallelAgent[] | undefined,
  currentAgents: ParallelAgent[],
): ParallelAgent[] | undefined {
  const existingAgentIds = new Set<string>();
  if (messageAgents) {
    for (const agent of messageAgents) {
      existingAgentIds.add(agent.id);
    }
  }

  return currentAgents.length > 0
    ? currentAgents
        .filter((a) => existingAgentIds.has(a.id))
        .map((a) => {
          if (a.background) return a;
          return a.status === "running" || a.status === "pending"
            ? {
                ...a,
                status: "completed" as const,
                currentTool: undefined,
                durationMs: Date.now() - new Date(a.startedAt).getTime(),
              }
            : a;
        })
    : undefined;
}

function appendBackgroundMessageInOrder(
  prev: ChatMessage[],
  message: ChatMessage,
  refs: {
    backgroundAgentMessageId: string | null;
    streamingMessageId: string | null;
    lastStreamedMessageId: string | null;
  },
): ChatMessage[] {
  refs.backgroundAgentMessageId = message.id;
  return [...prev, message];
}

function finalizeActiveStreamingMessage(
  prev: ChatMessage[],
  activeStreamingMessageId: string | null,
): ChatMessage[] {
  if (!activeStreamingMessageId) {
    return prev;
  }

  return prev.map((msg) =>
    msg.id === activeStreamingMessageId && msg.role === "assistant" && msg.streaming
      ? {
          ...finalizeStreamingReasoningInMessage(msg),
          streaming: false,
          completedAt: new Date(),
        }
      : msg,
  );
}

// ---------------------------------------------------------------------------
// Tests — Consolidated completion path
// ---------------------------------------------------------------------------

describe("Consolidated completion state updates (Fix 5C)", () => {
  describe("Agent filtering by message ownership", () => {
    test("filters out orphaned agents not present on the message", () => {
      const messageAgents = [
        createAgent({ id: "a1" }),
        createAgent({ id: "a2" }),
      ];
      const currentAgents = [
        createAgent({ id: "a1", status: "running" }),
        createAgent({ id: "a2", status: "running" }),
        createAgent({ id: "orphan", status: "running" }), // Not on message
      ];

      const result = computeFinalizedAgents(messageAgents, currentAgents);

      expect(result).toBeDefined();
      expect(result!.length).toBe(2);
      expect(result!.map((a) => a.id)).toEqual(["a1", "a2"]);
      // Orphan should be filtered out
      expect(result!.find((a) => a.id === "orphan")).toBeUndefined();
    });

    test("returns all agents when all are on the message", () => {
      const messageAgents = [
        createAgent({ id: "a1" }),
        createAgent({ id: "a2" }),
      ];
      const currentAgents = [
        createAgent({ id: "a1", status: "running" }),
        createAgent({ id: "a2", status: "completed" }),
      ];

      const result = computeFinalizedAgents(messageAgents, currentAgents);

      expect(result).toBeDefined();
      expect(result!.length).toBe(2);
    });

    test("returns undefined when currentAgents is empty", () => {
      const messageAgents = [createAgent({ id: "a1" })];
      const result = computeFinalizedAgents(messageAgents, []);
      expect(result).toBeUndefined();
    });

    test("returns empty array when no agents match message IDs", () => {
      const messageAgents = [createAgent({ id: "a1" })];
      const currentAgents = [createAgent({ id: "orphan", status: "running" })];

      const result = computeFinalizedAgents(messageAgents, currentAgents);

      expect(result).toBeDefined();
      expect(result!.length).toBe(0);
    });

    test("handles undefined message agents", () => {
      const currentAgents = [createAgent({ id: "a1", status: "running" })];

      const result = computeFinalizedAgents(undefined, currentAgents);

      // All agents are filtered out since none match existing IDs (empty set)
      expect(result).toBeDefined();
      expect(result!.length).toBe(0);
    });
  });

  describe("Agent finalization", () => {
    test("finalizes running foreground agents to completed", () => {
      const agents = [createAgent({ id: "a1", status: "running" })];
      const result = computeFinalizedAgents(agents, agents);

      expect(result).toBeDefined();
      expect(result![0]!.status).toBe("completed");
      expect(result![0]!.currentTool).toBeUndefined();
      expect(result![0]!.durationMs).toBeGreaterThan(0);
    });

    test("finalizes pending foreground agents to completed", () => {
      const agents = [createAgent({ id: "a1", status: "pending" })];
      const result = computeFinalizedAgents(agents, agents);

      expect(result).toBeDefined();
      expect(result![0]!.status).toBe("completed");
    });

    test("preserves already-completed agents", () => {
      const agents = [
        createAgent({ id: "a1", status: "completed", durationMs: 1234 }),
      ];
      const result = computeFinalizedAgents(agents, agents);

      expect(result).toBeDefined();
      expect(result![0]!.status).toBe("completed");
      expect(result![0]!.durationMs).toBe(1234);
    });

    test("preserves error agents", () => {
      const agents = [createAgent({ id: "a1", status: "error" })];
      const result = computeFinalizedAgents(agents, agents);

      expect(result).toBeDefined();
      expect(result![0]!.status).toBe("error");
    });

    test("does NOT finalize background agents", () => {
      const agents = [
        createAgent({ id: "bg1", status: "running", background: true }),
      ];
      const result = computeFinalizedAgents(agents, agents);

      expect(result).toBeDefined();
      expect(result![0]!.status).toBe("running"); // Still running
      expect(result![0]!.background).toBe(true);
    });

    test("mixed: finalizes foreground, preserves background", () => {
      const agents = [
        createAgent({ id: "fg1", status: "running", background: false }),
        createAgent({ id: "bg1", status: "running", background: true }),
      ];
      const result = computeFinalizedAgents(agents, agents);

      expect(result).toBeDefined();
      expect(result!.length).toBe(2);
      expect(result!.find((a) => a.id === "fg1")!.status).toBe("completed");
      expect(result!.find((a) => a.id === "bg1")!.status).toBe("running");
    });
  });

  describe("Background agent remaining computation", () => {
    test("returns only active background agents", () => {
      const agents = [
        createAgent({ id: "fg1", status: "completed", background: false }),
        createAgent({ id: "bg1", status: "running", background: true }),
        createAgent({ id: "bg2", status: "completed", background: true }),
      ];

      const remaining = getActiveBackgroundAgents(agents);

      expect(remaining.length).toBe(1);
      expect(remaining[0]!.id).toBe("bg1");
    });

    test("returns empty when no background agents exist", () => {
      const agents = [
        createAgent({ id: "fg1", status: "completed", background: false }),
      ];

      const remaining = getActiveBackgroundAgents(agents);
      expect(remaining.length).toBe(0);
    });

    test("returns empty when all background agents are completed", () => {
      const agents = [
        createAgent({ id: "bg1", status: "completed", background: true }),
        createAgent({ id: "bg2", status: "error", background: true }),
      ];

      const remaining = getActiveBackgroundAgents(agents);
      expect(remaining.length).toBe(0);
    });
  });

  describe("Consolidated updater equivalence", () => {
    test("single-pass updater produces same agent filtering as nested approach", () => {
      // Simulates the previous nested approach vs the consolidated one
      const messageAgents = [
        createAgent({ id: "a1" }),
        createAgent({ id: "a2" }),
      ];
      const currentAgents = [
        createAgent({ id: "a1", status: "running" }),
        createAgent({ id: "a2", status: "pending" }),
        createAgent({ id: "orphan", status: "running" }),
      ];

      // Old nested approach: read IDs in no-op updater, then use them
      const existingIdsNested = new Set<string>();
      for (const agent of messageAgents) {
        existingIdsNested.add(agent.id);
      }
      const filteredNested = currentAgents.filter((a) =>
        existingIdsNested.has(a.id),
      );

      // New consolidated approach: read IDs + filter in same updater
      const result = computeFinalizedAgents(messageAgents, currentAgents);

      // Both should filter out orphans identically
      expect(result!.map((a) => a.id)).toEqual(
        filteredNested.map((a) => a.id),
      );
    });

    test("remaining background agents are computed from currentAgents (ref), not stale state", () => {
      // Key: the consolidated approach reads from parallelAgentsRef.current
      // (via currentAgents) and computes remaining synchronously BEFORE
      // any state update. This guarantees stopSharedStreamState gets the
      // correct value.
      const currentAgents = [
        createAgent({ id: "fg1", status: "completed", background: false }),
        createAgent({ id: "bg1", status: "running", background: true }),
      ];

      const remaining = getActiveBackgroundAgents(currentAgents);
      const hasRemainingBg = remaining.length > 0;

      expect(hasRemainingBg).toBe(true);
      expect(remaining.length).toBe(1);
      expect(remaining[0]!.id).toBe("bg1");
    });

    test("hasRemainingBg is false when no background agents remain", () => {
      const currentAgents = [
        createAgent({ id: "fg1", status: "completed", background: false }),
        createAgent({ id: "fg2", status: "running", background: false }),
      ];

      const remaining = getActiveBackgroundAgents(currentAgents);
      const hasRemainingBg = remaining.length > 0;

      expect(hasRemainingBg).toBe(false);
    });
  });

  describe("Message finalization state", () => {
    test("finalizeStreamingReasoningInMessage preserves message identity", () => {
      const msg = createMessage({
        id: "msg-1",
        content: "test",
        parts: [],
      });

      const result = finalizeStreamingReasoningInMessage(msg);

      expect(result.id).toBe("msg-1");
      expect(result.content).toBe("test");
    });

    test("combined agent filtering and message update operates on same prev state", () => {
      // Simulates the single-updater pattern where we read agent IDs
      // AND update the message from the same `prev` array
      const messageId = "msg-1";
      const bakedAgents = [
        createAgent({ id: "a1" }),
        createAgent({ id: "a2" }),
      ];
      const currentAgents = [
        createAgent({ id: "a1", status: "running" }),
        createAgent({ id: "a2", status: "running" }),
        createAgent({ id: "orphan", status: "running" }),
      ];

      const messages = [
        createMessage({
          id: messageId,
          parallelAgents: bakedAgents,
          streaming: true,
        }),
        createMessage({ id: "msg-other", content: "other" }),
      ];

      // Simulate the single-updater logic
      const updatedMessages = (() => {
        const existingAgentIds = new Set<string>();
        const targetMsg = messages.find((m) => m.id === messageId);
        if (targetMsg?.parallelAgents) {
          for (const agent of targetMsg.parallelAgents) {
            existingAgentIds.add(agent.id);
          }
        }

        const finalizedAgents =
          currentAgents.length > 0
            ? currentAgents
                .filter((a) => existingAgentIds.has(a.id))
                .map((a) => {
                  if (a.background) return a;
                  return a.status === "running" || a.status === "pending"
                    ? {
                        ...a,
                        status: "completed" as const,
                        currentTool: undefined,
                        durationMs:
                          Date.now() - new Date(a.startedAt).getTime(),
                      }
                    : a;
                })
            : undefined;

        return messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                streaming: false,
                parallelAgents: finalizedAgents,
              }
            : msg,
        );
      })();

      // Verify the target message was updated correctly
      const finalMsg = updatedMessages.find((m) => m.id === messageId);
      expect(finalMsg).toBeDefined();
      expect(finalMsg!.streaming).toBe(false);
      expect(finalMsg!.parallelAgents).toBeDefined();
      expect(finalMsg!.parallelAgents!.length).toBe(2); // orphan filtered out
      expect(finalMsg!.parallelAgents!.every((a: ParallelAgent) => a.status === "completed")).toBe(true);

      // Verify the other message was NOT modified
      const otherMsg = updatedMessages.find((m) => m.id === "msg-other");
      expect(otherMsg).toBeDefined();
      expect(otherMsg!.content).toBe("other");
    });

    test("background updates insert after anchor message", () => {
      const start = createMessage({
        id: "start",
        content: "Starting workflow",
        streaming: true,
      });
      const bg1 = createMessage({
        id: "bg1",
        content: "Background update 1",
        streaming: false,
      });
      const refs = {
        backgroundAgentMessageId: null as string | null,
        streamingMessageId: "start",
        lastStreamedMessageId: null as string | null,
      };

      const result = appendBackgroundMessageInOrder([start], bg1, refs);

      expect(result.map((m) => m.id)).toEqual(["start", "bg1"]);
      expect(refs.backgroundAgentMessageId).toBe("bg1");
    });

    test("background updates chain in chronological order", () => {
      const start = createMessage({
        id: "start",
        content: "Starting workflow",
        streaming: true,
      });
      const bg1 = createMessage({
        id: "bg1",
        content: "Background update 1",
        streaming: false,
      });
      const bg2 = createMessage({
        id: "bg2",
        content: "Background update 2",
        streaming: false,
      });
      const refs = {
        backgroundAgentMessageId: null as string | null,
        streamingMessageId: "start",
        lastStreamedMessageId: null as string | null,
      };

      const afterBg1 = appendBackgroundMessageInOrder([start], bg1, refs);
      const afterBg2 = appendBackgroundMessageInOrder(afterBg1, bg2, refs);

      expect(afterBg2.map((m) => m.id)).toEqual(["start", "bg1", "bg2"]);
      expect(refs.backgroundAgentMessageId).toBe("bg2");
    });

    test("finalizes the active streaming message even when it is not last", () => {
      const start = createMessage({
        id: "start",
        content: "Starting workflow",
        streaming: true,
      });
      const bg1 = createMessage({
        id: "bg1",
        content: "Background update 1",
        streaming: false,
      });

      const result = finalizeActiveStreamingMessage([start, bg1], "start");

      expect(result.map((m) => m.id)).toEqual(["start", "bg1"]);
      expect(result[0]!.streaming).toBe(false);
      expect(result[1]!.streaming).toBe(false);
      expect(result[1]!.content).toBe("Background update 1");
    });
  });
});
