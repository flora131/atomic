/** @jsxImportSource @opentui/react */

import { test, expect, describe, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { PanelStore } from "../../../src/sdk/components/orchestrator-panel-store.ts";
import { Statusline } from "../../../src/sdk/components/statusline.tsx";
import { TestProviders } from "./test-helpers.tsx";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = null;
});

describe("Statusline", () => {
  test("renders GRAPH badge", async () => {
    const store = new PanelStore();
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline attachMsg="" />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("GRAPH");
  });

  test("shows navigation hints when no attach message", async () => {
    const store = new PanelStore();
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline attachMsg="" />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("navigate");
    expect(frame).toContain("attach");
  });

  test("shows attach message when provided", async () => {
    const store = new PanelStore();
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline attachMsg={"\u2192 worker-1"} />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("worker-1");
  });

  test("does not render focused node info", async () => {
    const store = new PanelStore();
    store.workflowName = "my-workflow";
    store.setWorkflowInfo("my-workflow", "claude", [{ name: "worker-1", parents: [] }], "p");
    store.startSession("worker-1");
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline attachMsg="" />
      </TestProviders>,
      { width: 120, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("worker-1");
    expect(frame).not.toContain("my-workflow");
  });

  test("shows quit option", async () => {
    const store = new PanelStore();
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline attachMsg="" />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("quit");
  });
});
