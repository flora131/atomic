import { describe, expect, test } from "bun:test";
import {
  getHitlResponseRecord,
  normalizeHitlAnswer,
  type HitlResponseRecord,
} from "@/lib/ui/hitl-response.ts";

describe("normalizeHitlAnswer", () => {
  test("renders empty answers explicitly", () => {
    const result = normalizeHitlAnswer({
      selected: "",
      cancelled: false,
      responseMode: "option",
    });

    expect(result.answerText).toBe("");
    expect(result.displayText).toBe('User answered: ""');
    expect(result.cancelled).toBe(false);
  });

  test("renders declined response", () => {
    const result = normalizeHitlAnswer({
      selected: "",
      cancelled: true,
      responseMode: "declined",
    });

    expect(result.displayText).toBe("User declined to answer.");
    expect(result.cancelled).toBe(true);
    expect(result.responseMode).toBe("declined");
  });

  test("renders chat-about-this response", () => {
    const result = normalizeHitlAnswer({
      selected: "Could we compare options first?",
      cancelled: false,
      responseMode: "chat_about_this",
    });

    expect(result.displayText).toBe("User requested to chat about the question");
  });
});

describe("getHitlResponseRecord", () => {
  test("returns hitlResponse field when present", () => {
    const record: HitlResponseRecord = {
      cancelled: false,
      responseMode: "custom_input",
      answerText: "manual text",
      displayText: 'User answered: "manual text"',
    };

    const result = getHitlResponseRecord({
      hitlResponse: record,
      output: { answer: "stale" },
    });

    expect(result).toEqual(record);
  });

  test("returns null when no hitlResponse", () => {
    const result = getHitlResponseRecord({
      output: { answer: "some output" },
    });
    expect(result).toBeNull();
  });
});
