import { describe, expect, test } from "bun:test";
import { panelFooterToneFromStatus } from "./panel-footer.tsx";

describe("panelFooterToneFromStatus", () => {
  test("uses info while the workflow is still active", () => {
    expect(
      panelFooterToneFromStatus({
        fatalError: null,
        completionInfo: null,
        sessions: [{ status: "running" }],
      }),
    ).toBe("info");
  });

  test("uses success when the workflow reached completion", () => {
    expect(
      panelFooterToneFromStatus({
        fatalError: null,
        completionInfo: { workflowName: "wf", transcriptsPath: "/t" },
        sessions: [{ status: "complete" }],
      }),
    ).toBe("success");
  });

  test("uses error when a fatal error is present", () => {
    expect(
      panelFooterToneFromStatus({
        fatalError: "boom",
        completionInfo: { workflowName: "wf", transcriptsPath: "/t" },
        sessions: [{ status: "complete" }],
      }),
    ).toBe("error");
  });

  test("uses error when any stage has errored", () => {
    expect(
      panelFooterToneFromStatus({
        fatalError: null,
        completionInfo: null,
        sessions: [{ status: "complete" }, { status: "error" }],
      }),
    ).toBe("error");
  });
});
