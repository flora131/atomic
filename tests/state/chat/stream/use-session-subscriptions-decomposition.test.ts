import { describe, expect, test } from "bun:test";

/**
 * Structural tests verifying that the decomposed session subscription
 * sub-hooks are correctly exported and that the façade composes them.
 */

describe("use-session-subscriptions decomposition", () => {
  describe("sub-hook module exports", () => {
    test("use-session-lifecycle-events exports useSessionLifecycleEvents", async () => {
      const mod = await import("@/state/chat/stream/use-session-lifecycle-events.ts");
      expect(mod.useSessionLifecycleEvents).toBeFunction();
    });

    test("use-session-message-events exports useSessionMessageEvents", async () => {
      const mod = await import("@/state/chat/stream/use-session-message-events.ts");
      expect(mod.useSessionMessageEvents).toBeFunction();
    });

    test("use-session-metadata-events exports useSessionMetadataEvents", async () => {
      const mod = await import("@/state/chat/stream/use-session-metadata-events.ts");
      expect(mod.useSessionMetadataEvents).toBeFunction();
    });

    test("use-session-hitl-events exports useSessionHitlEvents", async () => {
      const mod = await import("@/state/chat/stream/use-session-hitl-events.ts");
      expect(mod.useSessionHitlEvents).toBeFunction();
    });
  });

  describe("façade module exports", () => {
    test("use-session-subscriptions exports useStreamSessionSubscriptions", async () => {
      const mod = await import("@/state/chat/stream/use-session-subscriptions.ts");
      expect(mod.useStreamSessionSubscriptions).toBeFunction();
    });

    test("façade module has no other named exports besides the façade function", async () => {
      const mod = await import("@/state/chat/stream/use-session-subscriptions.ts");
      const keys = Object.keys(mod);
      expect(keys).toEqual(["useStreamSessionSubscriptions"]);
    });
  });

  describe("barrel re-exports", () => {
    test("stream/index.ts re-exports all sub-hooks", async () => {
      const mod = await import("@/state/chat/stream/index.ts");
      expect(mod.useSessionLifecycleEvents).toBeFunction();
      expect(mod.useSessionMessageEvents).toBeFunction();
      expect(mod.useSessionMetadataEvents).toBeFunction();
      expect(mod.useSessionHitlEvents).toBeFunction();
    });

    test("stream/index.ts re-exports the façade", async () => {
      const mod = await import("@/state/chat/stream/index.ts");
      expect(mod.useStreamSessionSubscriptions).toBeFunction();
    });
  });
});
