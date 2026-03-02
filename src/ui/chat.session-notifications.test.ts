import { describe, expect, test } from "bun:test";
import {
  formatSessionTruncationMessage,
  getAutoCompactionIndicatorState,
} from "./chat.tsx";

describe("chat session notification helpers", () => {
  test("formats truncation message with singular/plural message count", () => {
    expect(formatSessionTruncationMessage(42, 1)).toContain(
      "42 tokens removed (1 message)",
    );
    expect(formatSessionTruncationMessage(42, 2)).toContain(
      "42 tokens removed (2 messages)",
    );
  });

  test("maps compaction start to running indicator", () => {
    expect(getAutoCompactionIndicatorState("start")).toEqual({
      status: "running",
    });
  });

  test("maps compaction complete to completed indicator by default", () => {
    expect(getAutoCompactionIndicatorState("complete")).toEqual({
      status: "completed",
    });
  });

  test("maps compaction failure to error indicator with trimmed message", () => {
    expect(
      getAutoCompactionIndicatorState("complete", false, " summarize failed "),
    ).toEqual({
      status: "error",
      errorMessage: "summarize failed",
    });
  });
});
