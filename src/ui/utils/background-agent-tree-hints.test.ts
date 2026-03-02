import { describe, expect, test } from "bun:test";
import { buildParallelAgentsHeaderHint } from "./background-agent-tree-hints.ts";
import { BACKGROUND_TREE_HINT_CONTRACT } from "./background-agent-contracts.ts";

describe("background agent tree hints", () => {
  test("shows Ctrl+F terminate hint for active background agents", () => {
    expect(
      buildParallelAgentsHeaderHint(
        [
          {
            background: true,
            status: "running",
          },
        ],
        false,
      ),
    ).toBe(BACKGROUND_TREE_HINT_CONTRACT.whenRunning);
  });

  test("prioritizes running hint over expand hint when background work is active", () => {
    expect(
      buildParallelAgentsHeaderHint(
        [
          {
            background: true,
            status: "pending",
          },
        ],
        true,
      ),
    ).toBe(BACKGROUND_TREE_HINT_CONTRACT.whenRunning);
  });

  test("shows completion hint for completed background agents when tree is idle", () => {
    expect(
      buildParallelAgentsHeaderHint(
        [
          {
            background: true,
            status: "completed",
          },
        ],
        true,
      ),
    ).toBe(BACKGROUND_TREE_HINT_CONTRACT.whenComplete);
  });

  test("keeps default expand hint when no background agents exist", () => {
    expect(
      buildParallelAgentsHeaderHint(
        [
          {
            status: "completed",
          },
        ],
        true,
      ),
    ).toBe(BACKGROUND_TREE_HINT_CONTRACT.defaultHint);
  });

  test("does not show terminate wording for foreground-only running agents", () => {
    expect(
      buildParallelAgentsHeaderHint(
        [
          {
            background: false,
            status: "running",
          },
        ],
        true,
      ),
    ).toBe(BACKGROUND_TREE_HINT_CONTRACT.defaultHint);
  });

  test("recognizes legacy background status without explicit background flag", () => {
    expect(
      buildParallelAgentsHeaderHint(
        [
          {
            status: "background",
          },
        ],
        false,
      ),
    ).toBe(BACKGROUND_TREE_HINT_CONTRACT.whenRunning);
  });

  test("stays quiet when no hint should be shown", () => {
    expect(
      buildParallelAgentsHeaderHint(
        [
          {
            background: true,
            status: "completed",
          },
        ],
        false,
      ),
    ).toBe("");
  });

  test("contract constants define expected canonical hint strings", () => {
    expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toBe("background running · ctrl+f to kill all background tasks");
    expect(BACKGROUND_TREE_HINT_CONTRACT.whenComplete).toBe("background complete · ctrl+o to expand");
    expect(BACKGROUND_TREE_HINT_CONTRACT.defaultHint).toBe("ctrl+o to expand");
  });
});
