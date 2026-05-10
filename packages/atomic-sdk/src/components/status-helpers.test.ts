import { test, expect, describe } from "bun:test";
import { statusColor, statusLabel, statusIcon } from "./status-helpers.ts";
import type { GraphTheme } from "./graph-theme.ts";

const theme: GraphTheme = {
  background: "",
  backgroundElement: "",
  text: "",
  textMuted: "",
  textDim: "TEXTDIM",
  primary: "",
  success: "SUCCESS",
  error: "ERROR",
  warning: "WARNING",
  info: "INFO",
  mauve: "",
  border: "",
  borderActive: "",
};

describe("statusColor", () => {
  test("running returns theme.warning", () => {
    expect(statusColor("running", theme)).toBe("WARNING");
  });

  test("complete returns theme.success", () => {
    expect(statusColor("complete", theme)).toBe("SUCCESS");
  });

  test("unknown status returns theme.textDim", () => {
    expect(statusColor("unknown", theme)).toBe("TEXTDIM");
  });
});

describe("statusLabel", () => {
  test("running returns 'running'", () => {
    expect(statusLabel("running")).toBe("running");
  });

  test("complete returns 'done'", () => {
    expect(statusLabel("complete")).toBe("done");
  });

  test("unknown status returns the input string", () => {
    expect(statusLabel("unknown")).toBe("unknown");
  });
});

describe("statusIcon", () => {
  test("running returns '●'", () => {
    expect(statusIcon("running")).toBe("●");
  });

  test("complete returns '✓'", () => {
    expect(statusIcon("complete")).toBe("✓");
  });

  test("unknown status returns '○'", () => {
    expect(statusIcon("unknown")).toBe("○");
  });
});
