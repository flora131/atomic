/**
 * Tests for the agent-discovery service barrel (index.ts).
 *
 * Verifies that the public API surface re-exports the correct symbols.
 * discoverAgentInfos is validated as a callable function — its detailed
 * behavior is covered by the existing tests in commands/catalog/agents/.
 */
import { describe, expect, test } from "bun:test";
import * as agentDiscovery from "@/services/agent-discovery/index.ts";

describe("agent-discovery public API", () => {
  test("exports discoverAgentInfos as a function", () => {
    expect(typeof agentDiscovery.discoverAgentInfos).toBe("function");
  });

  test("exports getDiscoveredAgent as a function", () => {
    expect(typeof agentDiscovery.getDiscoveredAgent).toBe("function");
  });

  test("exports registerActiveSession as a function", () => {
    expect(typeof agentDiscovery.registerActiveSession).toBe("function");
  });

  test("exports getActiveSession as a function", () => {
    expect(typeof agentDiscovery.getActiveSession).toBe("function");
  });

  test("exports completeSession as a function", () => {
    expect(typeof agentDiscovery.completeSession).toBe("function");
  });

  test("exports clearActiveSessions as a function", () => {
    expect(typeof agentDiscovery.clearActiveSessions).toBe("function");
  });

  test("exports getActiveSessions as a function", () => {
    expect(typeof agentDiscovery.getActiveSessions).toBe("function");
  });

  test("discoverAgentInfos returns an array", () => {
    const result = agentDiscovery.discoverAgentInfos();
    expect(Array.isArray(result)).toBe(true);
  });
});
