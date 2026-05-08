import { test, expect, describe } from "bun:test";
import { statusColor, statusLabel, statusIcon } from "./status-helpers.ts";
import type { GraphTheme } from "./graph-theme.ts";

// ─── Sentinel theme ──────────────────────────────────────────────────────────

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

// ─── statusColor ─────────────────────────────────────────────────────────────

describe("statusColor", () => {
  test("offloaded returns theme.textDim", () => {
    expect(statusColor("offloaded", theme)).toBe("TEXTDIM");
  });

  test("resuming returns theme.warning", () => {
    expect(statusColor("resuming", theme)).toBe("WARNING");
  });

  test("running returns theme.warning (regression)", () => {
    expect(statusColor("running", theme)).toBe("WARNING");
  });

  test("complete returns theme.success (regression)", () => {
    expect(statusColor("complete", theme)).toBe("SUCCESS");
  });

  test("unknown status returns theme.textDim (fallback)", () => {
    expect(statusColor("unknown", theme)).toBe("TEXTDIM");
  });
});

// ─── statusLabel ─────────────────────────────────────────────────────────────

describe("statusLabel", () => {
  test("offloaded returns 'offloaded'", () => {
    expect(statusLabel("offloaded")).toBe("offloaded");
  });

  test("resuming returns 'resuming…'", () => {
    expect(statusLabel("resuming")).toBe("resuming…");
  });

  test("running returns 'running' (regression)", () => {
    expect(statusLabel("running")).toBe("running");
  });

  test("complete returns 'done' (regression)", () => {
    expect(statusLabel("complete")).toBe("done");
  });

  test("unknown status returns the input string (fallback)", () => {
    expect(statusLabel("unknown")).toBe("unknown");
  });
});

// ─── statusIcon ──────────────────────────────────────────────────────────────

describe("statusIcon", () => {
  test("offloaded returns '◌'", () => {
    expect(statusIcon("offloaded")).toBe("◌");
  });

  test("resuming returns '◐'", () => {
    expect(statusIcon("resuming")).toBe("◐");
  });

  test("running returns '●' (regression)", () => {
    expect(statusIcon("running")).toBe("●");
  });

  test("complete returns '✓' (regression)", () => {
    expect(statusIcon("complete")).toBe("✓");
  });

  test("unknown status returns '○' (fallback)", () => {
    expect(statusIcon("unknown")).toBe("○");
  });
});
