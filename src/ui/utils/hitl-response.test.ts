import { describe, expect, test } from "bun:test";
import {
  getHitlResponseRecord,
  normalizeHitlAnswer,
  type HitlResponseRecord,
} from "./hitl-response.ts";

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

    expect(result.displayText).toBe("User declined to answer question.");
    expect(result.cancelled).toBe(true);
    expect(result.responseMode).toBe("declined");
  });

  test("renders chat-about-this response", () => {
    const result = normalizeHitlAnswer({
      selected: "Could we compare options first?",
      cancelled: false,
      responseMode: "chat_about_this",
    });

    expect(result.displayText).toBe('User decided to chat more about options: "Could we compare options first?"');
  });
});

describe("getHitlResponseRecord", () => {
  test("extracts legacy output shape", () => {
    const result = getHitlResponseRecord({
      output: {
        answer: "",
        cancelled: false,
      },
    });

    expect(result).toBeTruthy();
    expect(result?.displayText).toBe('User answered: ""');
  });

  test("prefers structured hitlResponse field", () => {
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
});
