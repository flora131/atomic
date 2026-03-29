import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Structural tests for dispatch controller sub-hooks.
 *
 * These tests go deeper than the decomposition tests (which only verify
 * module exports are functions and files exist). Here we verify:
 * - Hook signatures (arity via `.length`)
 * - Exported types/interfaces (UseXxxArgs, UseXxxResult)
 * - Source-level patterns (imports, return values, key helpers)
 */

// ── Sub-hook imports ───────────────────────────────────────────────────
import {
  useMessageDispatch,
  type UseMessageDispatchArgs,
  type UseMessageDispatchResult,
} from "@/state/chat/controller/use-message-dispatch.ts";
import {
  useCommandDispatch,
  type UseCommandDispatchArgs,
  type UseCommandDispatchResult,
} from "@/state/chat/controller/use-command-dispatch.ts";
import {
  useModelSelection,
  type UseModelSelectionArgs,
  type UseModelSelectionResult,
} from "@/state/chat/controller/use-model-selection.ts";
import {
  useQueueDispatch,
  type UseQueueDispatchArgs,
  type UseQueueDispatchResult,
} from "@/state/chat/controller/use-queue-dispatch.ts";

// ── Source reading helper ──────────────────────────────────────────────

const SRC_DIR = path.resolve(
  import.meta.dir,
  "../../../../src/state/chat/controller",
);

function readSource(filename: string): string {
  return fs.readFileSync(path.join(SRC_DIR, filename), "utf-8");
}

// ========================================================================
// useMessageDispatch
// ========================================================================

describe("useMessageDispatch", () => {
  describe("module exports", () => {
    it("exports useMessageDispatch as a function", () => {
      expect(typeof useMessageDispatch).toBe("function");
    });

    it("exports UseMessageDispatchArgs interface (type-level check via import)", () => {
      // Type-only imports are erased at runtime. We verify the source
      // actually declares the interface so the import succeeds.
      const source = readSource("use-message-dispatch.ts");
      expect(source).toContain("export interface UseMessageDispatchArgs");
    });

    it("exports UseMessageDispatchResult interface (type-level check via import)", () => {
      const source = readSource("use-message-dispatch.ts");
      expect(source).toContain("export interface UseMessageDispatchResult");
    });
  });

  describe("hook arity", () => {
    it("takes a single args object (length === 1)", () => {
      expect(useMessageDispatch.length).toBe(1);
    });
  });

  describe("source-level patterns", () => {
    const source = readSource("use-message-dispatch.ts");

    it("returns addMessage callback", () => {
      expect(source).toContain("addMessage");
    });

    it("returns setStreamingWithFinalize callback", () => {
      expect(source).toContain("setStreamingWithFinalize");
    });

    it("returns sendMessage callback", () => {
      expect(source).toContain("sendMessage");
    });

    it("imports useCallback from react", () => {
      expect(source).toMatch(/import\s*\{[^}]*useCallback[^}]*\}\s*from\s*["']react["']/);
    });

    it("uses useCallback to wrap at least one function", () => {
      // Verify useCallback is actually called, not just imported
      expect(source).toContain("useCallback(");
    });

    it("contains fullyFinalizeStreamingMessage helper function", () => {
      expect(source).toContain("function fullyFinalizeStreamingMessage(");
    });

    it("fullyFinalizeStreamingMessage finalizes streaming reasoning parts", () => {
      expect(source).toContain("finalizeStreamingReasoningParts");
    });

    it("fullyFinalizeStreamingMessage finalizes streaming text parts", () => {
      expect(source).toContain("finalizeStreamingTextParts");
    });

    it("fullyFinalizeStreamingMessage calls finalizeStreamingReasoningInMessage", () => {
      expect(source).toContain("finalizeStreamingReasoningInMessage");
    });
  });
});

// ========================================================================
// useCommandDispatch
// ========================================================================

describe("useCommandDispatch", () => {
  describe("module exports", () => {
    it("exports useCommandDispatch as a function", () => {
      expect(typeof useCommandDispatch).toBe("function");
    });

    it("exports UseCommandDispatchArgs interface (type-level check via import)", () => {
      const source = readSource("use-command-dispatch.ts");
      expect(source).toContain("export interface UseCommandDispatchArgs");
    });

    it("exports UseCommandDispatchResult interface (type-level check via import)", () => {
      const source = readSource("use-command-dispatch.ts");
      expect(source).toContain("export interface UseCommandDispatchResult");
    });
  });

  describe("hook arity", () => {
    it("takes a single args object (length === 1)", () => {
      expect(useCommandDispatch.length).toBe(1);
    });
  });

  describe("source-level patterns", () => {
    const source = readSource("use-command-dispatch.ts");

    it("returns executeCommand", () => {
      expect(source).toContain("executeCommand");
    });

    it("handles initialPrompt via useEffect", () => {
      expect(source).toMatch(/import\s*\{[^}]*useEffect[^}]*\}\s*from\s*["']react["']/);
      expect(source).toContain("useEffect(");
      expect(source).toContain("initialPrompt");
    });

    it("imports parseSlashCommand for command parsing", () => {
      expect(source).toContain("parseSlashCommand");
      expect(source).toMatch(/import\s*\{[^}]*parseSlashCommand[^}]*\}/);
    });

    it("imports processFileMentions for file mention handling", () => {
      expect(source).toContain("processFileMentions");
      expect(source).toMatch(/import\s*\{[^}]*processFileMentions[^}]*\}/);
    });
  });
});

// ========================================================================
// useModelSelection
// ========================================================================

describe("useModelSelection", () => {
  describe("module exports", () => {
    it("exports useModelSelection as a function", () => {
      expect(typeof useModelSelection).toBe("function");
    });

    it("exports UseModelSelectionArgs interface (type-level check via import)", () => {
      const source = readSource("use-model-selection.ts");
      expect(source).toContain("export interface UseModelSelectionArgs");
    });

    it("exports UseModelSelectionResult interface (type-level check via import)", () => {
      const source = readSource("use-model-selection.ts");
      expect(source).toContain("export interface UseModelSelectionResult");
    });
  });

  describe("hook arity", () => {
    it("takes a single args object (length === 1)", () => {
      expect(useModelSelection.length).toBe(1);
    });
  });

  describe("source-level patterns", () => {
    const source = readSource("use-model-selection.ts");

    it("returns handleModelSelect callback", () => {
      expect(source).toContain("handleModelSelect");
    });

    it("returns handleModelSelectorCancel callback", () => {
      expect(source).toContain("handleModelSelectorCancel");
    });

    it("imports saveModelPreference from settings", () => {
      expect(source).toMatch(/import\s*\{[^}]*saveModelPreference[^}]*\}/);
    });

    it("imports saveReasoningEffortPreference from settings", () => {
      expect(source).toMatch(/import\s*\{[^}]*saveReasoningEffortPreference[^}]*\}/);
    });

    it("imports clearReasoningEffortPreference from settings", () => {
      expect(source).toMatch(/import\s*\{[^}]*clearReasoningEffortPreference[^}]*\}/);
    });

    it("uses useCallback from react", () => {
      expect(source).toMatch(/import\s*\{[^}]*useCallback[^}]*\}\s*from\s*["']react["']/);
      expect(source).toContain("useCallback(");
    });
  });
});

// ========================================================================
// useQueueDispatch
// ========================================================================

describe("useQueueDispatch", () => {
  describe("module exports", () => {
    it("exports useQueueDispatch as a function", () => {
      expect(typeof useQueueDispatch).toBe("function");
    });

    it("exports UseQueueDispatchArgs interface (type-level check via import)", () => {
      const source = readSource("use-queue-dispatch.ts");
      expect(source).toContain("export interface UseQueueDispatchArgs");
    });

    it("exports UseQueueDispatchResult interface (type-level check via import)", () => {
      const source = readSource("use-queue-dispatch.ts");
      expect(source).toContain("export interface UseQueueDispatchResult");
    });
  });

  describe("hook arity", () => {
    it("takes a single args object (length === 1)", () => {
      expect(useQueueDispatch.length).toBe(1);
    });
  });

  describe("source-level patterns", () => {
    const source = readSource("use-queue-dispatch.ts");

    it("returns dispatchDeferredCommandMessage", () => {
      expect(source).toContain("dispatchDeferredCommandMessage");
    });

    it("returns dispatchQueuedMessage", () => {
      expect(source).toContain("dispatchQueuedMessage");
    });

    it("uses useStableCallback instead of useCallback+ref pattern", () => {
      expect(source).toContain("useStableCallback");
      expect(source).toMatch(/import\s*\{[^}]*useStableCallback[^}]*\}/);
    });

    it("assigns to refs for external consumers", () => {
      expect(source).toContain("dispatchQueuedMessageRef.current =");
      expect(source).toContain("dispatchDeferredCommandMessageRef.current =");
    });
  });
});
