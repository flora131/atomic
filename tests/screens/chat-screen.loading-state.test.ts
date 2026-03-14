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
  test("stops loading indicator once live task progress reaches 100%", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: true },
        [
          { status: "completed" },
          { status: "completed" },
        ],
      ),
    ).toBe(false);
  });

  test("uses live streaming tasks when snapshot is stale", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: true,
          taskItems: [
            { status: "completed" },
            { status: "pending" },
          ],
        },
        [
          { status: "completed" },
          { status: "completed" },
        ],
      ),
    ).toBe(false);
  });

  test("keeps loading indicator for in-progress task rows", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: true },
        [
          { status: "completed" },
          { status: "in_progress" },
        ],
      ),
    ).toBe(true);
  });

  test("treats error rows as non-complete progress", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: true },
        [
          { status: "completed" },
          { status: "error" },
        ],
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
    expect(
      shouldShowMessageLoadingIndicator(
        {
          streaming: true,
          taskItems: [
            { status: "completed" },
            { status: "completed" },
          ],
        },
        [],
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
        [],
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
        undefined,
        2,
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
        undefined,
        1,
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
        undefined,
        0,
      ),
    ).toBe(false);
  });

  test("falls through to normal logic when activeBackgroundAgentCount is undefined", () => {
    expect(
      shouldShowMessageLoadingIndicator(
        { streaming: true },
        [{ status: "in_progress" }],
      ),
    ).toBe(true);
  });
});

describe("hasLiveLoadingIndicator", () => {
  test("stops the shared elapsed timer once all visible progress reaches completion", () => {
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
        [
          { status: "completed" },
          { status: "completed" },
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
        undefined,
        3,
      ),
    ).toBe(true);
  });

  test("stops the timer when activeBackgroundAgentCount is 0 and not streaming", () => {
    expect(
      hasLiveLoadingIndicator(
        [{ streaming: false }],
        undefined,
        0,
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

