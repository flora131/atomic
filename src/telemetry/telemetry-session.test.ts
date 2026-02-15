/**
 * Tests for extractCommandsFromTranscript — extracts slash commands
 * from JSONL transcript format.
 *
 * Test strategy: Pure data transformation. Construct JSONL strings with
 * various command patterns and assert on extracted command array.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { extractCommandsFromTranscript } from "./telemetry-session";

/**
 * Helper to create a valid JSONL user message with string content.
 */
function makeUserMessage(content: string): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content },
  });
}

/**
 * Helper to create a valid JSONL user message with array content (skill instructions).
 */
function makeUserMessageWithArrayContent(textArray: string[]): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: textArray.map((text) => ({ type: "text", text })),
    },
  });
}

/**
 * Helper to create a valid JSONL assistant message.
 */
function makeAssistantMessage(content: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content },
  });
}

/**
 * Helper to create a valid JSONL system message.
 */
function makeSystemMessage(content: string): string {
  return JSON.stringify({
    type: "system",
    message: { role: "system", content },
  });
}

describe("extractCommandsFromTranscript", () => {
  describe("basic extraction", () => {
    test("extracts single command from user message with string content", () => {
      const transcript = makeUserMessage("Please run /ralph for me");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/ralph"]);
    });

    test("returns empty array when no commands are found", () => {
      const transcript = makeUserMessage("Hello, how are you today?");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual([]);
    });

    test("returns empty array for empty transcript", () => {
      const result = extractCommandsFromTranscript("");

      expect(result).toEqual([]);
    });
  });

  describe("multiple commands", () => {
    test("extracts multiple different commands from single message", () => {
      const transcript = makeUserMessage(
        "First run /research-codebase then /create-spec"
      );

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/research-codebase", "/create-spec"]);
    });

    test("extracts duplicate commands to track usage frequency", () => {
      const transcript = makeUserMessage(
        "Run /ralph and then /ralph again, finally /ralph"
      );

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/ralph", "/ralph", "/ralph"]);
    });

    test("extracts commands from multiple user messages in transcript", () => {
      const transcript = [
        makeUserMessage("Let's start with /research-codebase"),
        makeAssistantMessage("OK, I'll do that"),
        makeUserMessage("Now do /create-spec"),
      ].join("\n");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/research-codebase", "/create-spec"]);
    });
  });

  describe("message type filtering", () => {
    test("ignores commands in assistant messages", () => {
      const transcript = [
        makeUserMessage("What commands are available?"),
        makeAssistantMessage(
          "You can use /research-codebase or /create-spec or /explain-code"
        ),
      ].join("\n");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual([]);
    });

    test("ignores commands in system messages", () => {
      const transcript = [
        makeSystemMessage(
          "System instructions: use /ralph for RALPH functionality"
        ),
        makeUserMessage("Got it"),
      ].join("\n");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual([]);
    });
  });

  describe("skill instruction handling", () => {
    test("ignores commands in array content (loaded skill instructions)", () => {
      const transcript = makeUserMessageWithArrayContent([
        "Skill loaded. When you need to research, run /research-codebase",
        "Also use /ralph for RALPH mode",
      ]);

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual([]);
    });

    test("extracts commands from string content but not array content in same transcript", () => {
      const transcript = [
        makeUserMessageWithArrayContent([
          "Skill loaded. Reference /ralph in instructions",
        ]),
        makeUserMessage("Now actually run /ralph"),
      ].join("\n");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/ralph"]);
    });
  });

  describe("word boundary matching", () => {
    test("does not match partial commands embedded in words", () => {
      const transcript = makeUserMessage(
        "I have a file called test/ralph.txt and also fake/create-spec-data"
      );

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual([]);
    });

    test("matches command at start of message", () => {
      const transcript = makeUserMessage("/research-codebase is what I need");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/research-codebase"]);
    });

    test("matches command at end of message", () => {
      const transcript = makeUserMessage("I want to use /ralph");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/ralph"]);
    });

    test("matches command surrounded by punctuation", () => {
      const transcript = makeUserMessage("Run /create-spec, thanks!");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/create-spec"]);
    });
  });

  describe("error handling", () => {
    test("skips invalid JSON lines gracefully", () => {
      const transcript = [
        "this is not valid json",
        makeUserMessage("Run /ralph"),
        "{ broken: json ",
        makeUserMessage("Also /create-spec"),
      ].join("\n");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/ralph", "/create-spec"]);
    });

    test("handles lines with only whitespace", () => {
      const transcript = [
        makeUserMessage("Run /ralph"),
        "   ",
        "\t",
        makeUserMessage("And /create-spec"),
      ].join("\n");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/ralph", "/create-spec"]);
    });
  });

  describe("all known Atomic commands", () => {
    test("extracts /research-codebase command", () => {
      const result = extractCommandsFromTranscript(
        makeUserMessage("Run /research-codebase")
      );
      expect(result).toEqual(["/research-codebase"]);
    });

    test("extracts /create-spec command", () => {
      const result = extractCommandsFromTranscript(
        makeUserMessage("Run /create-spec")
      );
      expect(result).toEqual(["/create-spec"]);
    });

    test("extracts /explain-code command", () => {
      const result = extractCommandsFromTranscript(
        makeUserMessage("Run /explain-code")
      );
      expect(result).toEqual(["/explain-code"]);
    });

    test("extracts /ralph command", () => {
      const result = extractCommandsFromTranscript(
        makeUserMessage("Run /ralph")
      );
      expect(result).toEqual(["/ralph"]);
    });
  });

  describe("edge cases", () => {
    test("extracts command when it is the sole content of a user message", () => {
      const transcript = makeUserMessage("/ralph");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/ralph"]);
    });

    test("handles malformed JSON objects missing the message property", () => {
      const transcript = JSON.stringify({ type: "user" });

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual([]);
    });

    test("handles user message with null content gracefully", () => {
      const transcript = JSON.stringify({
        type: "user",
        message: { role: "user", content: null },
      });

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual([]);
    });

    test("extracts all four known commands from a realistic multi-turn transcript", () => {
      const transcript = [
        makeUserMessage("/research-codebase"),
        makeAssistantMessage("Here is what I found about the codebase..."),
        makeUserMessage("Now please /create-spec for the auth module"),
        makeAssistantMessage("I have created the spec."),
        makeUserMessage("Can you /explain-code src/auth.ts"),
        makeAssistantMessage("This file handles authentication..."),
        makeUserMessage("/ralph"),
        makeAssistantMessage("RALPH mode activated."),
      ].join("\n");

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual([
        "/research-codebase",
        "/create-spec",
        "/explain-code",
        "/ralph",
      ]);
    });

    test("extracts command inside parentheses", () => {
      const transcript = makeUserMessage(
        "Please run the codebase analysis (/research-codebase) now"
      );

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual(["/research-codebase"]);
    });

    test("does not extract unknown slash commands", () => {
      const transcript = makeUserMessage(
        "/unknown-command /help /commit /deploy"
      );

      const result = extractCommandsFromTranscript(transcript);

      expect(result).toEqual([]);
    });
  });
});
