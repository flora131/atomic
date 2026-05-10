import { describe, expect, test } from "bun:test";
import { panelFooterToneFromStatus } from "./panel-footer.tsx";

describe("panelFooterToneFromStatus", () => {
  test("uses info while the workflow is still active", () => {
    expect(
      panelFooterToneFromStatus({
        fatalError: null,
        completionReached: false,
        sessions: [{ status: "running" }],
      }),
    ).toBe("info");
  });

  test("uses success when the workflow reached completion", () => {
    expect(
      panelFooterToneFromStatus({
        fatalError: null,
        completionReached: true,
        sessions: [{ status: "complete" }],
      }),
    ).toBe("success");
  });

  test("uses error when a fatal error is present", () => {
    expect(
      panelFooterToneFromStatus({
        fatalError: "boom",
        completionReached: true,
        sessions: [{ status: "complete" }],
      }),
    ).toBe("error");
  });

  test("uses error when any stage has errored", () => {
    expect(
      panelFooterToneFromStatus({
        fatalError: null,
        completionReached: false,
        sessions: [{ status: "complete" }, { status: "error" }],
      }),
    ).toBe("error");
  });
});
