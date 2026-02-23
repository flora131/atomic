/**
 * Acceptance Tests for Issue #258: Background Agent UX Contracts
 *
 * This file provides fixture-based acceptance checks that validate the exact
 * text and behavior documented in issue #258 against the canonical contract
 * constants. These serve as the machine-readable equivalent of screenshot
 * acceptance testing.
 *
 * @see https://github.com/user/repo/issues/258
 */

import { describe, expect, test } from "bun:test";
import {
  BACKGROUND_FOOTER_CONTRACT,
  BACKGROUND_TREE_HINT_CONTRACT,
} from "./background-agent-contracts.ts";
import {
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
} from "./background-agent-termination.ts";
import {
  formatBackgroundAgentFooterStatus,
  getActiveBackgroundAgents,
} from "./background-agent-footer.ts";
import { buildParallelAgentsHeaderHint } from "./background-agent-tree-hints.ts";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

/**
 * Creates a test agent with sensible defaults.
 * Helper used throughout acceptance tests to construct minimal fixture data.
 */
function createAgent(overrides: Partial<ParallelAgent>): ParallelAgent {
  return {
    id: overrides.id ?? "agent-1",
    name: overrides.name ?? "task",
    task: overrides.task ?? "Background task",
    status: overrides.status ?? "background",
    background: overrides.background,
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    currentTool: overrides.currentTool,
    durationMs: overrides.durationMs,
    result: overrides.result,
  };
}

describe("Issue #258 acceptance: background agent UX behavior", () => {
  
  describe("Acceptance: Footer behavior", () => {
    test("footer shows terminate hint matching 'ctrl+f terminate'", () => {
      // This is the exact text shown in the footer per issue #258
      expect(BACKGROUND_FOOTER_CONTRACT.terminateHintText).toBe("ctrl+f terminate");
    });
    
    test("footer becomes visible with 1+ active agents", () => {
      // Footer should appear as soon as the first background agent starts
      expect(BACKGROUND_FOOTER_CONTRACT.showWhenAgentCountAtLeast).toBe(1);
    });
    
    test("footer includes terminate hint", () => {
      // Confirms the footer contract specifies showing the hint
      expect(BACKGROUND_FOOTER_CONTRACT.includeTerminateHint).toBe(true);
    });
    
    test("footer count format uses 'agents' labeling", () => {
      // Confirms the contract uses "agents" (not "tasks") for count text
      expect(BACKGROUND_FOOTER_CONTRACT.countFormat).toBe("agents");
    });
    
    test("footer status format includes agent count", () => {
      // Validate actual formatting function output
      const agents = [
        createAgent({ id: "bg-1", background: true }),
        createAgent({ id: "bg-2", background: true }),
        createAgent({ id: "bg-3", background: true }),
      ];
      
      const status = formatBackgroundAgentFooterStatus(agents);
      expect(status).toContain("3");
      expect(status).toContain("background");
      expect(status).toContain("agent");
    });
  });
  
  describe("Acceptance: Ctrl+F termination flow", () => {
    test("first Ctrl+F press with active agents → warning with instruction text", () => {
      // First press should warn user, not immediately terminate
      const decision = getBackgroundTerminationDecision(0, 2);
      expect(decision.action).toBe("warn");
      expect(decision).toHaveProperty("message");
      
      if (decision.action === "warn") {
        expect(decision.message).toContain("Ctrl-F");
        expect(decision.message).toContain("terminate");
      }
    });
    
    test("second Ctrl+F press → terminates with confirmation", () => {
      // Second press should execute termination
      const decision = getBackgroundTerminationDecision(1, 2);
      expect(decision.action).toBe("terminate");
      
      if (decision.action === "terminate") {
        expect(decision.message).toContain("killed");
      }
    });
    
    test("Ctrl+F with no active agents → no action", () => {
      // When no active agents exist, Ctrl+F does nothing
      const decision = getBackgroundTerminationDecision(0, 0);
      expect(decision.action).toBe("none");
    });
    
    test("full acceptance: warn → terminate → agents interrupted", () => {
      // End-to-end validation of the complete termination flow
      const agents: ParallelAgent[] = [
        createAgent({ id: "bg-1", status: "background", background: true }),
        createAgent({ id: "bg-2", status: "running", background: true }),
      ];
      
      // First press: warning
      const activeCount = getActiveBackgroundAgents(agents).length;
      expect(activeCount).toBe(2);
      
      const warn = getBackgroundTerminationDecision(0, activeCount);
      expect(warn.action).toBe("warn");
      
      // Second press: terminate
      const terminate = getBackgroundTerminationDecision(1, activeCount);
      expect(terminate.action).toBe("terminate");
      
      // Execute termination
      const result = interruptActiveBackgroundAgents(agents);
      expect(result.interruptedIds).toEqual(["bg-1", "bg-2"]);
      expect(result.agents.every(a => a.status === "interrupted")).toBe(true);
      
      // After termination, no more active agents
      expect(getActiveBackgroundAgents(result.agents)).toHaveLength(0);
    });
  });
  
  describe("Acceptance: Tree hint behavior", () => {
    test("running agents hint contains 'background running' and 'ctrl+f terminate'", () => {
      // Exact wording for running state hint per issue #258
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toBe("background running · ctrl+f terminate");
    });
    
    test("completed agents hint contains 'background complete' and 'ctrl+o to expand'", () => {
      // Exact wording for completed state hint per issue #258
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenComplete).toBe("background complete · ctrl+o to expand");
    });
    
    test("default hint is 'ctrl+o to expand'", () => {
      // Fallback hint when no background agents are present
      expect(BACKGROUND_TREE_HINT_CONTRACT.defaultHint).toBe("ctrl+o to expand");
    });
    
    test("tree hint builder produces correct strings for each state", () => {
      // Validate that the function correctly uses the contract constants
      
      // Running state
      const runningAgents = [
        createAgent({ id: "bg-1", status: "running", background: true }),
      ];
      const runningHint = buildParallelAgentsHeaderHint(runningAgents, true);
      expect(runningHint).toBe(BACKGROUND_TREE_HINT_CONTRACT.whenRunning);
      
      // Completed state
      const completedAgents = [
        createAgent({ id: "bg-1", status: "completed", background: true }),
      ];
      const completedHint = buildParallelAgentsHeaderHint(completedAgents, true);
      expect(completedHint).toBe(BACKGROUND_TREE_HINT_CONTRACT.whenComplete);
      
      // Default state (no background agents)
      const noBackgroundAgents = [
        createAgent({ id: "fg-1", status: "running", background: false }),
      ];
      const defaultHint = buildParallelAgentsHeaderHint(noBackgroundAgents, true);
      expect(defaultHint).toBe(BACKGROUND_TREE_HINT_CONTRACT.defaultHint);
      
      // Empty agents array
      const emptyHint = buildParallelAgentsHeaderHint([], true);
      expect(emptyHint).toBe(BACKGROUND_TREE_HINT_CONTRACT.defaultHint);
    });
  });
  
  describe("Acceptance: Cross-surface consistency", () => {
    test("footer terminate hint and tree running hint both reference ctrl+f", () => {
      // Ensures consistent messaging across UI surfaces
      expect(BACKGROUND_FOOTER_CONTRACT.terminateHintText).toContain("ctrl+f");
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toContain("ctrl+f");
    });
    
    test("tree complete hint and default hint both reference ctrl+o", () => {
      // Ensures consistent expand/toggle messaging
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenComplete).toContain("ctrl+o");
      expect(BACKGROUND_TREE_HINT_CONTRACT.defaultHint).toContain("ctrl+o");
    });
    
    test("termination flow messages use consistent terminology", () => {
      // Validate that warning and termination messages use consistent language
      const warn = getBackgroundTerminationDecision(0, 1);
      const terminate = getBackgroundTerminationDecision(1, 1);
      
      // Both should reference "background agents"
      if (warn.action === "warn") {
        expect(warn.message.toLowerCase()).toContain("background agent");
      }
      
      if (terminate.action === "terminate") {
        expect(terminate.message.toLowerCase()).toContain("background agent");
      }
    });
    
    test("footer and tree hints use matching 'terminate' keyword", () => {
      // Confirms both surfaces use "terminate" (not "kill", "stop", etc.)
      expect(BACKGROUND_FOOTER_CONTRACT.terminateHintText).toContain("terminate");
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toContain("terminate");
    });
  });
  
  describe("Acceptance: UX polish requirements", () => {
    test("hints use consistent separator style (· character)", () => {
      // Validates use of middle dot separator for visual consistency
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toContain("·");
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenComplete).toContain("·");
    });
    
    test("keybinding hints use lowercase 'ctrl+' prefix", () => {
      // Ensures consistent casing for keyboard shortcuts
      expect(BACKGROUND_FOOTER_CONTRACT.terminateHintText).toMatch(/ctrl\+f/);
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenRunning).toMatch(/ctrl\+f/);
      expect(BACKGROUND_TREE_HINT_CONTRACT.whenComplete).toMatch(/ctrl\+o/);
      expect(BACKGROUND_TREE_HINT_CONTRACT.defaultHint).toMatch(/ctrl\+o/);
    });
    
    test("footer shows pluralization correctly", () => {
      // Single agent
      const singleAgent = [
        createAgent({ id: "bg-1", background: true }),
      ];
      const singleStatus = formatBackgroundAgentFooterStatus(singleAgent);
      expect(singleStatus).toContain("1 background agent");
      expect(singleStatus).not.toContain("agents running"); // Should be singular
      
      // Multiple agents
      const multipleAgents = [
        createAgent({ id: "bg-1", background: true }),
        createAgent({ id: "bg-2", background: true }),
      ];
      const multipleStatus = formatBackgroundAgentFooterStatus(multipleAgents);
      expect(multipleStatus).toContain("2 background agents");
      expect(multipleStatus).toContain("running");
    });
    
    test("empty agent list produces empty footer status", () => {
      // Footer should not display when no agents are active
      const emptyStatus = formatBackgroundAgentFooterStatus([]);
      expect(emptyStatus).toBe("");
    });
  });
});
