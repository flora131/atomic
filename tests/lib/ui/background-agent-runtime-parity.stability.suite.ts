import { describe, expect, test } from "bun:test";
import {
  BACKGROUND_FOOTER_CONTRACT,
  BACKGROUND_TREE_HINT_CONTRACT,
  buildParallelAgentsHeaderHint,
  createAgent,
  formatBackgroundAgentFooterStatus,
  getActiveBackgroundAgents,
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
  isBackgroundTerminationKey,
  resolveBackgroundAgentsForFooter,
  type BackgroundFooterContract,
  type BackgroundTerminationDecision,
  type BackgroundTreeHintContract,
} from "./background-agent-runtime-parity.test-support.ts";

describe("Background agent runtime parity (dev/prod invariance)", () => {
  describe("function idempotency", () => {
    test("multiple sequential calls produce identical results (no internal mutation)", () => {
      const agents = [
        createAgent({ id: "bg-1", status: "background" }),
        createAgent({ id: "bg-2", status: "running", background: true }),
      ];

      const results = Array.from({ length: 5 }, () =>
        interruptActiveBackgroundAgents(agents, 1000000005000),
      );

      for (let index = 1; index < results.length; index += 1) {
        expect(results[index]).toEqual(results[0]);
      }

      expect(agents[0]!.status).toBe("background");
      expect(agents[1]!.status).toBe("running");
    });

    test("decision logic is stateless across calls", () => {
      const results = Array.from({ length: 100 }, () =>
        getBackgroundTerminationDecision(0, 2),
      );

      const expected: BackgroundTerminationDecision = {
        action: "warn",
        message: "Press Ctrl-F again to terminate background agents",
      };

      for (const result of results) {
        expect(result).toEqual(expected);
      }
    });

    test("footer formatting is stateless across calls", () => {
      const agents = [createAgent(), createAgent({ id: "2" })];
      const results = Array.from({ length: 50 }, () =>
        formatBackgroundAgentFooterStatus(agents),
      );

      for (const result of results) {
        expect(result).toBe("2 local agents");
      }
    });

    test("tree hint builder is stateless across calls", () => {
      const agents = [createAgent({ status: "background" })];
      const results = Array.from({ length: 50 }, () =>
        buildParallelAgentsHeaderHint(agents, true),
      );

      for (const result of results) {
        expect(result).toBe("background running · ctrl+f to kill all background tasks");
      }
    });
  });

  describe("no environment-conditional behavior", () => {
    test("contract functions work without environment variables", () => {
      const decision = getBackgroundTerminationDecision(0, 1);
      expect(decision.action).toBe("warn");

      expect(isBackgroundTerminationKey({ ctrl: true, name: "f" })).toBe(true);

      const agents = [createAgent({ status: "background" })];
      const interrupted = interruptActiveBackgroundAgents(agents, 1000000005000);
      expect(interrupted.interruptedIds).toEqual(["agent-1"]);

      expect(formatBackgroundAgentFooterStatus(agents)).toBe("1 local agent");
      expect(buildParallelAgentsHeaderHint(agents, true)).toBe(
        "background running · ctrl+f to kill all background tasks",
      );
      expect(getActiveBackgroundAgents(agents).length).toBe(1);
    });

    test("contract constants are accessible without environment setup", () => {
      expect(BACKGROUND_FOOTER_CONTRACT).toBeDefined();
      expect(BACKGROUND_TREE_HINT_CONTRACT).toBeDefined();

      expect(BACKGROUND_FOOTER_CONTRACT).toHaveProperty("showWhenAgentCountAtLeast");
      expect(BACKGROUND_FOOTER_CONTRACT).toHaveProperty("includeTerminateHint");
      expect(BACKGROUND_FOOTER_CONTRACT).toHaveProperty("terminateHintText");
      expect(BACKGROUND_FOOTER_CONTRACT).toHaveProperty("countFormat");

      expect(BACKGROUND_TREE_HINT_CONTRACT).toHaveProperty("whenRunning");
      expect(BACKGROUND_TREE_HINT_CONTRACT).toHaveProperty("whenComplete");
      expect(BACKGROUND_TREE_HINT_CONTRACT).toHaveProperty("defaultHint");
    });
  });

  describe("module export stability", () => {
    test("all contract exports are accessible and have expected types", () => {
      const _typeCheck1: BackgroundTerminationDecision = { action: "none" };
      const _typeCheck2: BackgroundFooterContract = {
        showWhenAgentCountAtLeast: 1,
        includeTerminateHint: true,
        terminateHintText: "test",
        countFormat: "agents",
      };
      const _typeCheck3: BackgroundTreeHintContract = {
        whenRunning: "test",
        whenComplete: "test",
        defaultHint: "test",
      };

      expect(typeof getBackgroundTerminationDecision).toBe("function");
      expect(typeof interruptActiveBackgroundAgents).toBe("function");
      expect(typeof isBackgroundTerminationKey).toBe("function");
      expect(typeof getActiveBackgroundAgents).toBe("function");
      expect(typeof formatBackgroundAgentFooterStatus).toBe("function");
      expect(typeof resolveBackgroundAgentsForFooter).toBe("function");
      expect(typeof buildParallelAgentsHeaderHint).toBe("function");
      expect(typeof BACKGROUND_FOOTER_CONTRACT).toBe("object");
      expect(typeof BACKGROUND_TREE_HINT_CONTRACT).toBe("object");

      void _typeCheck1;
      void _typeCheck2;
      void _typeCheck3;
    });

    test("function signatures remain stable", () => {
      expect(getBackgroundTerminationDecision.length).toBe(2);
      expect(isBackgroundTerminationKey.length).toBe(1);
      expect(interruptActiveBackgroundAgents.length).toBe(1);
      expect(getActiveBackgroundAgents.length).toBe(1);
      expect(formatBackgroundAgentFooterStatus.length).toBe(1);
      expect(resolveBackgroundAgentsForFooter.length).toBe(2);
      expect(buildParallelAgentsHeaderHint.length).toBe(2);
    });

    test("exported contract values are stable and well-defined", () => {
      expect(BACKGROUND_FOOTER_CONTRACT.showWhenAgentCountAtLeast).toBe(1);
      expect(BACKGROUND_FOOTER_CONTRACT.includeTerminateHint).toBe(true);
      expect(BACKGROUND_FOOTER_CONTRACT.terminateHintText).toBeDefined();
      expect(BACKGROUND_FOOTER_CONTRACT.countFormat).toBe("agents");

      expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toBeDefined();
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenComplete).toBeDefined();
      expect(BACKGROUND_TREE_HINT_CONTRACT.defaultHint).toBeDefined();

      const footerRef1 = BACKGROUND_FOOTER_CONTRACT;
      const footerRef2 = BACKGROUND_FOOTER_CONTRACT;
      expect(footerRef1).toBe(footerRef2);

      const treeRef1 = BACKGROUND_TREE_HINT_CONTRACT;
      const treeRef2 = BACKGROUND_TREE_HINT_CONTRACT;
      expect(treeRef1).toBe(treeRef2);
    });
  });
});
