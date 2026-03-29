import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import {
  getLoadingIndicatorText,
  hasLiveLoadingIndicator,
  isTaskProgressComplete,
  shouldShowCompletionSummary,
  shouldShowMessageLoadingIndicator,
} from "@/state/chat/shared/helpers/loading-state.ts";
import type { LoadingIndicatorTextContext } from "@/state/chat/shared/helpers/loading-state.ts";

const backgroundAgent: ParallelAgent = {
  id: "agent-1",
  name: "reviewer",
  task: "validate completion",
  status: "background",
  startedAt: new Date(0).toISOString(),
  background: true,
};

describe("isTaskProgressComplete", () => {
  test("returns true only when every task is completed", () => {
    expect(isTaskProgressComplete([
      { status: "completed" },
      { status: "completed" },
    ])).toBe(true);
  });

  test("returns false when tasks are missing or still active", () => {
    expect(isTaskProgressComplete(undefined)).toBe(false);
    expect(isTaskProgressComplete([])).toBe(false);
    expect(isTaskProgressComplete([
      { status: "completed" },
      { status: "in_progress" },
    ])).toBe(false);
  });
});

describe("shouldShowMessageLoadingIndicator", () => {
  test("keeps spinner while streaming even when live tasks reach 100%", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: true },
        {
          liveTodoItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
      ),
    ).toBe(true);
  });

  test("stops loading indicator once tasks reach 100% and stream has ended", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: false },
        {
          liveTodoItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
      ),
    ).toBe(false);
  });

  test("keeps spinner while streaming even when live tasks override stale snapshot", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: true,
          taskItems: [
            { status: "completed" },
            { status: "pending" },
          ],
        },
        {
          liveTodoItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
      ),
    ).toBe(true);
  });

  test("stops loading indicator once stream ends even when live tasks override stale snapshot", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: false,
          taskItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
      ),
    ).toBe(false);
  });

  test("keeps loading indicator for in-progress task rows", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: true },
        {
          liveTodoItems: [
            { status: "completed" },
            { status: "in_progress" },
          ],
        },
      ),
    ).toBe(true);
  });

  test("treats error rows as non-complete progress", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: true },
        {
          liveTodoItems: [
            { status: "completed" },
            { status: "error" },
          ],
        },
      ),
    ).toBe(true);
  });

  test("stops loading indicator once stream transitions to a terminal error state", () => {
    expect(
      shouldShowMessageLoadingIndicator({
        streaming: true,
        taskItems: [{ status: "in_progress" }],
      }),
    ).toBe(true);

    expect(
      shouldShowMessageLoadingIndicator({
        streaming: false,
        taskItems: [{ status: "error" }],
      }),
    ).toBe(false);
  });

  test("stops loading indicator for completed subagent/background snapshots", () => {
    expect(
      shouldShowMessageLoadingIndicator({
        streaming: false,
        parallelAgents: [backgroundAgent],
        taskItems: [
          { status: "completed" },
          { status: "completed" },
        ],
      }),
    ).toBe(false);
  });

  test("falls back to message task snapshot when live task rows are empty", () => {
    // Streaming takes priority — spinner stays visible even with completed snapshot tasks
    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: true,
          taskItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
        { liveTodoItems: [] },
      ),
    ).toBe(true);

    // Non-streaming with completed snapshot tasks — spinner hides
    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: false,
          taskItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
        { liveTodoItems: [] },
      ),
    ).toBe(false);

    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: true,
          taskItems: [
            { status: "completed" },
            { status: "pending" },
          ],
        },
        { liveTodoItems: [] },
      ),
    ).toBe(true);
  });

  test("keeps loading indicator for background work when progress is not complete", () => {
    expect(
      shouldShowMessageLoadingIndicator({
        streaming: false,
        parallelAgents: [backgroundAgent],
        taskItems: [
          { status: "completed" },
          { status: "pending" },
        ],
      }),
    ).toBe(true);
  });

  test("ignores non-background agents when deciding loading visibility", () => {
    const foregroundAgent: ParallelAgent = {
      ...backgroundAgent,
      id: "agent-foreground",
      background: false,
      status: "running",
    };

    expect(
      shouldShowMessageLoadingIndicator({
        streaming: false,
        parallelAgents: [foregroundAgent],
        taskItems: [
          { status: "completed" },
          { status: "completed" },
        ],
      }),
    ).toBe(false);
  });

  test("returns true when activeBackgroundAgentCount > 0 even if not streaming", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: false },
        { activeBackgroundAgentCount: 2 },
      ),
    ).toBe(true);
  });

  test("returns true when activeBackgroundAgentCount > 0 even if tasks are complete", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: false,
          taskItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
        { activeBackgroundAgentCount: 1 },
      ),
    ).toBe(true);
  });

  test("falls through to normal logic when activeBackgroundAgentCount is 0", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: false,
          taskItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
        { activeBackgroundAgentCount: 0 },
      ),
    ).toBe(false);
  });

  test("falls through to normal logic when activeBackgroundAgentCount is undefined", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: true },
        { liveTodoItems: [{ status: "in_progress" }] },
      ),
    ).toBe(true);
  });

  test("keeps spinner alive when keepAliveForWorkflow is true even if not streaming", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: false },
        { activeBackgroundAgentCount: 0, keepAliveForWorkflow: true },
      ),
    ).toBe(true);
  });

  test("keepAliveForWorkflow bridges the gap between workflow stages", () => {
    // Simulates the gap between stage N (finalized, streaming=false)
    // and stage N+1 (not yet created) during a workflow transition
    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: false,
          taskItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
        { activeBackgroundAgentCount: 0, keepAliveForWorkflow: true },
      ),
    ).toBe(true);
  });

  test("does not keep spinner alive when keepAliveForWorkflow is false", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: false },
        { activeBackgroundAgentCount: 0, keepAliveForWorkflow: false },
      ),
    ).toBe(false);
  });

  test("spinner hides after workflow completes (keepAliveForWorkflow cleared)", () => {
    // During workflow: keepAliveForWorkflow bridges the gap
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: false, taskItems: [{ status: "completed" }] },
        { keepAliveForWorkflow: true },
      ),
    ).toBe(true);

    // After workflow completes: keepAliveForWorkflow is cleared → spinner hides
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: false, taskItems: [{ status: "completed" }] },
        { keepAliveForWorkflow: false },
      ),
    ).toBe(false);
  });

  test("spinner hides after workflow errors mid-execution with error task status", () => {
    // Mid-execution error: stream ends, tasks in error state, workflow no longer active
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: false, taskItems: [{ status: "error" }] },
        { keepAliveForWorkflow: false },
      ),
    ).toBe(false);
  });

  test("spinner persists during workflow error while stream is still active", () => {
    // Error occurred but stream hasn't finalized yet
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: true, taskItems: [{ status: "error" }] },
        { keepAliveForWorkflow: true },
      ),
    ).toBe(true);
  });
});

describe("hasLiveLoadingIndicator", () => {
  test("keeps the shared elapsed timer while streaming even when tasks are complete", () => {
    expect(
      hasLiveLoadingIndicator(
        [
          {
            streaming: true,
            taskItems: [
              { status: "pending" },
              { status: "pending" },
            ],
          },
        ],
        {
          liveTodoItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
      ),
    ).toBe(true);
  });

  test("stops the shared elapsed timer once stream ends and all tasks are complete", () => {
    expect(
      hasLiveLoadingIndicator(
        [
          {
            streaming: false,
            taskItems: [
              { status: "completed" },
              { status: "completed" },
            ],
          },
        ],
      ),
    ).toBe(false);
  });

  test("keeps the shared elapsed timer running while any message is mixed/non-complete", () => {
    expect(
      hasLiveLoadingIndicator(
        [
          {
            streaming: true,
            taskItems: [
              { status: "completed" },
              { status: "completed" },
            ],
          },
          {
            streaming: true,
            taskItems: [
              { status: "completed" },
              { status: "in_progress" },
            ],
          },
        ],
      ),
    ).toBe(true);
  });

  test("treats active background snapshots as still-live timer work", () => {
    expect(
      hasLiveLoadingIndicator([
        {
          streaming: false,
          parallelAgents: [backgroundAgent],
          taskItems: [
            { status: "completed" },
            { status: "pending" },
          ],
        },
      ]),
    ).toBe(true);
  });

  test("returns false when messages are fully completed and no background work remains", () => {
    expect(
      hasLiveLoadingIndicator([
        {
          streaming: false,
          taskItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
      ]),
    ).toBe(false);
  });

  test("keeps the timer alive when activeBackgroundAgentCount > 0 even if not streaming", () => {
    expect(
      hasLiveLoadingIndicator(
        [{ streaming: false }],
        { activeBackgroundAgentCount: 3 },
      ),
    ).toBe(true);
  });

  test("stops the timer when activeBackgroundAgentCount is 0 and not streaming", () => {
    expect(
      hasLiveLoadingIndicator(
        [{ streaming: false }],
        { activeBackgroundAgentCount: 0 },
      ),
    ).toBe(false);
  });

  test("keeps the timer alive during workflow transitions via keepAliveForWorkflow on last message", () => {
    expect(
      hasLiveLoadingIndicator(
        [
          { streaming: false },
          { streaming: false },
        ],
        { activeBackgroundAgentCount: 0, keepAliveForWorkflow: true },
      ),
    ).toBe(true);
  });

  test("keepAliveForWorkflow only applies to the last message in the list", () => {
    // Single non-streaming message with keepAliveForWorkflow — it IS the last message
    expect(
      hasLiveLoadingIndicator(
        [{ streaming: false }],
        { activeBackgroundAgentCount: 0, keepAliveForWorkflow: true },
      ),
    ).toBe(true);

    // Not active when keepAliveForWorkflow is false
    expect(
      hasLiveLoadingIndicator(
        [{ streaming: false }],
        { activeBackgroundAgentCount: 0, keepAliveForWorkflow: false },
      ),
    ).toBe(false);
  });

  test("timer stops after workflow completes and keepAliveForWorkflow is cleared", () => {
    // Simulates post-workflow state: all messages finalized, workflow session ID cleared
    expect(
      hasLiveLoadingIndicator(
        [
          { streaming: false, taskItems: [{ status: "completed" }] },
          { streaming: false, taskItems: [{ status: "completed" }] },
        ],
        { activeBackgroundAgentCount: 0, keepAliveForWorkflow: false },
      ),
    ).toBe(false);
  });

  test("timer stops after workflow errors mid-execution", () => {
    // Workflow errored: stream ended, tasks in error state, keepAliveForWorkflow cleared
    expect(
      hasLiveLoadingIndicator(
        [
          { streaming: false, taskItems: [{ status: "completed" }] },
          { streaming: false, taskItems: [{ status: "error" }] },
        ],
        { activeBackgroundAgentCount: 0, keepAliveForWorkflow: false },
      ),
    ).toBe(false);
  });

  test("keepAliveForWorkflow does not apply to non-last messages with error tasks", () => {
    // Earlier message has error tasks, but keepAliveForWorkflow only applies to last
    expect(
      hasLiveLoadingIndicator(
        [
          { streaming: false, taskItems: [{ status: "error" }] },
          { streaming: false, taskItems: [{ status: "completed" }] },
        ],
        { activeBackgroundAgentCount: 0, keepAliveForWorkflow: false },
      ),
    ).toBe(false);
  });
});

describe("getLoadingIndicatorText", () => {
  function ctx(overrides: Partial<LoadingIndicatorTextContext> = {}): LoadingIndicatorTextContext {
    return {
      isStreaming: false,
      ...overrides,
    };
  }

  // --- Priority 1: verbOverride always wins ---

  test("returns verbOverride when provided, regardless of other state", () => {
    expect(getLoadingIndicatorText(ctx({ verbOverride: "Compacting" }))).toBe("Compacting");
  });

  test("returns verbOverride even when streaming with thinking", () => {
    expect(
      getLoadingIndicatorText(ctx({
        verbOverride: "Compacting",
        isStreaming: true,
        thinkingMs: 5000,
      })),
    ).toBe("Compacting");
  });

  // --- Priority 2: Default verb based on thinking state ---

  test("returns 'Reasoning' when thinkingMs > 0", () => {
    expect(
      getLoadingIndicatorText(ctx({ isStreaming: true, thinkingMs: 1500 })),
    ).toBe("Reasoning");
  });

  test("returns 'Composing' as default fallback", () => {
    expect(getLoadingIndicatorText(ctx({ isStreaming: true }))).toBe("Composing");
  });

  test("returns 'Composing' when thinkingMs is 0", () => {
    expect(
      getLoadingIndicatorText(ctx({ isStreaming: true, thinkingMs: 0 })),
    ).toBe("Composing");
  });

  test("returns 'Composing' when thinkingMs is undefined", () => {
    expect(
      getLoadingIndicatorText(ctx({ isStreaming: true, thinkingMs: undefined })),
    ).toBe("Composing");
  });

  test("returns 'Composing' when not streaming", () => {
    expect(getLoadingIndicatorText(ctx())).toBe("Composing");
  });
});

describe("shouldShowCompletionSummary", () => {
  // --- Base case: all conditions met ---

  test("returns true when stream finished, no bg agents, and duration >= 1000ms", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 2500, wasInterrupted: false },
        false,
      ),
    ).toBe(true);
  });

  test("returns true at exact 1000ms boundary", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 1000 },
        false,
      ),
    ).toBe(true);
  });

  // --- Defers when streaming ---

  test("returns false while still streaming", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: true, durationMs: 5000 },
        false,
      ),
    ).toBe(false);
  });

  // --- Defers when interrupted ---

  test("returns false when stream was interrupted", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 5000, wasInterrupted: true },
        false,
      ),
    ).toBe(false);
  });

  // --- Duration thresholds ---

  test("returns false when durationMs is below 1000", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 999 },
        false,
      ),
    ).toBe(false);
  });

  test("returns false when durationMs is undefined", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false },
        false,
      ),
    ).toBe(false);
  });

  // --- Background agents via hasActiveBackgroundAgents flag ---

  test("returns false when hasActiveBackgroundAgents is true", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 5000 },
        true,
      ),
    ).toBe(false);
  });

  // --- Background agents via activeBackgroundAgentCount (bus-event count) ---

  test("returns false when activeBackgroundAgentCount > 0 even if all other conditions pass", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 5000, wasInterrupted: false },
        false,
        2,
      ),
    ).toBe(false);
  });

  test("returns false when activeBackgroundAgentCount is 1", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 3000 },
        false,
        1,
      ),
    ).toBe(false);
  });

  test("activeBackgroundAgentCount takes priority over hasActiveBackgroundAgents=false", () => {
    // Even though the flag says no bg agents, the external count overrides
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 5000 },
        false,
        3,
      ),
    ).toBe(false);
  });

  // --- Falls through when activeBackgroundAgentCount is 0 or undefined ---

  test("falls through to normal logic when activeBackgroundAgentCount is 0", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 2000 },
        false,
        0,
      ),
    ).toBe(true);
  });

  test("falls through to normal logic when activeBackgroundAgentCount is undefined", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 2000 },
        false,
      ),
    ).toBe(true);
  });

  // --- Combined edge cases ---

  test("returns false when both hasActiveBackgroundAgents and activeBackgroundAgentCount indicate bg work", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: false, durationMs: 5000 },
        true,
        2,
      ),
    ).toBe(false);
  });

  test("returns false when streaming even with activeBackgroundAgentCount=0", () => {
    expect(
      shouldShowCompletionSummary(
        { streaming: true, durationMs: 5000 },
        false,
        0,
      ),
    ).toBe(false);
  });
});

