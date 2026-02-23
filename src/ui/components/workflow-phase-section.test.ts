import { afterEach, describe, expect, mock, test } from "bun:test";
import React, { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { STATUS, TASK, MISC } from "../constants/icons.ts";
import type { PhaseData } from "../commands/workflow-commands.ts";

const basePhase: PhaseData = {
  nodeId: "phase-1",
  phaseName: "Planning",
  phaseIcon: "⚙",
  message: "Planning approach",
  events: [
    { type: "text", timestamp: "2026-02-22T00:00:00.000Z", content: "Started planning" },
    { type: "tool_call", timestamp: "2026-02-22T00:00:01.000Z", content: "Search codebase" },
  ],
  startedAt: "2026-02-22T00:00:00.000Z",
  status: "running",
};

function mockThemeModule(): void {
  mock.module("../theme.tsx", () => ({
    useThemeColors: () => ({
      accent: "#94e2d5",
      success: "#a6e3a1",
      error: "#f38ba8",
      muted: "#6c7086",
      foreground: "#cdd6f4",
      dim: "#585b70",
    }),
  }));
}

async function loadModule() {
  mockThemeModule();
  return import(`./workflow-phase-section.tsx?test=${Math.random()}`);
}

async function renderFrame(node: React.ReactNode): Promise<string> {
  const setup = await testRender(node, { width: 100, height: 8 });
  try {
    await setup.renderOnce();
    return setup.captureCharFrame();
  } finally {
    act(() => {
      setup.renderer.destroy();
    });
  }
}

afterEach(() => {
  mock.restore();
});

describe("WorkflowPhaseSection helpers", () => {
  test("maps phase statuses to icons", async () => {
    const { getPhaseStatusIcon } = await loadModule();
    expect(getPhaseStatusIcon("running")).toBe(STATUS.pending);
    expect(getPhaseStatusIcon("completed")).toBe(STATUS.active);
    expect(getPhaseStatusIcon("error")).toBe(STATUS.error);
  });

  test("maps phase statuses to theme color keys", async () => {
    const { getPhaseStatusColorKey } = await loadModule();
    expect(getPhaseStatusColorKey("running")).toBe("accent");
    expect(getPhaseStatusColorKey("completed")).toBe("success");
    expect(getPhaseStatusColorKey("error")).toBe("error");
  });

  test("uses right/down toggle icons by expansion state", async () => {
    const { getPhaseToggleIcon } = await loadModule();
    expect(getPhaseToggleIcon(false)).toBe(TASK.active);
    expect(getPhaseToggleIcon(true)).toBe(MISC.collapsed);
  });

  test("formats collapsed event summary label", async () => {
    const { getCollapsedEventSummary } = await loadModule();
    expect(getCollapsedEventSummary(0)).toBeNull();
    expect(getCollapsedEventSummary(1)).toBe("1 event");
    expect(getCollapsedEventSummary(7)).toBe("7 events");
  });
});

describe("WorkflowPhaseSection rendering", () => {
  test("renders collapsed phase row with duration and event summary", async () => {
    const { WorkflowPhaseSection } = await loadModule();
    const frame = await renderFrame(
      React.createElement(
        WorkflowPhaseSection,
        {
          phase: { ...basePhase, status: "running", durationMs: 2200 },
          expanded: false,
        },
        React.createElement("text", null, "hidden details"),
      ),
    );

    expect(frame).toContain("▸");
    expect(frame).toContain("○");
    expect(frame).toContain("Planning approach");
    expect(frame).toContain("(2s)");
    expect(frame).toContain("· 2 events");
    expect(frame).not.toContain("hidden details");
  });

  test("renders expanded children and omits collapsed summary", async () => {
    const { WorkflowPhaseSection } = await loadModule();
    const frame = await renderFrame(
      React.createElement(
        WorkflowPhaseSection,
        {
          phase: { ...basePhase, status: "completed", durationMs: 2200 },
          expanded: true,
        },
        React.createElement("text", null, "visible details"),
      ),
    );

    expect(frame).toContain("▾");
    expect(frame).toContain("●");
    expect(frame).toContain("visible details");
    expect(frame).not.toContain("· 2 events");
  });
});
