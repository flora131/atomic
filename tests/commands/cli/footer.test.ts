import { describe, expect, test } from "bun:test";
import { renderFooterFrame } from "../../../src/commands/cli/footer.tsx";

describe("headless footer frame", () => {
  test("renders the OpenTUI footer without terminal capability probes", async () => {
    const frame = await renderFooterFrame({
      name: "atomic-chat-copilot-abcd1234",
      agentType: "copilot",
      width: 120,
    });

    expect(frame).toContain("COPILOT");
    expect(frame).toContain("atomic-chat-copilot-abcd1234");
    expect(frame).toContain("ctrl+b d");
    expect(frame).toContain("detach");
    expect(frame).not.toContain("\x1b[?");
    expect(frame).not.toContain("\x1b]");
    expect(frame).not.toContain("\x1b_");
  });

  test("sanitizes control characters from rendered footer text", async () => {
    const frame = await renderFooterFrame({
      name: "b\x1b]x\x07o",
      width: 80,
    });

    expect(frame).toContain("b");
    expect(frame).toContain("o");
    expect(frame).not.toContain("\x1b]x");
    expect(frame).not.toContain("\x07");
  });
});
