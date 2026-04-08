/** @jsxImportSource @opentui/react */

import { test, expect, describe, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Edge } from "../../src/components/edge.tsx";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = null;
});

describe("Edge", () => {
  test("renders straight vertical connector text", async () => {
    testSetup = await testRender(
      <Edge text="│" col={5} row={2} width={1} height={1} color="#6c7086" />,
      { width: 40, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("│");
  });

  test("renders branching connector with horizontal bar", async () => {
    const branchText = "╭──┬──╮";
    testSetup = await testRender(
      <Edge text={branchText} col={0} row={0} width={7} height={1} color="#6c7086" />,
      { width: 40, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("─");
  });

  test("renders multiline connector text", async () => {
    const text = "│\n╰──╮";
    testSetup = await testRender(
      <Edge text={text} col={0} row={0} width={4} height={2} color="#ffffff" />,
      { width: 40, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("│");
  });
});
