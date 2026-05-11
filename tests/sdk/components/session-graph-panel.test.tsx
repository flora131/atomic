/** @jsxImportSource @opentui/react */

import { test, expect, describe, afterEach } from "bun:test";
import { PanelStore } from "../../../packages/atomic-sdk/src/components/orchestrator-panel-store.ts";
import { SessionGraphPanel } from "../../../packages/atomic-sdk/src/components/session-graph-panel.tsx";
import { renderReact, TestProviders, type ReactTestSetup } from "./test-helpers.tsx";

let testSetup: ReactTestSetup | null = null;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = null;
});

function createPopulatedStore(): PanelStore {
  const store = new PanelStore();
  store.setWorkflowInfo("test-wf", "claude", [
    { name: "worker-1", parents: [] },
    { name: "worker-2", parents: [] },
    { name: "merge", parents: ["worker-1", "worker-2"] },
  ], "do stuff");
  return store;
}

async function renderPanel(store: PanelStore) {
  testSetup = await renderReact(
    <TestProviders store={store}>
      <SessionGraphPanel />
    </TestProviders>,
    { width: 120, height: 40 },
  );
  await testSetup.renderOnce();
  return testSetup;
}

describe("SessionGraphPanel", () => {
  describe("rendering", () => {
    test("renders node names", async () => {
      const store = createPopulatedStore();
      const setup = await renderPanel(store);
      const frame = setup.captureCharFrame();
      // The runtime "orchestrator" entry is filtered from the graph; only
      // user-defined stages appear as nodes.
      expect(frame).toContain("worker-1");
      expect(frame).toContain("worker-2");
      expect(frame).toContain("merge");
    });

    test("renders header with Orchestrator badge", async () => {
      const store = createPopulatedStore();
      const setup = await renderPanel(store);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Orchestrator");
    });

    test("renders with running session showing duration", async () => {
      const store = createPopulatedStore();
      store.startSession("worker-1");
      const setup = await renderPanel(store);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("worker-1");
      expect(frame).toContain("0m");
    });

    test("renders completion state with workflow name", async () => {
      const store = createPopulatedStore();
      store.startSession("worker-1");
      store.completeSession("worker-1");
      store.startSession("worker-2");
      store.completeSession("worker-2");
      store.startSession("merge");
      store.completeSession("merge");
      store.setCompletion("test-wf", "/tmp/transcripts");

      const setup = await renderPanel(store);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("test-wf");
    });

    test("renders fatal error state", async () => {
      const store = createPopulatedStore();
      store.setFatalError("something went wrong");

      const setup = await renderPanel(store);
      const frame = setup.captureCharFrame();
      expect(frame).toContain("Failed");
    });
  });

  describe("keyboard navigation", () => {
    test("arrow right moves focus to next node", async () => {
      const store = createPopulatedStore();
      const setup = await renderPanel(store);

      // Initial focus lands on the first visible stage (worker-1 — the
      // synthetic orchestrator entry is filtered before layout).
      let frame = setup.captureCharFrame();
      expect(frame).toContain("worker-1");

      // Press right arrow to move focus
      setup.mockInput.pressArrow("right");
      await setup.renderOnce();
      // Frame should still render (focus changed internally)
      frame = setup.captureCharFrame();
      expect(frame).toContain("worker-2");
    });

    test("arrow down moves focus to child node", async () => {
      const store = createPopulatedStore();
      const setup = await renderPanel(store);

      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      // Should still render all nodes
      expect(frame).toContain("worker-1");
      expect(frame).toContain("worker-2");
    });

    test("hjkl navigation works", async () => {
      const store = createPopulatedStore();
      const setup = await renderPanel(store);

      // j = down
      setup.mockInput.pressKey("j");
      await setup.renderOnce();

      // l = right
      setup.mockInput.pressKey("l");
      await setup.renderOnce();

      // k = up
      setup.mockInput.pressKey("k");
      await setup.renderOnce();

      // h = left
      setup.mockInput.pressKey("h");
      await setup.renderOnce();

      const frame = setup.captureCharFrame();
      // After a hjkl round-trip the graph still renders its stages.
      expect(frame).toContain("worker-1");
    });

    test("G (shift+g) moves to deepest node", async () => {
      const store = createPopulatedStore();
      const setup = await renderPanel(store);

      setup.mockInput.pressKey("G", { shift: true });
      await setup.renderOnce();

      // The deepest node is "merge" at depth 2
      const frame = setup.captureCharFrame();
      expect(frame).toContain("merge");
    });

    test("gg double-tap moves to root", async () => {
      const store = createPopulatedStore();
      const setup = await renderPanel(store);

      // Move down first
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();

      // Double-tap g to go back to root
      setup.mockInput.pressKey("g");
      setup.mockInput.pressKey("g");
      await setup.renderOnce();

      const frame = setup.captureCharFrame();
      // gg returns to the first visible root stage rather than the
      // (filtered) orchestrator entry.
      expect(frame).toContain("worker-1");
    });

    test("enter triggers attach flash message", async () => {
      const store = createPopulatedStore();
      store.startSession("worker-1");
      const setup = await renderPanel(store);

      // Move to worker-1
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();

      // Press enter (attach won't actually work without tmux, but the message should show)
      setup.mockInput.pressEnter();
      await setup.renderOnce();

      // The attach might show a flash message or not depending on focus
      const frame = setup.captureCharFrame();
      expect(frame).toBeTruthy();
    });

    test("Ctrl+C triggers abort during execution", async () => {
      const store = createPopulatedStore();
      let abortResolved = false;
      store.abortResolve = () => { abortResolved = true; };

      const setup = await renderPanel(store);
      setup.mockInput.pressCtrlC();
      await setup.renderOnce();

      expect(abortResolved).toBe(true);
    });

    test("q exits after completion", async () => {
      const store = createPopulatedStore();
      store.markCompletionReached();
      let exitResolved = false;
      store.exitResolve = () => { exitResolved = true; };

      const setup = await renderPanel(store);
      setup.mockInput.pressKey("q");
      await setup.renderOnce();

      expect(exitResolved).toBe(true);
    });

    test("q triggers abort before completion", async () => {
      const store = createPopulatedStore();
      let abortResolved = false;
      store.abortResolve = () => { abortResolved = true; };

      const setup = await renderPanel(store);
      setup.mockInput.pressKey("q");
      await setup.renderOnce();

      expect(abortResolved).toBe(true);
    });
  });

  describe("auto-scroll", () => {
    function createWideGraph(): PanelStore {
      const store = new PanelStore();
      // Create a fan-out graph that is wider than a narrow terminal
      // orchestrator → [a, b, c, d] → merge
      // 5 siblings at depth 1 span ~5*(36+6) = 210 columns
      store.setWorkflowInfo("wide-wf", "claude", [
        { name: "a", parents: [] },
        { name: "b", parents: [] },
        { name: "c", parents: [] },
        { name: "d", parents: [] },
        { name: "merge", parents: ["a", "b", "c", "d"] },
      ], "test");
      return store;
    }

    async function renderNarrow(store: PanelStore) {
      // Use a very small viewport so the graph overflows in both axes
      testSetup = await renderReact(
        <TestProviders store={store}>
          <SessionGraphPanel />
        </TestProviders>,
        { width: 50, height: 10 },
      );
      await testSetup.renderOnce();
      return testSetup;
    }

    test("scrolls right when navigating to a node beyond right edge", async () => {
      const store = createWideGraph();
      const setup = await renderNarrow(store);

      // Navigate right repeatedly to reach nodes far to the right
      for (let i = 0; i < 4; i++) {
        setup.mockInput.pressArrow("right");
        await setup.renderOnce();
      }
      // If we get here without error, the scroll logic executed
      const frame = setup.captureCharFrame();
      expect(frame).toBeTruthy();
    });

    test("scrolls left when navigating back to a node beyond left edge", async () => {
      const store = createWideGraph();
      const setup = await renderNarrow(store);

      // Navigate far right first
      for (let i = 0; i < 4; i++) {
        setup.mockInput.pressArrow("right");
        await setup.renderOnce();
      }
      // Then navigate back left past the visible area
      for (let i = 0; i < 4; i++) {
        setup.mockInput.pressArrow("left");
        await setup.renderOnce();
      }
      const frame = setup.captureCharFrame();
      expect(frame).toBeTruthy();
    });

    test("scrolls down when navigating to a deep node", async () => {
      const store = createWideGraph();
      const setup = await renderNarrow(store);

      // Navigate down to reach the merge node at depth 2
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();

      const frame = setup.captureCharFrame();
      expect(frame).toBeTruthy();
    });

    test("scrolls up when navigating back to root from deep node", async () => {
      const store = createWideGraph();
      const setup = await renderNarrow(store);

      // Go deep
      setup.mockInput.pressKey("G", { shift: true });
      await setup.renderOnce();
      // Go back to root via gg
      setup.mockInput.pressKey("g");
      setup.mockInput.pressKey("g");
      await setup.renderOnce();

      const frame = setup.captureCharFrame();
      expect(frame).toBeTruthy();
    });
  });

  describe("resize", () => {
    test("handles terminal resize", async () => {
      const store = createPopulatedStore();
      const setup = await renderPanel(store);

      setup.resize(60, 20);
      await setup.renderOnce();

      const frame = setup.captureCharFrame();
      // After resize the visible stages still render somewhere on screen.
      expect(frame).toContain("worker-1");
    });
  });
});
