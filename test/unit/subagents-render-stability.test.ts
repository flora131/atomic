import { afterEach, describe, test } from "bun:test";
import assert from "node:assert/strict";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  buildWidgetLines,
  clearLegacyResultAnimationTimer,
  currentRunningFrame,
  renderSubagentResult,
  RUNNING_ANIMATION_MS,
  stopResultAnimations,
  syncResultAnimation,
  widgetRenderKey,
} from "../../packages/subagents/src/tui/render.js";
import type { AsyncJobState, Details } from "../../packages/subagents/src/shared/types.js";

type RenderTheme = Parameters<typeof renderSubagentResult>[2];

const theme = {
  fg: (_name: string, value: string) => value,
  bg: (_name: string, value: string) => value,
  bold: (value: string) => value,
} as unknown as RenderTheme;

// Braille spinner frames used by the running glyph. Kept in sync with render.ts.
const RUNNING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_CHARS = new Set(RUNNING_FRAMES);

function withMockedNow<T>(now: number, run: () => T): T {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return run();
  } finally {
    Date.now = originalNow;
  }
}

function stripSpinnerChars(line: string): string {
  return [...line].filter((char) => !SPINNER_CHARS.has(char)).join("");
}

function runningSingleResult(): AgentToolResult<Details> {
  return {
    content: [{ type: "text", text: "running" }],
    details: {
      mode: "single",
      results: [{
        agent: "worker",
        task: "do work",
        exitCode: 0,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
        progress: {
          agent: "worker",
          index: 0,
          status: "running",
          task: "do work",
          durationMs: 2_000,
          toolCount: 1,
          tokens: 10,
          recentTools: [],
          recentOutput: [],
        },
      }],
    },
  };
}

describe("subagent running spinner animation (issue #1084)", () => {
  afterEach(() => {
    stopResultAnimations();
  });

  test("running glyph advances with wall clock (no longer frozen)", () => {
    const result = runningSingleResult();

    // Two renders exactly one animation frame apart must differ: the spinner
    // is driven by wall-clock time, not by progress data changes.
    const first = withMockedNow(10_000, () => renderSubagentResult(result, { expanded: false }, theme).render(120).join("\n"));
    const second = withMockedNow(10_000 + RUNNING_ANIMATION_MS, () => renderSubagentResult(result, { expanded: false }, theme).render(120).join("\n"));

    assert.notEqual(second, first, "running spinner should advance after one animation interval");
  });

  // NOTE: this invariant assumes the render path only consults Date.now() for
  // time (which the tests mock). If elapsed-time labels ever start reading
  // performance.now()/process.uptime(), this assertion would start to drift.
  test("renders within the same animation frame are identical (deterministic, no churn)", () => {
    const result = runningSingleResult();
    const frameStart = 10_000;

    const a = withMockedNow(frameStart, () => renderSubagentResult(result, { expanded: false }, theme).render(120).join("\n"));
    const b = withMockedNow(frameStart + RUNNING_ANIMATION_MS - 1, () => renderSubagentResult(result, { expanded: false }, theme).render(120).join("\n"));

    assert.equal(b, a, "renders inside the same animation frame must be byte-identical");
  });

  test("consecutive frames differ only in spinner glyph cells (minimal diff = no flicker)", () => {
    const result = runningSingleResult();

    const firstLines = withMockedNow(10_000, () => renderSubagentResult(result, { expanded: false }, theme).render(120));
    const secondLines = withMockedNow(10_000 + RUNNING_ANIMATION_MS, () => renderSubagentResult(result, { expanded: false }, theme).render(120));

    assert.equal(firstLines.length, secondLines.length, "line count must stay stable across animation frames");

    let changedLines = 0;
    for (let i = 0; i < firstLines.length; i++) {
      if (firstLines[i] === secondLines[i]) continue;
      changedLines++;
      // The only thing that may change between frames is the spinner glyph.
      assert.equal(
        stripSpinnerChars(firstLines[i]!),
        stripSpinnerChars(secondLines[i]!),
        `line ${i} changed in non-spinner content between animation frames`,
      );
    }
    assert.ok(changedLines > 0, "expected at least one spinner line to animate");
  });

  test("running glyph cycles through every frame over a full period", () => {
    const result = runningSingleResult();
    const seen = new Set<string>();
    const base = 0;
    for (let frame = 0; frame < RUNNING_FRAMES.length; frame++) {
      const out = withMockedNow(base + frame * RUNNING_ANIMATION_MS, () =>
        renderSubagentResult(result, { expanded: false }, theme).render(120).join("\n"));
      for (const char of out) if (SPINNER_CHARS.has(char)) seen.add(char);
    }
    assert.equal(seen.size, RUNNING_FRAMES.length, "spinner should visit every frame across one full period");
  });

  test("async widget spinner advances with wall clock for running jobs", () => {
    const job: AsyncJobState = {
      asyncId: "abc123",
      asyncDir: "/tmp/abc123",
      status: "running",
      mode: "single",
      agents: ["worker"],
      updatedAt: 10_000,
      lastActivityAt: 10_000,
      toolCount: 1,
      turnCount: 2,
    };
    const first = withMockedNow(10_000, () => buildWidgetLines([job], theme, 120).join("\n"));
    const second = withMockedNow(10_000 + RUNNING_ANIMATION_MS, () => buildWidgetLines([job], theme, 120).join("\n"));
    assert.notEqual(second, first, "running async widget spinner should animate over wall-clock time");
  });

  test("currentRunningFrame advances one step per animation interval", () => {
    const f0 = currentRunningFrame(1_000_000);
    const f1 = currentRunningFrame(1_000_000 + RUNNING_ANIMATION_MS);
    const fSame = currentRunningFrame(1_000_000 + RUNNING_ANIMATION_MS - 1);
    assert.equal(f1 - f0, 1);
    assert.equal(fSame, f0);
  });
});

describe("subagent result animation timer lifecycle", () => {
  afterEach(() => {
    stopResultAnimations();
  });

  test("starts an invalidate ticker for running results and is idempotent", () => {
    const context = { state: {} as { subagentResultAnimationTimer?: ReturnType<typeof setInterval> }, invalidate: () => {} };

    syncResultAnimation(runningSingleResult(), context);
    const timer = context.state.subagentResultAnimationTimer;
    assert.ok(timer, "expected a running result to start an animation timer");

    // Calling again with a still-running result must not spawn a second timer.
    syncResultAnimation(runningSingleResult(), context);
    assert.equal(context.state.subagentResultAnimationTimer, timer, "timer should be reused while still running");
  });

  test("stops the ticker when the result is no longer running", () => {
    const context = { state: {} as { subagentResultAnimationTimer?: ReturnType<typeof setInterval> }, invalidate: () => {} };
    syncResultAnimation(runningSingleResult(), context);
    assert.ok(context.state.subagentResultAnimationTimer);

    const finished: AgentToolResult<Details> = {
      content: [{ type: "text", text: "done" }],
      details: {
        mode: "single",
        results: [{
          agent: "worker",
          task: "do work",
          exitCode: 0,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
          progress: {
            agent: "worker",
            index: 0,
            status: "completed",
            task: "do work",
            durationMs: 2_000,
            toolCount: 1,
            tokens: 10,
            recentTools: [],
            recentOutput: [],
          },
        }],
      },
    };
    syncResultAnimation(finished, context);
    assert.equal(context.state.subagentResultAnimationTimer, undefined, "completed result must stop the animation timer");
  });

  test("re-sync refreshes the invalidate callback used by the ticker", async () => {
    let firstCalls = 0;
    let secondCalls = 0;
    const state = {} as { subagentResultAnimationTimer?: ReturnType<typeof setInterval> };
    syncResultAnimation(runningSingleResult(), { state, invalidate: () => firstCalls++ });
    const timer = state.subagentResultAnimationTimer;
    // Re-sync with the same (stable) state object but a fresh invalidate closure,
    // mirroring the host handing us a new render context for the same renderable.
    syncResultAnimation(runningSingleResult(), { state, invalidate: () => secondCalls++ });
    assert.equal(state.subagentResultAnimationTimer, timer, "timer should be reused across re-sync");
    await new Promise((resolve) => setTimeout(resolve, RUNNING_ANIMATION_MS * 3 + 40));
    stopResultAnimations();
    assert.equal(firstCalls, 0, "stale invalidate must not be called after re-sync");
    assert.ok(secondCalls >= 1, `refreshed invalidate should fire, saw ${secondCalls}`);
  });

  test("invokes invalidate on each animation tick", async () => {
    let ticks = 0;
    const context = {
      state: {} as { subagentResultAnimationTimer?: ReturnType<typeof setInterval> },
      invalidate: () => {
        ticks++;
      },
    };
    syncResultAnimation(runningSingleResult(), context);
    await new Promise((resolve) => setTimeout(resolve, RUNNING_ANIMATION_MS * 3 + 40));
    stopResultAnimations();
    assert.ok(ticks >= 1, `expected the animation ticker to fire at least once, saw ${ticks}`);
  });

  test("stopResultAnimations clears all timers", () => {
    const context = { state: {} as { subagentResultAnimationTimer?: ReturnType<typeof setInterval> }, invalidate: () => {} };
    syncResultAnimation(runningSingleResult(), context);
    assert.ok(context.state.subagentResultAnimationTimer);
    stopResultAnimations();
    assert.equal(context.state.subagentResultAnimationTimer, undefined);
  });
});

describe("subagent render stability invariants", () => {
  afterEach(() => {
    stopResultAnimations();
  });

  test("widget render key is stable when only wall clock changes", () => {
    const job: AsyncJobState = {
      asyncId: "abc123",
      asyncDir: "/tmp/abc123",
      status: "running",
      mode: "single",
      agents: ["worker"],
      updatedAt: 10_000,
      toolCount: 1,
      turnCount: 2,
    };

    const first = withMockedNow(10_000, () => widgetRenderKey(job));
    const second = withMockedNow(10_080, () => widgetRenderKey(job));

    assert.equal(second, first);
  });

  test("clears legacy result animation timers", () => {
    let fired = false;
    const timer = setInterval(() => {
      fired = true;
    }, 10_000);
    const context: { state: { subagentResultAnimationTimer?: ReturnType<typeof setInterval> } } = {
      state: { subagentResultAnimationTimer: timer },
    };

    clearLegacyResultAnimationTimer(context);

    assert.equal(context.state.subagentResultAnimationTimer, undefined);
    assert.equal(fired, false);
  });
});
