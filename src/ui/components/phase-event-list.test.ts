import { describe, expect, test } from "bun:test";
import React, { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { TREE } from "../constants/icons.ts";
import type { PhaseEvent } from "../commands/workflow-commands.ts";
import {
  DEFAULT_MAX_EVENTS,
  PHASE_EVENT_ICONS,
  PhaseEventList,
  getEffectiveMaxEvents,
  getEventConnector,
  getHiddenEventCount,
  getVisiblePhaseEvents,
} from "./phase-event-list.tsx";

function event(type: PhaseEvent["type"], content: string): PhaseEvent {
  return {
    type,
    content,
    timestamp: new Date().toISOString(),
  };
}

const themeColors = {
  border: "#45475a",
  dim: "#6c7086",
  error: "#f38ba8",
  muted: "#a6adc8",
} as const;

async function renderFrame(node: React.ReactNode): Promise<string> {
  const setup = await testRender(node, { width: 100, height: 12 });
  try {
    await setup.renderOnce();
    return setup.captureCharFrame();
  } finally {
    act(() => {
      setup.renderer.destroy();
    });
  }
}

describe("PhaseEventList helpers", () => {
  test("limits visible events and calculates hidden count", () => {
    const events = [event("text", "1"), event("tool_call", "2"), event("error", "3")];

    expect(getVisiblePhaseEvents(events, 2)).toHaveLength(2);
    expect(getHiddenEventCount(events, 2)).toBe(1);
  });

  test("uses default max events when not provided", () => {
    expect(getEffectiveMaxEvents()).toBe(DEFAULT_MAX_EVENTS);
  });

  test("normalizes invalid maxEvents to zero", () => {
    expect(getEffectiveMaxEvents(-1)).toBe(0);
    expect(getEffectiveMaxEvents(Number.NaN)).toBe(0);
  });

  test("uses last branch only when final item has no overflow", () => {
    expect(getEventConnector(0, 1, 0)).toBe(TREE.lastBranch);
    expect(getEventConnector(1, 2, 1)).toBe(TREE.branch);
  });

  test("covers all phase event icon mappings", () => {
    const types: PhaseEvent["type"][] = [
      "tool_call",
      "tool_result",
      "text",
      "agent_spawn",
      "agent_complete",
      "error",
      "progress",
    ];

    for (const type of types) {
      expect(PHASE_EVENT_ICONS[type]).toBeDefined();
    }
  });
});

describe("PhaseEventList rendering", () => {
  test("renders branch connectors and hidden event summary when truncated", async () => {
    const frame = await renderFrame(
      React.createElement(PhaseEventList, {
        events: [
          event("tool_call", "Gather context"),
          event("error", "Phase failed"),
          event("text", "Recovery output"),
        ],
        maxEvents: 2,
        themeColors,
      }),
    );

    expect(frame).toContain("├─ ▸ Gather context");
    expect(frame).toContain("├─ ✗ Phase failed");
    expect(frame).toContain("└─ ...and 1 more events");
  });

  test("uses last-branch connector for final visible event when no overflow", async () => {
    const frame = await renderFrame(
      React.createElement(PhaseEventList, {
        events: [event("text", "Step 1"), event("tool_result", "Done")],
        themeColors,
      }),
    );

    expect(frame).toContain("├─ · Step 1");
    expect(frame).toContain("└─ ✓ Done");
  });

  test("truncates rendered event content to maxContentLength", async () => {
    const frame = await renderFrame(
      React.createElement(PhaseEventList, {
        events: [event("text", "123456789012345")],
        maxContentLength: 10,
        themeColors,
      }),
    );

    expect(frame).toContain("1234567...");
  });
});
