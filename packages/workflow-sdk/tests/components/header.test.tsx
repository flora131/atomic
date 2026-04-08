/** @jsxImportSource @opentui/react */

import { test, expect, describe, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { PanelStore } from "../../src/components/orchestrator-panel-store.ts";
import { Header } from "../../src/components/header.tsx";
import { TestProviders } from "./test-helpers.tsx";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = null;
});

describe("Header", () => {
  test("shows 'Orchestrator' badge when workflow is in progress", async () => {
    const store = new PanelStore();
    store.setWorkflowInfo("my-wf", "claude", [{ name: "s1", parents: [] }], "prompt");

    testSetup = await testRender(
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

    testSetup = await testRender(
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

    testSetup = await testRender(
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

    testSetup = await testRender(
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

  test("shows error count when sessions have errors", async () => {
    const store = new PanelStore();
    store.setWorkflowInfo("wf", "claude", [{ name: "s1", parents: [] }], "p");
    store.startSession("s1");
    store.failSession("s1", "oops");

    testSetup = await testRender(
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
