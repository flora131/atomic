import { describe, it, expect } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Decomposition integration tests for useChatDispatchController.
 *
 * These tests validate that the original monolithic hook has been properly
 * decomposed into focused sub-hooks while maintaining the same public API.
 *
 * What we validate here:
 * - Each sub-hook module exports the expected function and type interfaces
 * - The façade still exports useChatDispatchController
 * - The barrel index re-exports the façade correctly
 * - The controller directory contains all expected files
 * - useStableCallback utility is available from the hooks barrel
 */

// ── Sub-hook module imports ────────────────────────────────────────────
import { useMessageDispatch } from "@/state/chat/controller/use-message-dispatch.ts";
import { useCommandDispatch } from "@/state/chat/controller/use-command-dispatch.ts";
import { useModelSelection } from "@/state/chat/controller/use-model-selection.ts";
import { useQueueDispatch } from "@/state/chat/controller/use-queue-dispatch.ts";

// ── Façade import ──────────────────────────────────────────────────────
import { useChatDispatchController } from "@/state/chat/controller/use-dispatch-controller.ts";

// ── Barrel re-export ───────────────────────────────────────────────────
import { useChatDispatchController as barrelExport } from "@/state/chat/controller/index.ts";

// ── Utility hook imports ───────────────────────────────────────────────
import { useStableCallback } from "@/hooks/index.ts";

const CONTROLLER_DIR = join(
  import.meta.dir,
  "../../../../src/state/chat/controller",
);

describe("useChatDispatchController decomposition", () => {
  describe("module exports", () => {
    it("useMessageDispatch is exported as a function", () => {
      expect(typeof useMessageDispatch).toBe("function");
    });

    it("useCommandDispatch is exported as a function", () => {
      expect(typeof useCommandDispatch).toBe("function");
    });

    it("useModelSelection is exported as a function", () => {
      expect(typeof useModelSelection).toBe("function");
    });

    it("useQueueDispatch is exported as a function", () => {
      expect(typeof useQueueDispatch).toBe("function");
    });
  });

  describe("façade", () => {
    it("useChatDispatchController is still exported from the original module", () => {
      expect(typeof useChatDispatchController).toBe("function");
    });

    it("useChatDispatchController is re-exported from the barrel index", () => {
      expect(barrelExport).toBe(useChatDispatchController);
    });
  });

  describe("utility hooks", () => {
    it("useStableCallback is available from @/hooks", () => {
      expect(typeof useStableCallback).toBe("function");
    });
  });

  describe("controller directory structure", () => {
    const expectedFiles = [
      "use-message-dispatch.ts",
      "use-command-dispatch.ts",
      "use-model-selection.ts",
      "use-queue-dispatch.ts",
      "use-dispatch-controller.ts",
      "index.ts",
    ];

    for (const file of expectedFiles) {
      it(`contains ${file}`, () => {
        expect(existsSync(join(CONTROLLER_DIR, file))).toBe(true);
      });
    }
  });
});
