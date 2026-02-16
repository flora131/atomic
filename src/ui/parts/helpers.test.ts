import { test, expect, describe } from "bun:test";
import { getMessageText } from "./helpers.ts";
import type { ChatMessage } from "../chat.tsx";

describe("getMessageText", () => {
  test("returns empty string for undefined parts", () => {
    expect(getMessageText({} as ChatMessage)).toBe("");
  });

  test("returns empty string for empty parts", () => {
    expect(getMessageText({ parts: [] } as unknown as ChatMessage)).toBe("");
  });

  test("concatenates multiple TextPart contents", () => {
    const msg = {
      parts: [
        { type: "text", content: "Hello " },
        { type: "tool", toolName: "bash" },
        { type: "text", content: "World" },
      ],
    } as unknown as ChatMessage;
    expect(getMessageText(msg)).toBe("Hello World");
  });

  test("ignores non-text parts", () => {
    const msg = {
      parts: [
        { type: "reasoning", content: "thinking..." },
        { type: "text", content: "actual text" },
      ],
    } as unknown as ChatMessage;
    expect(getMessageText(msg)).toBe("actual text");
  });
});
