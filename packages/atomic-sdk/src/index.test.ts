/**
 * Tests for the registry-iteration helpers exported from the SDK barrel.
 *
 * `listWorkflows` and `getWorkflow` are thin wrappers around the
 * registry's `list` / `resolve` methods, but they're the public surface
 * that downstream CLIs use to enumerate registered workflows — worth
 * pinning to a regression test so changes to the wrapper signature
 * surface here first.
 */

import { describe, expect, test } from "bun:test";
import {
  createRegistry,
  defineWorkflow,
  getWorkflow,
  listWorkflows,
} from "./index.ts";

function makeWorkflow(name: string, agent: "claude" | "copilot" | "opencode") {
  return defineWorkflow({ name, source: import.meta.path })
    .for(agent)
    .run(async () => {})
    .compile();
}

describe("listWorkflows", () => {
  test("returns an empty array for an empty registry", () => {
    const registry = createRegistry();
    expect(listWorkflows(registry)).toEqual([]);
  });

  test("returns every registered workflow regardless of agent", () => {
    const registry = createRegistry()
      .register(makeWorkflow("a", "claude"))
      .register(makeWorkflow("b", "copilot"))
      .register(makeWorkflow("c", "opencode"));

    const all = listWorkflows(registry);
    expect(all).toHaveLength(3);
    expect(all.map((w) => `${w.agent}/${w.name}`).sort()).toEqual([
      "claude/a",
      "copilot/b",
      "opencode/c",
    ]);
  });

  test("preserves the (agent, name) pair so the same name across agents stays distinct", () => {
    const registry = createRegistry()
      .register(makeWorkflow("ralph", "claude"))
      .register(makeWorkflow("ralph", "copilot"));

    const all = listWorkflows(registry);
    expect(all).toHaveLength(2);
    const keys = all.map((w) => `${w.agent}/${w.name}`).sort();
    expect(keys).toEqual(["claude/ralph", "copilot/ralph"]);
  });
});

describe("getWorkflow", () => {
  test("returns undefined when the (name, agent) pair is not registered", () => {
    const registry = createRegistry();
    expect(getWorkflow(registry, "claude", "missing")).toBeUndefined();
  });

  test("returns undefined when only the name (but not the agent) matches", () => {
    const registry = createRegistry().register(makeWorkflow("ralph", "claude"));
    // Same name, different agent — must NOT resolve.
    expect(getWorkflow(registry, "copilot", "ralph")).toBeUndefined();
  });

  test("resolves the matching (name, agent) pair", () => {
    const wf = makeWorkflow("ralph", "claude");
    const registry = createRegistry().register(wf);
    const result = getWorkflow(registry, "claude", "ralph");
    expect(result).toBeDefined();
    expect(result!.name).toBe("ralph");
    expect(result!.agent).toBe("claude");
  });

  test("does not return a workflow registered under a different agent", () => {
    const registry = createRegistry()
      .register(makeWorkflow("ralph", "claude"))
      .register(makeWorkflow("ralph", "copilot"));

    const claudeRalph = getWorkflow(registry, "claude", "ralph");
    const copilotRalph = getWorkflow(registry, "copilot", "ralph");
    expect(claudeRalph).toBeDefined();
    expect(copilotRalph).toBeDefined();
    expect(claudeRalph!.agent).toBe("claude");
    expect(copilotRalph!.agent).toBe("copilot");
  });
});
