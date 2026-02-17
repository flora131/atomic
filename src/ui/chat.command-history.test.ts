/**
 * Integration tests for command history persistence in chat.tsx.
 *
 * These tests verify the interaction between the persistence layer
 * (command-history.ts) and the chat UI's submission and navigation logic.
 *
 * Since the project avoids React rendering tests, we test:
 * - Persistence round-trips that mirror handleSubmit behavior
 * - The cursorOffset gate conditions for history navigation
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

import {
  loadCommandHistory,
  appendCommandHistory,
  clearCommandHistory,
  getCommandHistoryPath,
} from "./utils/command-history.ts";

// Isolated temp directory for each test run
const TEST_HOME = join(tmpdir(), `atomic-chat-hist-integ-${process.pid}`);
const HISTORY_DIR = dirname(join(TEST_HOME, ".atomic", ".command_history"));

beforeEach(() => {
  process.env.ATOMIC_SETTINGS_HOME = TEST_HOME;
  mkdirSync(HISTORY_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.ATOMIC_SETTINGS_HOME;
  try {
    rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

/**
 * Extracted decision logic from chat.tsx up-arrow handler.
 * Returns true if history navigation should occur (rather than text navigation).
 *
 * See src/ui/chat.tsx — the up arrow handler checks these conditions:
 *   event.name === "up" && !showAutocomplete && !isEditingQueue &&
 *   !isStreaming && messageQueue.count === 0 && promptHistory.length > 0
 *   && textarea.cursorOffset === 0
 */
function shouldNavigateHistoryUp(params: {
  cursorOffset: number;
  showAutocomplete: boolean;
  isEditingQueue: boolean;
  isStreaming: boolean;
  messageQueueCount: number;
  promptHistoryLength: number;
}): boolean {
  return (
    !params.showAutocomplete &&
    !params.isEditingQueue &&
    !params.isStreaming &&
    params.messageQueueCount === 0 &&
    params.promptHistoryLength > 0 &&
    params.cursorOffset === 0
  );
}

/**
 * Extracted decision logic from chat.tsx down-arrow handler.
 * Returns true if forward history navigation should occur.
 */
function shouldNavigateHistoryDown(params: {
  cursorOffset: number;
  showAutocomplete: boolean;
  isEditingQueue: boolean;
  isStreaming: boolean;
  messageQueueCount: number;
  historyIndex: number;
}): boolean {
  return (
    !params.showAutocomplete &&
    !params.isEditingQueue &&
    !params.isStreaming &&
    params.messageQueueCount === 0 &&
    params.historyIndex >= 0 &&
    params.cursorOffset === 0
  );
}

const defaultUpParams = {
  cursorOffset: 0,
  showAutocomplete: false,
  isEditingQueue: false,
  isStreaming: false,
  messageQueueCount: 0,
  promptHistoryLength: 3,
};

const defaultDownParams = {
  cursorOffset: 0,
  showAutocomplete: false,
  isEditingQueue: false,
  isStreaming: false,
  messageQueueCount: 0,
  historyIndex: 1,
};

describe("chat command history integration", () => {
  describe("cursor-offset gate for up arrow", () => {
    test("allows history navigation when cursorOffset === 0 and history exists", () => {
      expect(shouldNavigateHistoryUp(defaultUpParams)).toBe(true);
    });

    test("blocks history navigation when cursorOffset > 0", () => {
      expect(
        shouldNavigateHistoryUp({ ...defaultUpParams, cursorOffset: 5 }),
      ).toBe(false);
    });

    test("blocks history navigation when autocomplete is showing", () => {
      expect(
        shouldNavigateHistoryUp({ ...defaultUpParams, showAutocomplete: true }),
      ).toBe(false);
    });

    test("blocks history navigation when history is empty", () => {
      expect(
        shouldNavigateHistoryUp({ ...defaultUpParams, promptHistoryLength: 0 }),
      ).toBe(false);
    });
  });

  describe("cursor-offset gate for down arrow", () => {
    test("allows forward navigation when cursorOffset === 0 and historyIndex >= 0", () => {
      expect(shouldNavigateHistoryDown(defaultDownParams)).toBe(true);
    });

    test("blocks forward navigation when cursorOffset > 0", () => {
      expect(
        shouldNavigateHistoryDown({ ...defaultDownParams, cursorOffset: 10 }),
      ).toBe(false);
    });

    test("blocks forward navigation when not in history (historyIndex === -1)", () => {
      expect(
        shouldNavigateHistoryDown({ ...defaultDownParams, historyIndex: -1 }),
      ).toBe(false);
    });
  });

  describe("prompt submission persists to history", () => {
    test("appendCommandHistory writes submitted text that loadCommandHistory reads back", () => {
      // Simulates what handleSubmit does: append trimmedValue to disk
      const submitted = "explain the authentication flow";
      appendCommandHistory(submitted);

      const loaded = loadCommandHistory();
      expect(loaded).toEqual([submitted]);
    });

    test("consecutive duplicate submissions are deduplicated by the caller (not persistence layer)", () => {
      // The persistence layer itself does NOT deduplicate — that's the React state's job.
      // Both writes go to disk; the in-memory state deduplicates via setPromptHistory.
      appendCommandHistory("same command");
      appendCommandHistory("same command");

      const loaded = loadCommandHistory();
      // Both are persisted to disk — the spec says dedup happens in React state only
      expect(loaded).toEqual(["same command", "same command"]);
    });
  });

  describe("slash commands are persisted like regular prompts", () => {
    test("slash commands round-trip through persistence", () => {
      // handleSubmit appends trimmedValue before parsing slash commands,
      // so /help, /clear, etc. are all persisted
      appendCommandHistory("/help");
      appendCommandHistory("/clear");
      appendCommandHistory("regular prompt");

      const loaded = loadCommandHistory();
      expect(loaded).toEqual(["/help", "/clear", "regular prompt"]);
    });
  });

  describe("history loads on startup (simulated)", () => {
    test("persisted entries from previous session are available for new session", () => {
      // Session 1: user submits prompts
      appendCommandHistory("first session command 1");
      appendCommandHistory("first session command 2");

      // Session 2: loadCommandHistory is called on mount (useEffect)
      const persisted = loadCommandHistory();
      expect(persisted).toEqual([
        "first session command 1",
        "first session command 2",
      ]);
      // These would be fed into setPromptHistory(persisted)
      expect(persisted.length).toBeGreaterThan(0);
    });
  });
});
