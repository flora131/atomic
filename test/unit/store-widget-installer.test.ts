/**
 * Unit tests for store-widget-installer.
 * Tests: installStoreWidget (setWidget calls), installToolExecutionHooks (event subscriptions).
 * cross-ref: spec §5.4.4, §5.4.6, §5.5, §8.1 Phase E
 */

import { beforeEach, describe, test } from "bun:test";
import assert from "node:assert/strict";
import { installStoreWidget, installToolExecutionHooks } from "../../packages/workflows/src/tui/store-widget-installer.js";
import { createStore } from "../../packages/workflows/src/shared/store.js";
import type { Store } from "../../packages/workflows/src/shared/store.js";
import type { RunSnapshot, StageSnapshot } from "../../packages/workflows/src/shared/store-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(id: string, name: string): RunSnapshot {
  return {
    id,
    name,
    inputs: {},
    status: "running",
    stages: [],
    startedAt: Date.now(),
  };
}

function makeStage(id: string, name: string): StageSnapshot {
  return {
    id,
    name,
    status: "running",
    parentIds: [],
    toolEvents: [],
  };
}

// ---------------------------------------------------------------------------
// Mock pi API
// ---------------------------------------------------------------------------

interface SetWidgetCall {
  key: string;
  factory: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
  opts: { placement?: string } | undefined;
}

interface FakeTimerHandle {
  id: number;
  unrefCalls: number;
  unref(): void;
}

function makeFakeTimers(): {
  setTimeout: (handler: () => void, delayMs: number) => FakeTimerHandle;
  clearTimeout: (handle: FakeTimerHandle) => void;
  scheduled: Array<{ handle: FakeTimerHandle; handler: () => void; delayMs: number; cleared: boolean }>;
} {
  let nextId = 1;
  const scheduled: Array<{ handle: FakeTimerHandle; handler: () => void; delayMs: number; cleared: boolean }> = [];
  return {
    scheduled,
    setTimeout(handler: () => void, delayMs: number): FakeTimerHandle {
      const handle: FakeTimerHandle = {
        id: nextId++,
        unrefCalls: 0,
        unref() {
          this.unrefCalls += 1;
        },
      };
      scheduled.push({ handle, handler, delayMs, cleared: false });
      return handle;
    },
    clearTimeout(handle: FakeTimerHandle): void {
      const timer = scheduled.find((entry) => entry.handle === handle);
      if (timer) timer.cleared = true;
    },
  };
}

function makeMockPi(): {
  pi: {
    ui: {
      setWidget: (
        key: string,
        factory: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined,
        opts?: { placement?: string },
      ) => void;
      requestRender: () => void;
    };
    on: (event: string, handler: (payload: unknown) => void) => void;
    events: {
      on: (event: string, handler: (payload: unknown) => void) => void;
    };
  };
  widgetCalls: SetWidgetCall[];
  eventHandlers: Map<string, (payload: unknown) => void>;
  extensionHandlers: Map<string, (payload: unknown) => void>;
  renderRequests: { count: number };
} {
  const widgetCalls: SetWidgetCall[] = [];
  const eventHandlers: Map<string, (payload: unknown) => void> = new Map();
  const extensionHandlers: Map<string, (payload: unknown) => void> = new Map();
  const renderRequests = { count: 0 };

  const pi = {
    ui: {
      setWidget(
        key: string,
        factory: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined,
        opts?: { placement?: string },
      ): void {
        widgetCalls.push({ key, factory, opts });
      },
      requestRender(): void {
        renderRequests.count++;
      },
    },
    on(event: string, handler: (payload: unknown) => void): void {
      extensionHandlers.set(event, handler);
    },
    events: {
      on(event: string, handler: (payload: unknown) => void): void {
        eventHandlers.set(event, handler);
      },
    },
  };

  return { pi, widgetCalls, eventHandlers, extensionHandlers, renderRequests };
}

// ---------------------------------------------------------------------------
// installStoreWidget
// ---------------------------------------------------------------------------

describe("installStoreWidget", () => {
  let storeInstance: Store;

  beforeEach(() => {
    storeInstance = createStore();
  });

  test("clears the widget when there are no active runs", () => {
    const { pi, widgetCalls } = makeMockPi();
    installStoreWidget(pi, storeInstance);
    assert.equal(widgetCalls.length, 1);
    assert.equal(widgetCalls[0]!.key, "workflow.run");
    assert.equal(widgetCalls[0]!.factory, undefined);
  });

  test("re-calls setWidget with a fresh factory when a run starts", () => {
    const { pi, widgetCalls } = makeMockPi();
    installStoreWidget(pi, storeInstance);
    const before = widgetCalls.length;
    storeInstance.recordRunStart(makeRun("r1", "my-wf"));
    const newCalls = widgetCalls.slice(before);
    const factoryCall = newCalls.find((c) => typeof c.factory === "function");
    assert.ok(factoryCall, "expected at least one setWidget(factory) call");
    assert.equal(factoryCall.key, "workflow.run");
    assert.deepEqual(factoryCall.opts, { placement: "aboveEditor" });
  });

  test("factory builds a Container with Text lines that include the workflow name", () => {
    const { pi, widgetCalls } = makeMockPi();
    installStoreWidget(pi, storeInstance);
    storeInstance.recordRunStart(makeRun("r1", "my-wf"));
    const factoryCall = widgetCalls.findLast((c) => typeof c.factory === "function")!;
    const component = factoryCall.factory!(null, null) as { render(w: number): string[] };
    const lines = component.render(120);
    assert.ok(lines.length > 0);
    assert.ok(lines.some((l) => l.includes("my-wf")));
  });

  test("factory reflows the widget against the host render width", () => {
    const { pi, widgetCalls } = makeMockPi();
    installStoreWidget(pi, storeInstance);
    storeInstance.recordRunStart(makeRun("r1", "my-wf"));
    const factoryCall = widgetCalls.findLast((c) => typeof c.factory === "function")!;
    const component = factoryCall.factory!(null, undefined) as { render(w: number): string[] };

    const narrowLines = component.render(60);

    assert.deepEqual(narrowLines, [" ▾  1 background · 1 ●"]);
  });

  test("requests a render after each setWidget so pi flushes the change", () => {
    const { pi, widgetCalls, renderRequests } = makeMockPi();
    installStoreWidget(pi, storeInstance);
    const beforeRequests = renderRequests.count;
    storeInstance.recordRunStart(makeRun("r1", "my-wf"));
    assert.ok(renderRequests.count > beforeRequests, "expected requestRender on store mutation");
    assert.ok(widgetCalls.length >= 2, "expected setWidget to be re-issued");
  });

  test("refreshes immediately when a stage starts awaiting human input", () => {
    const { pi, widgetCalls, renderRequests } = makeMockPi();
    installStoreWidget(pi, storeInstance);
    const run = makeRun("r1", "my-wf");
    (run.stages as StageSnapshot[]).push(makeStage("s1", "ask"));
    storeInstance.recordRunStart(run);
    const beforeCalls = widgetCalls.length;
    const beforeRequests = renderRequests.count;

    storeInstance.recordStageAwaitingInput("r1", "s1", true);

    assert.ok(widgetCalls.length > beforeCalls, "expected widget to be re-issued for awaiting input");
    assert.ok(renderRequests.count > beforeRequests, "expected repaint for awaiting input");
    const last = widgetCalls[widgetCalls.length - 1]!;
    const component = last.factory!(null, undefined) as { render(w: number): string[] };
    assert.match(component.render(120).join("\n"), /● 1 running\s+↵ 1 needs attention/);
  });

  test("refreshes immediately when a run fails", () => {
    const { pi, widgetCalls, renderRequests } = makeMockPi();
    installStoreWidget(pi, storeInstance);
    const run = makeRun("r1", "my-wf");
    (run.stages as StageSnapshot[]).push(makeStage("s1", "fail"));
    storeInstance.recordRunStart(run);
    const beforeCalls = widgetCalls.length;
    const beforeRequests = renderRequests.count;

    storeInstance.recordRunEnd("r1", "failed", undefined, "boom");

    assert.ok(widgetCalls.length > beforeCalls, "expected widget to be re-issued for failed run");
    assert.ok(renderRequests.count > beforeRequests, "expected repaint for failed run");
    const last = widgetCalls[widgetCalls.length - 1]!;
    const component = last.factory!(null, undefined) as { render(w: number): string[] };
    const rendered = component.render(120).join("\n");
    assert.match(rendered, /✗ 1/);
    assert.match(rendered, /failed · 0s/);
    assert.doesNotMatch(rendered, /ago/);
  });

  test("keeps the widget installed for recently-ended runs", () => {
    const { pi, widgetCalls } = makeMockPi();
    installStoreWidget(pi, storeInstance);
    storeInstance.recordRunStart(makeRun("r1", "my-wf"));
    storeInstance.recordRunEnd("r1", "completed");

    const last = widgetCalls[widgetCalls.length - 1]!;
    assert.equal(typeof last.factory, "function");
    const component = last.factory!(null, undefined) as { render(w: number): string[] };
    const lines = component.render(120);
    assert.ok(lines.some((line) => line.includes("my-wf")));
    assert.ok(lines.some((line) => line.includes("complete")));
  });

  test("refreshes the visible widget from a timer while an active run is idle", () => {
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      const timers = makeFakeTimers();
      const { pi, widgetCalls, renderRequests } = makeMockPi();
      installStoreWidget(pi, storeInstance, timers);
      storeInstance.recordRunStart(makeRun("r1", "my-wf"));
      const callsAfterStart = widgetCalls.length;
      const requestsAfterStart = renderRequests.count;
      const timer = timers.scheduled.findLast((entry) => !entry.cleared);
      assert.ok(timer, "expected active widget refresh timer");
      assert.ok(timer.delayMs > 0 && timer.delayMs <= 1_000);

      now += timer.delayMs;
      timer.handler();

      assert.ok(widgetCalls.length > callsAfterStart, "expected timer to re-issue the widget");
      assert.ok(renderRequests.count > requestsAfterStart, "expected timer to request render");
    } finally {
      Date.now = originalNow;
    }
  });

  test("clears the widget after recently-ended runs become stale without user interaction", () => {
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      const timers = makeFakeTimers();
      const { pi, widgetCalls } = makeMockPi();
      installStoreWidget(pi, storeInstance, timers);
      storeInstance.recordRunStart(makeRun("r1", "my-wf"));
      storeInstance.recordRunEnd("r1", "completed");
      assert.equal(typeof widgetCalls[widgetCalls.length - 1]!.factory, "function");

      const timer = timers.scheduled.findLast((entry) => !entry.cleared);
      assert.ok(timer, "expected recent-ended widget refresh timer");
      assert.ok(timer.delayMs > 29_000, "terminal-only widget should refresh near expiry, not every second");

      now += 31_000;
      timer.handler();

      const last = widgetCalls[widgetCalls.length - 1]!;
      assert.equal(last.factory, undefined);
    } finally {
      Date.now = originalNow;
    }
  });

  test("does not schedule a second-boundary refresh for fully paused runs", () => {
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      const timers = makeFakeTimers();
      const { pi } = makeMockPi();
      installStoreWidget(pi, storeInstance, timers);
      const run = makeRun("r1", "my-wf");
      run.status = "paused";
      run.pausedAt = now - 5_000;
      storeInstance.recordRunStart(run);

      const timer = timers.scheduled.findLast((entry) => !entry.cleared);
      assert.equal(timer, undefined);
    } finally {
      Date.now = originalNow;
    }
  });

  test("clears a scheduled widget refresh timer on dispose", () => {
    const timers = makeFakeTimers();
    const { pi } = makeMockPi();
    const unsubscribe = installStoreWidget(pi, storeInstance, timers);
    storeInstance.recordRunStart(makeRun("r1", "my-wf"));

    const timer = timers.scheduled.findLast((entry) => !entry.cleared);
    assert.ok(timer, "expected refresh timer before dispose");
    unsubscribe();

    assert.equal(timer.cleared, true);
  });

  test("returns disposer that removes the widget", () => {
    const { pi, widgetCalls } = makeMockPi();
    const unsubscribe = installStoreWidget(pi, storeInstance);
    const before = widgetCalls.length;
    unsubscribe();
    const last = widgetCalls[widgetCalls.length - 1]!;
    assert.ok(widgetCalls.length > before);
    assert.equal(last.factory, undefined);
  });

  test("no crash when pi.ui is absent", () => {
    const piNoUI: { ui?: undefined; events?: undefined } = {};
    const storeNoUI = createStore();
    assert.doesNotThrow(() => installStoreWidget(piNoUI, storeNoUI));
  });

  test("no crash when pi.ui.setWidget is absent", () => {
    const piNoSetWidget = { ui: {} };
    const storeNoWidget = createStore();
    assert.doesNotThrow(() => installStoreWidget(piNoSetWidget, storeNoWidget));
  });

  test("uses a low-frequency clock timer, not a high-frequency spinner timer", () => {
    // Regression: the widget used to keep an 80ms setInterval re-issuing
    // setWidget so the braille spinner glyph could advance. The glyph is
    // static now; elapsed-time labels use one-shot second-boundary refreshes.
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      const timers = makeFakeTimers();
      const { pi } = makeMockPi();
      const unsubscribe = installStoreWidget(pi, storeInstance, timers);
      const run = makeRun("r1", "my-wf");
      (run.stages as StageSnapshot[]).push(makeStage("s1", "stage-1"));
      storeInstance.recordRunStart(run);

      const timer = timers.scheduled.findLast((entry) => !entry.cleared);
      assert.ok(timer, "expected clock refresh timer");
      assert.equal(timer.delayMs, 1_000);
      assert.equal(timer.handle.unrefCalls, 1);
      unsubscribe();
    } finally {
      Date.now = originalNow;
    }
  });
});

// ---------------------------------------------------------------------------
// installToolExecutionHooks
// ---------------------------------------------------------------------------

describe("installToolExecutionHooks", () => {
  let storeInstance: Store;

  beforeEach(() => {
    storeInstance = createStore();
    const run = makeRun("r1", "my-wf");
    storeInstance.recordRunStart(run);
    storeInstance.recordStageStart("r1", makeStage("s1", "scout"));
  });

  test("no crash when pi.events is absent", () => {
    const piNoEvents: { ui?: undefined; events?: undefined } = {};
    assert.doesNotThrow(() => installToolExecutionHooks(piNoEvents, storeInstance));
  });

  test("no crash when pi.events.on is absent", () => {
    const piNoOn = { events: {} };
    assert.doesNotThrow(() => installToolExecutionHooks(piNoOn, storeInstance));
  });

  test("subscribes to tool_execution_start, _update, _end", () => {
    const { pi, eventHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);
    assert.equal(eventHandlers.has("tool_execution_start"), true);
    assert.equal(eventHandlers.has("tool_execution_update"), true);
    assert.equal(eventHandlers.has("tool_execution_end"), true);
  });

  test("subscribes to pi extension tool events", () => {
    const { pi, extensionHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);
    assert.equal(extensionHandlers.has("tool_execution_start"), true);
    assert.equal(extensionHandlers.has("tool_execution_update"), true);
    assert.equal(extensionHandlers.has("tool_execution_end"), true);
    assert.equal(extensionHandlers.has("tool_call"), true);
    assert.equal(extensionHandlers.has("tool_result"), true);
  });

  test("tool_execution_start records tool on active stage (fallback heuristic)", () => {
    const { pi, eventHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);

    const handler = eventHandlers.get("tool_execution_start")!;
    handler({ toolName: "bash", input: { cmd: "ls" }, ts: Date.now() });

    const snap = storeInstance.snapshot();
    const run = snap.runs.find((r) => r.id === "r1")!;
    const stage = run.stages.find((s) => s.id === "s1")!;
    assert.equal(stage.toolEvents.length, 1);
    assert.equal(stage.toolEvents[0]!.name, "bash");
  });

  test("tool_execution_start preserves SDK args for orchestrator tool UI", () => {
    const { pi, eventHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);

    const handler = eventHandlers.get("tool_execution_start")!;
    handler({ toolName: "bash", args: { command: "echo hi" }, ts: Date.now() });

    const stage = storeInstance.snapshot().runs[0]!.stages[0]!;
    assert.deepEqual(stage.toolEvents[0]!.input, { command: "echo hi" });
  });

  test("tool_execution_start with explicit runId+stageId routes correctly", () => {
    // Add a second stage
    storeInstance.recordStageStart("r1", makeStage("s2", "specialist"));

    const { pi, eventHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);

    const handler = eventHandlers.get("tool_execution_start")!;
    handler({ toolName: "grep", runId: "r1", stageId: "s2", ts: Date.now() });

    const snap = storeInstance.snapshot();
    const run = snap.runs.find((r) => r.id === "r1")!;
    const s2 = run.stages.find((s) => s.id === "s2")!;
    const s1 = run.stages.find((s) => s.id === "s1")!;
    assert.equal(s2.toolEvents.length, 1);
    assert.equal(s2.toolEvents[0]!.name, "grep");
    assert.equal(s1.toolEvents.length, 0);
  });

  test("tool_execution_end records tool end", () => {
    const { pi, eventHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);

    const startTs = Date.now() - 500;
    const startHandler = eventHandlers.get("tool_execution_start")!;
    startHandler({ toolName: "bash", ts: startTs });

    const endHandler = eventHandlers.get("tool_execution_end")!;
    endHandler({ toolName: "bash", ts: startTs, endedAt: Date.now(), output: "ok" });

    const snap = storeInstance.snapshot();
    const run = snap.runs.find((r) => r.id === "r1")!;
    const stage = run.stages.find((s) => s.id === "s1")!;
    const evt = stage.toolEvents.find((e) => e.name === "bash");
    assert.notEqual(evt, undefined);
    assert.equal(evt!.output, "ok");
    assert.notEqual(evt!.endedAt, undefined);
  });

  test("ask_user_question start marks the active stage awaiting input", () => {
    const { pi, eventHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);

    const startHandler = eventHandlers.get("tool_execution_start")!;
    startHandler({ toolName: "ask_user_question", toolCallId: "ask-1", ts: 123 });

    const stage = storeInstance.snapshot().runs[0]!.stages[0]!;
    assert.equal(stage.status, "awaiting_input");
    assert.equal(stage.awaitingInputSince, 123);
  });

  test("ask_user_question end clears awaiting input even after no stage is running", () => {
    const { pi, eventHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);

    eventHandlers.get("tool_execution_start")!({
      toolName: "ask_user_question",
      toolCallId: "ask-1",
      ts: 123,
    });
    assert.equal(storeInstance.snapshot().runs[0]!.stages[0]!.status, "awaiting_input");

    eventHandlers.get("tool_execution_end")!({
      toolCallId: "ask-1",
      endedAt: 456,
      output: "answered",
    });

    const stage = storeInstance.snapshot().runs[0]!.stages[0]!;
    assert.equal(stage.status, "running");
    assert.equal(stage.awaitingInputSince, undefined);
  });

  test("ask_user_question tool_call/tool_result extension events update awaiting input", () => {
    const { pi, extensionHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);

    extensionHandlers.get("tool_call")!({
      type: "tool_call",
      toolName: "ask_user_question",
      toolCallId: "ask-2",
      input: { questions: [] },
    });
    assert.equal(storeInstance.snapshot().runs[0]!.stages[0]!.status, "awaiting_input");

    extensionHandlers.get("tool_result")!({
      type: "tool_result",
      toolName: "ask_user_question",
      toolCallId: "ask-2",
      input: { questions: [] },
      content: [],
      isError: false,
    });

    const stage = storeInstance.snapshot().runs[0]!.stages[0]!;
    assert.equal(stage.status, "running");
    assert.equal(stage.awaitingInputSince, undefined);
  });

  test("malformed payloads do not crash", () => {
    const { pi, eventHandlers } = makeMockPi();
    installToolExecutionHooks(pi, storeInstance);

    const startHandler = eventHandlers.get("tool_execution_start")!;
    assert.doesNotThrow(() => startHandler(null));
    assert.doesNotThrow(() => startHandler(undefined));
    assert.doesNotThrow(() => startHandler(42));
    assert.doesNotThrow(() => startHandler({}));
  });

  test("no-op when no active run exists", () => {
    const emptyStore = createStore();
    const { pi, eventHandlers } = makeMockPi();
    installToolExecutionHooks(pi, emptyStore);

    const handler = eventHandlers.get("tool_execution_start")!;
    assert.doesNotThrow(() => handler({ toolName: "bash", ts: Date.now() }));
    const snap = emptyStore.snapshot();
    assert.equal(snap.runs.length, 0);
  });
});
