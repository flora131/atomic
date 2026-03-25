import { describe, expect, test } from "bun:test";

/**
 * Structural tests verifying that the decomposed stream runtime
 * sub-hooks are correctly exported and that the façade composes them.
 */

describe("use-runtime decomposition", () => {
  describe("sub-hook module exports", () => {
    test("use-stream-state exports useStreamState", async () => {
      const mod = await import("@/state/chat/stream/use-stream-state.ts");
      expect(mod.useStreamState).toBeFunction();
    });

    test("use-stream-refs exports useStreamRefs", async () => {
      const mod = await import("@/state/chat/stream/use-stream-refs.ts");
      expect(mod.useStreamRefs).toBeFunction();
    });

    test("use-stream-actions exports useStreamActions", async () => {
      const mod = await import("@/state/chat/stream/use-stream-actions.ts");
      expect(mod.useStreamActions).toBeFunction();
    });

    test("use-stream-actions exports UseStreamActionsArgs interface type", async () => {
      // Verify the module can be loaded (type exports verified via typecheck)
      const mod = await import("@/state/chat/stream/use-stream-actions.ts");
      expect(mod).toBeDefined();
    });
  });

  describe("façade module", () => {
    test("use-runtime exports useChatStreamRuntime", async () => {
      const mod = await import("@/state/chat/stream/use-runtime.ts");
      expect(mod.useChatStreamRuntime).toBeFunction();
    });

    test("façade does not re-export sub-hook internals", async () => {
      const mod = await import("@/state/chat/stream/use-runtime.ts");
      expect(mod).not.toHaveProperty("useStreamState");
      expect(mod).not.toHaveProperty("useStreamRefs");
      expect(mod).not.toHaveProperty("useStreamActions");
    });
  });

  describe("barrel index", () => {
    test("stream index re-exports useChatStreamRuntime", async () => {
      const mod = await import("@/state/chat/stream/index.ts");
      expect(mod.useChatStreamRuntime).toBeFunction();
    });
  });
});
