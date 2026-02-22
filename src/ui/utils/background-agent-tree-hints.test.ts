import { describe, expect, test } from "bun:test";
import { buildParallelAgentsHeaderHint } from "./background-agent-tree-hints.ts";

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
    ).toBe("background running · ctrl+f terminate");
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
    ).toBe("background running · ctrl+f terminate");
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
    ).toBe("background complete · ctrl+o to expand");
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
    ).toBe("ctrl+o to expand");
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
    ).toBe("ctrl+o to expand");
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
    ).toBe("background running · ctrl+f terminate");
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
});
