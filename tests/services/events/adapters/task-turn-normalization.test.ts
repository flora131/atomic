import { describe, expect, test } from "bun:test";
import {
  createTurnMetadataState,
  normalizeAgentTaskMetadata,
  normalizeTurnEndMetadata,
  normalizeTurnStartId,
  resetTurnMetadataState,
} from "@/services/events/adapters/task-turn-normalization.ts";

describe("task-turn-normalization", () => {
  test("normalizes agent task metadata without runtime flag branching", () => {
    expect(
      normalizeAgentTaskMetadata({
        task: "",
        agentType: "researcher",
        isBackground: false,
      }),
    ).toEqual({
      task: "researcher",
      isBackground: false,
    });

    expect(
      normalizeAgentTaskMetadata({
        task: "",
        agentType: "",
        isBackground: false,
      }),
    ).toEqual({
      task: "task",
      isBackground: false,
    });
  });

  test("keeps synthetic turn id stable across start/end when ids are missing", () => {
    const state = createTurnMetadataState();
    const turnId = normalizeTurnStartId(undefined, state);
    const end = normalizeTurnEndMetadata({ stop_reason: "tool_use" }, state);

    expect(turnId).toMatch(/^turn_\d+_1$/);
    expect(end.turnId).toBe(turnId);
    expect(end.finishReason).toBe("tool-calls");
    expect(end.rawFinishReason).toBe("tool_use");
  });

  test("resets turn metadata state", () => {
    const state = createTurnMetadataState();
    const first = normalizeTurnStartId(undefined, state);
    expect(first).toMatch(/^turn_\d+_1$/);

    resetTurnMetadataState(state);
    const second = normalizeTurnStartId(undefined, state);
    expect(second).toMatch(/^turn_\d+_1$/);
  });
});
