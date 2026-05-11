/**
 * Unit tests for store-widget-installer.
 * Tests: installStoreWidget (setWidget calls), installToolExecutionHooks (event subscriptions).
 * cross-ref: spec §5.4.4, §5.4.6, §5.5, §8.1 Phase E
 */

import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { installStoreWidget, installToolExecutionHooks } from "../../src/tui/store-widget-installer.js";
import { createStore } from "../../src/shared/store.js";
import type { Store } from "../../src/shared/store.js";
import type { RunSnapshot, StageSnapshot } from "../../src/shared/store-types.js";

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

function makeMockPi(): {
  pi: {
    ui: {
      setWidget: (
        key: string,
        factory: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined,
        opts?: { placement?: string },
      ) => void;
    };
    events: {
      on: (event: string, handler: (payload: unknown) => void) => void;
    };
  };
  widgetCalls: SetWidgetCall[];
  eventHandlers: Map<string, (payload: unknown) => void>;
} {
  const widgetCalls: SetWidgetCall[] = [];
  const eventHandlers: Map<string, (payload: unknown) => void> = new Map();

  const pi = {
    ui: {
      setWidget(
        key: string,
        factory: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined,
        opts?: { placement?: string },
      ): void {
        widgetCalls.push({ key, factory, opts });
      },
    },
    events: {
      on(event: string, handler: (payload: unknown) => void): void {
        eventHandlers.set(event, handler);
      },
    },
  };

  return { pi, widgetCalls, eventHandlers };
}

// ---------------------------------------------------------------------------
// installStoreWidget
// ---------------------------------------------------------------------------

describe("installStoreWidget", () => {
  let storeInstance: Store;

  beforeEach(() => {
    storeInstance = createStore();
  });

  test("calls setWidget(undefined) immediately when no active runs", () => {
    const { pi, widgetCalls } = makeMockPi();
    installStoreWidget(pi, storeInstance);
    assert.equal(widgetCalls.length, 1);
    assert.equal(widgetCalls[0]!.key, "workflow.run");
    assert.equal(widgetCalls[0]!.factory, undefined);
  });

  test("calls setWidget with factory when active run exists", () => {
    const { pi, widgetCalls } = makeMockPi();
    const run = makeRun("r1", "my-wf");
    storeInstance.recordRunStart(run);

    installStoreWidget(pi, storeInstance);
    // One initial call, one from recordRunStart subscription
    const lastCall = widgetCalls[widgetCalls.length - 1]!;
    assert.equal(lastCall.key, "workflow.run");
    assert.equal(typeof lastCall.factory, "function");
    assert.deepEqual(lastCall.opts, { placement: "aboveEditor" });
  });

  test("factory returns component with render() that produces lines", () => {
    const { pi, widgetCalls } = makeMockPi();
    const run = makeRun("r1", "my-wf");
    storeInstance.recordRunStart(run);

    installStoreWidget(pi, storeInstance);
    const lastCall = widgetCalls[widgetCalls.length - 1]!;
    const component = lastCall.factory!(null, null);
    const lines = component.render(80);
    assert.equal(Array.isArray(lines), true);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].includes("▶ my-wf"));
  });

  test("clears widget when run ends", () => {
    const { pi, widgetCalls } = makeMockPi();
    const run = makeRun("r1", "my-wf");
    storeInstance.recordRunStart(run);
    installStoreWidget(pi, storeInstance);

    // End the run → should clear widget
    storeInstance.recordRunEnd("r1", "completed");
    const lastCall = widgetCalls[widgetCalls.length - 1]!;
    assert.equal(lastCall.factory, undefined);
  });

  test("re-registers factory on each store change (snapshot capture)", () => {
    const { pi, widgetCalls } = makeMockPi();
    const run = makeRun("r1", "my-wf");
    storeInstance.recordRunStart(run);
    installStoreWidget(pi, storeInstance);
    const callsBefore = widgetCalls.length;

    // Add a stage — triggers another store change
    storeInstance.recordStageStart("r1", makeStage("s1", "scout"));
    assert.ok(widgetCalls.length > callsBefore);
  });

  test("returns unsubscribe — no more calls after unsubscribe", () => {
    const { pi, widgetCalls } = makeMockPi();
    const unsubscribe = installStoreWidget(pi, storeInstance);
    unsubscribe();
    const countAfterUnsub = widgetCalls.length;

    storeInstance.recordRunStart(makeRun("r1", "my-wf"));
    assert.equal(widgetCalls.length, countAfterUnsub);
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
