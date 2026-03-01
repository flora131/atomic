import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "./components/parallel-agents-tree.tsx";
import {
  hasLiveLoadingIndicator,
  isTaskProgressComplete,
  shouldShowMessageLoadingIndicator,
} from "./utils/loading-state.ts";

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
});

