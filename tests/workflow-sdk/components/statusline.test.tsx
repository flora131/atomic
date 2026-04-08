/** @jsxImportSource @opentui/react */

import { test, expect, describe, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { PanelStore } from "../../../packages/workflow-sdk/src/components/orchestrator-panel-store.ts";
import { Statusline } from "../../../packages/workflow-sdk/src/components/statusline.tsx";
import type { LayoutNode } from "../../../packages/workflow-sdk/src/components/layout.ts";
import { TestProviders } from "./test-helpers.tsx";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = null;
});

function makeLayoutNode(overrides: Partial<LayoutNode> = {}): LayoutNode {
  return {
    name: "node",
    status: "pending",
    parents: [],
    startedAt: null,
    endedAt: null,
    children: [],
    depth: 0,
    x: 0,
    y: 0,
    ...overrides,
  };
}

describe("Statusline", () => {
  test("renders GRAPH badge", async () => {
    const store = new PanelStore();
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline focusedNode={undefined} attachMsg="" />
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
        <Statusline focusedNode={undefined} attachMsg="" />
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
        <Statusline focusedNode={undefined} attachMsg={"\u2192 worker-1"} />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("worker-1");
  });

  test("shows focused node info", async () => {
    const store = new PanelStore();
    const node = makeLayoutNode({ name: "my-session", status: "running" });
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline focusedNode={node} attachMsg="" />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("my-session");
    expect(frame).toContain("running");
  });

  test("shows error info for errored focused node", async () => {
    const store = new PanelStore();
    const node = makeLayoutNode({ name: "broken", status: "error", error: "timeout exceeded" });
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline focusedNode={node} attachMsg="" />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("broken");
    expect(frame).toContain("timeout exceeded");
  });

  test("shows quit option when completion is reached", async () => {
    const store = new PanelStore();
    store.markCompletionReached();
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline focusedNode={undefined} attachMsg="" />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("quit");
  });

  test("hides quit option when completion not reached", async () => {
    const store = new PanelStore();
    testSetup = await testRender(
      <TestProviders store={store}>
        <Statusline focusedNode={undefined} attachMsg="" />
      </TestProviders>,
      { width: 80, height: 5 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).not.toContain("quit");
  });
});
