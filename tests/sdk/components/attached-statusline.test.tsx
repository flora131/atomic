/** @jsxImportSource @opentui/react */

import { test, expect, describe, afterEach } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { AttachedStatusline } from "../../../src/sdk/components/attached-statusline.tsx";
import { TEST_THEME } from "./test-helpers.tsx";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = null;
});

describe("AttachedStatusline", () => {
  test("renders window name badge and keyboard hints", async () => {
    testSetup = await testRender(
      <AttachedStatusline name="worker-1" theme={TEST_THEME} />,
      { width: 80, height: 3 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("worker-1");
    expect(frame).toContain("ctrl+g");
    expect(frame).toContain("graph");
    expect(frame).toContain("ctrl+\\");
    expect(frame).toContain("next");
  });
});
