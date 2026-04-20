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
  test("renders window name badge and navigation hints (workflow variant)", async () => {
    testSetup = await testRender(
      <AttachedStatusline name="worker-1" theme={TEST_THEME} />,
      { width: 120, height: 3 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("worker-1");
    expect(frame).toContain("ctrl+g");
    expect(frame).toContain("graph");
    expect(frame).toContain("ctrl+\\");
    expect(frame).toContain("next");
    // Detach hint lives in the orchestrator-window Statusline only; keeping
    // it out of every agent pane avoids duplicating the same reminder on
    // every footer.
    expect(frame).not.toContain("ctrl+b d");
    expect(frame).not.toContain("detach");
  });

  test("renders uppercase agent pill, pane name, and detach hint (chat variant)", async () => {
    testSetup = await testRender(
      <AttachedStatusline
        name="atomic-chat-copilot-abcd1234"
        theme={TEST_THEME}
        agentType="copilot"
      />,
      { width: 120, height: 3 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("COPILOT");
    expect(frame).toContain("atomic-chat-copilot-abcd1234");
    expect(frame).not.toContain("q quit");
    expect(frame).toContain("ctrl+b d");
    expect(frame).toContain("detach");
    expect(frame).not.toContain("ctrl+g");
    expect(frame).not.toContain("ctrl+\\");
  });
});
