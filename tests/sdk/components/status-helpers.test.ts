import { test, expect, describe } from "bun:test";
import {
  statusColor,
  statusLabel,
  statusIcon,
  fmtDuration,
} from "../../../src/sdk/components/status-helpers.ts";
import type { GraphTheme } from "../../../src/sdk/components/graph-theme.ts";

const mockTheme: GraphTheme = {
  background: "#1e1e2e",
  backgroundElement: "#313244",
  text: "#cdd6f4",
  textMuted: "#a6adc8",
  textDim: "#7f849c",
  primary: "#89b4fa",
  success: "#a6e3a1",
  error: "#f38ba8",
  warning: "#f9e2af",
  info: "#89b4fa",
  border: "#585b70",
  borderActive: "#6c7086",
};

describe("statusColor", () => {
  test("returns warning color for running", () => {
    expect(statusColor("running", mockTheme)).toBe(mockTheme.warning);
  });

  test("returns success color for complete", () => {
    expect(statusColor("complete", mockTheme)).toBe(mockTheme.success);
  });

  test("returns textDim color for pending", () => {
    expect(statusColor("pending", mockTheme)).toBe(mockTheme.textDim);
  });

  test("returns error color for error", () => {
    expect(statusColor("error", mockTheme)).toBe(mockTheme.error);
  });

  test("returns textDim for unknown status", () => {
    expect(statusColor("unknown", mockTheme)).toBe(mockTheme.textDim);
  });
});

describe("statusLabel", () => {
  test("returns 'running' for running", () => {
    expect(statusLabel("running")).toBe("running");
  });

  test("returns 'done' for complete", () => {
    expect(statusLabel("complete")).toBe("done");
  });

  test("returns 'waiting' for pending", () => {
    expect(statusLabel("pending")).toBe("waiting");
  });

  test("returns 'failed' for error", () => {
    expect(statusLabel("error")).toBe("failed");
  });

  test("returns raw status for unknown status", () => {
    expect(statusLabel("custom")).toBe("custom");
  });
});

describe("statusIcon", () => {
  test("returns filled circle for running", () => {
    expect(statusIcon("running")).toBe("●");
  });

  test("returns checkmark for complete", () => {
    expect(statusIcon("complete")).toBe("✓");
  });

  test("returns empty circle for pending", () => {
    expect(statusIcon("pending")).toBe("○");
  });

  test("returns X for error", () => {
    expect(statusIcon("error")).toBe("✗");
  });

  test("returns empty circle for unknown status", () => {
    expect(statusIcon("unknown")).toBe("○");
  });
});

describe("fmtDuration", () => {
  test("formats zero milliseconds", () => {
    expect(fmtDuration(0)).toBe("0m 00s");
  });

  test("formats seconds only", () => {
    expect(fmtDuration(5000)).toBe("0m 05s");
  });

  test("formats minutes and seconds", () => {
    expect(fmtDuration(125000)).toBe("2m 05s");
  });

  test("pads single-digit seconds", () => {
    expect(fmtDuration(63000)).toBe("1m 03s");
  });

  test("handles exact minute boundary", () => {
    expect(fmtDuration(60000)).toBe("1m 00s");
  });

  test("floors partial seconds", () => {
    expect(fmtDuration(1500)).toBe("0m 01s");
  });

  test("clamps negative values to zero", () => {
    expect(fmtDuration(-1000)).toBe("0m 00s");
  });
});
