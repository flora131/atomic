/** @jsxImportSource @opentui/react */

import { test, expect, describe, afterEach, setSystemTime } from "bun:test";
import { PanelStore } from "../../../packages/atomic-sdk/src/components/orchestrator-panel-store.ts";
import { Header } from "../../../packages/atomic-sdk/src/components/header.tsx";
import { renderReact, TestProviders, type ReactTestSetup } from "./test-helpers.tsx";

let testSetup: ReactTestSetup | null = null;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = null;
  // Reset any test-controlled system clock so the next test sees real time.
  setSystemTime();
});

describe("Header", () => {
  test("shows 'Orchestrator' badge when workflow is in progress", async () => {
    const store = new PanelStore();
    store.setWorkflowInfo("my-wf", "claude", [{ name: "s1", parents: [] }], "prompt");

    testSetup = await renderReact(
      <TestProviders store={store}>
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Orchestrator");
  });

  test("shows workflow name badge on completion", async () => {
    const store = new PanelStore();
    store.setWorkflowInfo("my-wf", "claude", [{ name: "s1", parents: [] }], "p");
    store.startSession("s1");
    store.completeSession("s1");
    store.setCompletion("my-wf", "/tmp/transcripts");

    testSetup = await renderReact(
      <TestProviders store={store}>
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("my-wf");
    expect(frame).toContain("\u2713"); // checkmark
  });

  test("shows failed badge on fatal error", async () => {
    const store = new PanelStore();
    store.setWorkflowInfo("my-wf", "claude", [], "p");
    store.setFatalError("something broke");

    testSetup = await renderReact(
      <TestProviders store={store}>
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Failed");
  });

  test("shows session counts", async () => {
    const store = new PanelStore();
    store.setWorkflowInfo("wf", "claude", [
      { name: "s1", parents: [] },
      { name: "s2", parents: [] },
    ], "p");
    // orchestrator=running, s1=pending, s2=pending
    store.startSession("s1");
    store.completeSession("s1");
    // Now: orchestrator=running(1), s1=complete(1), s2=pending(1)

    testSetup = await renderReact(
      <TestProviders store={store}>
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    // Should show at least the complete count checkmark
    expect(frame).toContain("\u2713");
  });

  test("excludes the synthetic orchestrator entry from status counts", async () => {
    const store = new PanelStore();
    // Two user-defined stages, both pending. Orchestrator is also "running"
    // internally but must NOT appear in any status badge.
    store.setWorkflowInfo("wf", "claude", [
      { name: "s1", parents: [] },
      { name: "s2", parents: [] },
    ], "p");

    testSetup = await renderReact(
      <TestProviders store={store}>
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    // Pending badge shows exactly 2 (two user-defined stages); the running
    // badge is rendered as null when the count is zero (CountBadge returns
    // null on count <= 0), so the filled-circle glyph must be absent
    // entirely. Asserting absence of the glyph itself \u2014 rather than `\u25cf 1`
    // \u2014 survives any future test that adds a real running stage.
    expect(frame).toContain("\u25cb 2"); // 2 pending stages, not 3
    expect(frame).not.toContain("\u25cf"); // running badge is null, glyph absent
  });

  test("shows live workflow duration while running", async () => {
    // Set the clock back 5.1s before startup so startedAt lands there;
    // restore real time before render so the live ticker reads "now".
    const start = new Date("2026-01-01T00:00:00Z");
    setSystemTime(start);
    const store = new PanelStore();
    store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
    setSystemTime(new Date(start.getTime() + 5_100));

    testSetup = await renderReact(
      <TestProviders store={store}>
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    // Match either 5s or 6s — render latency can push us into the next bucket
    // on slow CI hosts. The point is that *some* live duration is shown.
    expect(frame).toMatch(/0m 0[56]s/);
  });

  test("freezes duration at the terminal value after completion", async () => {
    // Drive Date.now() so setWorkflowInfo's startedAt and setCompletion's
    // endedAt land at controlled values. Avoids mutating the session record
    // directly (would silently bypass a future copy-on-write store layer).
    const start = new Date("2026-01-01T00:00:00Z");
    setSystemTime(start);

    const store = new PanelStore();
    store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
    store.startSession("s1");
    store.completeSession("s1");

    // Advance the clock 12s before setCompletion stamps endedAt.
    setSystemTime(new Date(start.getTime() + 12_000));
    store.setCompletion("wf", "/tmp/transcripts");

    testSetup = await renderReact(
      <TestProviders store={store}>
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    // Frozen at endedAt - startedAt = 12s, regardless of wall-clock drift.
    expect(frame).toContain("0m 12s");
  });

  test("freezes duration at the terminal value after fatal error", async () => {
    const start = new Date("2026-01-01T00:00:00Z");
    setSystemTime(start);

    const store = new PanelStore();
    store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");

    setSystemTime(new Date(start.getTime() + 7_000));
    store.setFatalError("kaboom");

    testSetup = await renderReact(
      <TestProviders store={store}>
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("0m 07s");
  });

  test("shows tmux session name next to badge", async () => {
    const store = new PanelStore();
    store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");

    testSetup = await renderReact(
      <TestProviders store={store} tmuxSession="atomic-abc123">
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("atomic-abc123");
  });

  test("shows error count when sessions have errors", async () => {
    const store = new PanelStore();
    store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
    store.startSession("s1");
    store.failSession("s1", "oops");

    testSetup = await renderReact(
      <TestProviders store={store}>
        <Header />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("\u2717"); // X mark for errors
  });
});
