import { describe, expect, test } from "bun:test";
import {
  SubagentTypeRegistry,
  type SubagentEntry,
} from "@/services/workflows/graph/subagent-registry.ts";
import type { AgentInfo, AgentSource } from "@/services/agent-discovery/types.ts";

function createEntry(
  name: string,
  source: AgentSource = "project",
): SubagentEntry {
  const info: AgentInfo = {
    name,
    description: `Description for ${name}`,
    source,
    filePath: `/agents/${name}.md`,
  };
  return { name, info, source };
}

describe("SubagentTypeRegistry", () => {
  test("starts empty", () => {
    const registry = new SubagentTypeRegistry();

    expect(registry.getAll()).toEqual([]);
    expect(registry.has("anything")).toBe(false);
    expect(registry.get("anything")).toBeUndefined();
  });

  test("registers and retrieves an entry by name", () => {
    const registry = new SubagentTypeRegistry();
    const entry = createEntry("researcher");

    registry.register(entry);

    expect(registry.has("researcher")).toBe(true);
    expect(registry.get("researcher")).toBe(entry);
  });

  test("overwrites existing entry when registered with same name", () => {
    const registry = new SubagentTypeRegistry();
    const first = createEntry("worker", "project");
    const second = createEntry("worker", "user");

    registry.register(first);
    registry.register(second);

    expect(registry.get("worker")).toBe(second);
    expect(registry.getAll()).toHaveLength(1);
  });

  test("getAll returns all registered entries", () => {
    const registry = new SubagentTypeRegistry();
    const a = createEntry("agent-a");
    const b = createEntry("agent-b");
    const c = createEntry("agent-c");

    registry.register(a);
    registry.register(b);
    registry.register(c);

    const all = registry.getAll();
    expect(all).toHaveLength(3);
    expect(all).toContain(a);
    expect(all).toContain(b);
    expect(all).toContain(c);
  });

  test("has returns false for unregistered names", () => {
    const registry = new SubagentTypeRegistry();
    registry.register(createEntry("exists"));

    expect(registry.has("exists")).toBe(true);
    expect(registry.has("does-not-exist")).toBe(false);
  });

  test("clear removes all entries", () => {
    const registry = new SubagentTypeRegistry();
    registry.register(createEntry("a"));
    registry.register(createEntry("b"));

    expect(registry.getAll()).toHaveLength(2);

    registry.clear();

    expect(registry.getAll()).toEqual([]);
    expect(registry.has("a")).toBe(false);
    expect(registry.has("b")).toBe(false);
  });

  test("independent registry instances do not share state", () => {
    const registry1 = new SubagentTypeRegistry();
    const registry2 = new SubagentTypeRegistry();

    registry1.register(createEntry("agent-1"));

    expect(registry1.has("agent-1")).toBe(true);
    expect(registry2.has("agent-1")).toBe(false);
  });

  test("getAll returns a snapshot (not a live view)", () => {
    const registry = new SubagentTypeRegistry();
    registry.register(createEntry("initial"));

    const snapshot = registry.getAll();
    registry.register(createEntry("added-later"));

    expect(snapshot).toHaveLength(1);
    expect(registry.getAll()).toHaveLength(2);
  });

  test("preserves agent info on registered entries", () => {
    const registry = new SubagentTypeRegistry();
    const entry = createEntry("detailed-agent", "user");

    registry.register(entry);

    const retrieved = registry.get("detailed-agent");
    expect(retrieved?.info.name).toBe("detailed-agent");
    expect(retrieved?.info.source).toBe("user");
    expect(retrieved?.info.description).toBe("Description for detailed-agent");
    expect(retrieved?.info.filePath).toBe("/agents/detailed-agent.md");
    expect(retrieved?.source).toBe("user");
  });

  test("register then clear then register again works", () => {
    const registry = new SubagentTypeRegistry();
    registry.register(createEntry("first"));
    registry.clear();
    registry.register(createEntry("second"));

    expect(registry.has("first")).toBe(false);
    expect(registry.has("second")).toBe(true);
    expect(registry.getAll()).toHaveLength(1);
  });
});

describe("populateSubagentRegistry logic", () => {
  test("populates registry from discovered agents", () => {
    const registry = new SubagentTypeRegistry();

    const discovered: AgentInfo[] = [
      {
        name: "agent-alpha",
        description: "Alpha agent",
        source: "project",
        filePath: "/agents/alpha.ts",
      },
      {
        name: "agent-beta",
        description: "Beta agent",
        source: "user",
        filePath: "/agents/beta.ts",
      },
    ];

    for (const agent of discovered) {
      registry.register({
        name: agent.name,
        info: agent,
        source: agent.source,
      });
    }

    expect(registry.getAll().length).toBe(2);
    expect(registry.get("agent-alpha")?.info.description).toBe("Alpha agent");
    expect(registry.get("agent-beta")?.info.description).toBe("Beta agent");
  });

  test("project-local agents overwrite user-global on name conflict", () => {
    const registry = new SubagentTypeRegistry();

    const userAgent: AgentInfo = {
      name: "shared-agent",
      description: "User global version",
      source: "user",
      filePath: "/home/user/.agents/shared.ts",
    };

    const projectAgent: AgentInfo = {
      name: "shared-agent",
      description: "Project local version",
      source: "project",
      filePath: "/project/.agents/shared.ts",
    };

    registry.register({ name: userAgent.name, info: userAgent, source: userAgent.source });
    registry.register({ name: projectAgent.name, info: projectAgent, source: projectAgent.source });

    const result = registry.get("shared-agent")!;
    expect(result.info.description).toBe("Project local version");
    expect(result.source).toBe("project");
    expect(registry.getAll()).toHaveLength(1);
  });

  test("empty discovery results in empty registry", () => {
    const registry = new SubagentTypeRegistry();
    const discovered: AgentInfo[] = [];

    for (const agent of discovered) {
      registry.register({ name: agent.name, info: agent, source: agent.source });
    }

    expect(registry.getAll().length).toBe(0);
  });
});
