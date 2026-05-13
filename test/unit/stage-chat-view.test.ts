/**
 * Unit tests for `StageChatView`.
 *
 * Verifies:
 *  - Idle stage: Enter sends `handle.prompt(text)`.
 *  - Running stage: Enter sends `handle.steer(text)`.
 *  - ctrl+f sends `handle.followUp(text)`.
 *  - ctrl+p triggers `handle.pause()` and flips localPaused.
 *  - After pause, Enter routes through `handle.resume(text)`.
 *  - Ctrl+D calls `onDetach`; Escape calls `onClose`.
 *
 * cross-ref: src/tui/stage-chat-view.ts
 */

import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { createStore } from "../../src/shared/store.js";
import { StageChatView } from "../../src/tui/stage-chat-view.js";
import { deriveGraphTheme } from "../../src/tui/graph-theme.js";
import type { StageControlHandle } from "../../src/runs/foreground/stage-control-registry.js";
import type { AgentSession, AgentSessionEvent } from "@oh-my-pi/pi-coding-agent";

interface HandleState {
  promptCalls: Array<string>;
  steerCalls: Array<string>;
  followUpCalls: Array<string>;
  pauseCalls: number;
  resumeCalls: Array<string | undefined>;
  isStreaming: boolean;
}

function makeHandle(state: HandleState = {
  promptCalls: [],
  steerCalls: [],
  followUpCalls: [],
  pauseCalls: 0,
  resumeCalls: [],
  isStreaming: false,
}): { handle: StageControlHandle; state: HandleState } {
  let listener: ((e: AgentSessionEvent) => void) | undefined;
  const handle: StageControlHandle = {
    runId: "run-1",
    stageId: "stage-a",
    stageName: "review-a",
    status: "running",
    sessionId: undefined,
    sessionFile: undefined,
    get isStreaming() {
      return state.isStreaming;
    },
    messages: [] as AgentSession["messages"],
    async ensureAttached() {},
    async prompt(text: string) {
      state.promptCalls.push(text);
    },
    async steer(text: string) {
      state.steerCalls.push(text);
    },
    async followUp(text: string) {
      state.followUpCalls.push(text);
    },
    async pause() {
      state.pauseCalls += 1;
    },
    async resume(message?: string) {
      state.resumeCalls.push(message);
    },
    subscribe(l) {
      listener = l;
      void listener; // silence unused
      return () => {
        listener = undefined;
      };
    },
  };
  return { handle, state };
}

function setupRun(store: ReturnType<typeof createStore>, runId: string, stageId: string) {
  store.recordRunStart({
    id: runId,
    name: "test-wf",
    inputs: {},
    status: "running",
    stages: [],
    startedAt: Date.now(),
  });
  store.recordStageStart(runId, {
    id: stageId,
    name: "review-a",
    status: "running",
    parentIds: [],
    toolEvents: [],
  });
}

async function flush(): Promise<void> {
  return new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe("StageChatView", () => {
  test("idle Enter calls handle.prompt", async () => {
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle, state } = makeHandle();
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {},
      onClose: () => {},
    });
    for (const ch of "hello") view.handleInput(ch);
    view.handleInput("\r");
    await flush();
    await flush();
    assert.deepEqual(state.promptCalls, ["hello"]);
    assert.equal(state.steerCalls.length, 0);
    view.dispose();
  });

  test("running Enter calls handle.steer by default", async () => {
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle, state } = makeHandle({
      promptCalls: [],
      steerCalls: [],
      followUpCalls: [],
      pauseCalls: 0,
      resumeCalls: [],
      isStreaming: true,
    });
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {},
      onClose: () => {},
    });
    for (const ch of "redirect") view.handleInput(ch);
    view.handleInput("\r");
    await flush();
    await flush();
    assert.deepEqual(state.steerCalls, ["redirect"]);
    assert.equal(state.promptCalls.length, 0);
    view.dispose();
  });

  test("ctrl+f sends a follow-up", async () => {
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle, state } = makeHandle();
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {},
      onClose: () => {},
    });
    for (const ch of "afterwards") view.handleInput(ch);
    view.handleInput("\x06");
    await flush();
    await flush();
    assert.deepEqual(state.followUpCalls, ["afterwards"]);
    view.dispose();
  });

  test("ctrl+p calls handle.pause and flips localPaused", async () => {
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle, state } = makeHandle();
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {},
      onClose: () => {},
    });
    view.handleInput("\x10");
    await flush();
    await flush();
    assert.equal(state.pauseCalls, 1);
    assert.equal(view._isLocalPaused, true);
    view.dispose();
  });

  test("Enter after pause sends handle.resume(text)", async () => {
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle, state } = makeHandle();
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {},
      onClose: () => {},
    });
    view.handleInput("\x10");
    await flush();
    await flush();
    assert.equal(view._isLocalPaused, true);
    for (const ch of "go on") view.handleInput(ch);
    view.handleInput("\r");
    await flush();
    await flush();
    assert.deepEqual(state.resumeCalls, ["go on"]);
    assert.equal(view._isLocalPaused, false);
    view.dispose();
  });

  test("Ctrl+D calls onDetach", () => {
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle } = makeHandle();
    let detached = 0;
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {
        detached += 1;
      },
      onClose: () => {},
    });
    view.handleInput("\x04");
    assert.equal(detached, 1);
    view.dispose();
  });

  test("Escape calls onClose", () => {
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle } = makeHandle();
    let closed = 0;
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {},
      onClose: () => {
        closed += 1;
      },
    });
    view.handleInput("\x1b");
    assert.equal(closed, 1);
    view.dispose();
  });

  test("renders the constant 32-line frame when no viewport provider is wired", () => {
    // Fallback path: direct unit renders without a host-provided
    // viewport accessor get the legacy VIEW_LINE_COUNT rectangle.
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle } = makeHandle();
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {},
      onClose: () => {},
    });
    const lines = view.render(96);
    assert.equal(lines.length, 32);
    view.dispose();
  });

  test("expands the chat surface to the reported viewport row count", () => {
    // Full-screen overlay: when the host surfaces terminal.rows
    // through `getViewportRows`, the renderer must paint that many
    // lines so the popup fills the terminal.
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle } = makeHandle();
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {},
      onClose: () => {},
      getViewportRows: () => 44,
    });
    const lines = view.render(96);
    assert.equal(lines.length, 44);
    view.dispose();
  });

  test("transcript body grows with the viewport so more entries stay visible", async () => {
    // The transcript body is `viewportRows - HEADER - INPUT - FOOTER`.
    // A larger viewport must surface more transcript entries inside
    // the body band; the fixed 32-row default would clip them.
    const store = createStore();
    setupRun(store, "run-1", "stage-a");
    const { handle, state } = makeHandle();

    // Seed enough transcript entries that the 32-row body (≈23 rows)
    // would truncate, but a 60-row viewport (≈51 body rows) keeps
    // them all.
    const view = new StageChatView({
      store,
      graphTheme: deriveGraphTheme({}),
      runId: "run-1",
      stageId: "stage-a",
      workflowName: "test-wf",
      handle,
      onDetach: () => {},
      onClose: () => {},
      getViewportRows: () => 60,
    });
    for (let i = 0; i < 30; i++) {
      for (const ch of `msg-${i}`) view.handleInput(ch);
      view.handleInput("\r");
      await flush();
      await flush();
    }
    // Sanity: stub handle recorded each prompt.
    assert.equal(state.promptCalls.length, 30);

    const text = view.render(96).join("\n");
    // Default 23-row body would have clipped the oldest messages.
    // A 60-row viewport surfaces "you" entries for every message.
    const youOccurrences = text.split("\n").filter((line) => line.includes("you")).length;
    assert.ok(youOccurrences >= 25, `expected most transcript entries visible, got ${youOccurrences}`);
    view.dispose();
  });
});
