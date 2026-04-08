/** @jsxImportSource @opentui/react */

import { test, expect, describe, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { PanelStore } from "../../../packages/workflow-sdk/src/components/orchestrator-panel-store.ts";
import { NodeCard } from "../../../packages/workflow-sdk/src/components/node-card.tsx";
import type { LayoutNode } from "../../../packages/workflow-sdk/src/components/layout.ts";
import { NODE_H } from "../../../packages/workflow-sdk/src/components/layout.ts";
import { TestProviders } from "./test-helpers.tsx";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = null;
});

function makeLayoutNode(overrides: Partial<LayoutNode> = {}): LayoutNode {
  return {
    name: "test-node",
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

describe("NodeCard", () => {
  test("renders pending node with dash for duration", async () => {
    const store = new PanelStore();
    const node = makeLayoutNode({ name: "my-session", status: "pending" });

    testSetup = await testRender(
      <TestProviders store={store}>
        <NodeCard node={node} focused={false} pulsePhase={0} displayH={NODE_H} />
      </TestProviders>,
      { width: 60, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("my-session");
    expect(frame).toContain("\u2014"); // em dash for no duration
  });

  test("renders running node with duration", async () => {
    const store = new PanelStore();
    const now = Date.now();
    const node = makeLayoutNode({
      name: "worker",
      status: "running",
      startedAt: now - 65000, // 1m 05s ago
    });

    testSetup = await testRender(
      <TestProviders store={store}>
        <NodeCard node={node} focused={false} pulsePhase={0} displayH={NODE_H} />
      </TestProviders>,
      { width: 60, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("worker");
    expect(frame).toContain("1m");
  });

  test("renders complete node with final duration", async () => {
    const store = new PanelStore();
    const node = makeLayoutNode({
      name: "done-node",
      status: "complete",
      startedAt: 1000,
      endedAt: 6000, // 5 seconds
    });

    testSetup = await testRender(
      <TestProviders store={store}>
        <NodeCard node={node} focused={false} pulsePhase={0} displayH={NODE_H} />
      </TestProviders>,
      { width: 60, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("done-node");
    expect(frame).toContain("0m 05s");
  });

  test("renders error node", async () => {
    const store = new PanelStore();
    const node = makeLayoutNode({
      name: "err-node",
      status: "error",
      error: "timeout",
      startedAt: 1000,
      endedAt: 3000,
    });

    testSetup = await testRender(
      <TestProviders store={store}>
        <NodeCard node={node} focused={false} pulsePhase={0} displayH={NODE_H} />
      </TestProviders>,
      { width: 60, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("err-node");
  });

  test("renders focused node", async () => {
    const store = new PanelStore();
    const node = makeLayoutNode({ name: "focused-node", status: "pending" });

    testSetup = await testRender(
      <TestProviders store={store}>
        <NodeCard node={node} focused={true} pulsePhase={0} displayH={NODE_H} />
      </TestProviders>,
      { width: 60, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("focused-node");
  });

  test("running node at different pulse phases renders without error", async () => {
    const store = new PanelStore();
    const node = makeLayoutNode({ name: "pulse-test", status: "running", startedAt: Date.now() });

    // Test at phase 0
    testSetup = await testRender(
      <TestProviders store={store}>
        <NodeCard node={node} focused={false} pulsePhase={0} displayH={NODE_H} />
      </TestProviders>,
      { width: 60, height: 10 },
    );
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("pulse-test");
    testSetup.renderer.destroy();

    // Test at phase 16 (half cycle)
    testSetup = await testRender(
      <TestProviders store={store}>
        <NodeCard node={node} focused={true} pulsePhase={16} displayH={NODE_H} />
      </TestProviders>,
      { width: 60, height: 10 },
    );
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("pulse-test");
  });
});
