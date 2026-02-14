import { describe, expect, test } from "bun:test";
import type { McpRuntimeSnapshot, McpServerConfig } from "../../sdk/types.ts";
import {
  applyMcpServerToggles,
  buildMcpSnapshotView,
  getActiveMcpServers,
} from "./mcp-output.ts";

describe("mcp-output helpers", () => {
  test("applies toggle overrides and marks session disable reason", () => {
    const servers: McpServerConfig[] = [
      { name: "deepwiki", type: "http", url: "https://mcp.deepwiki.com/mcp", enabled: true },
    ];

    const toggled = applyMcpServerToggles(servers, { deepwiki: false });
    expect(toggled[0]?.enabled).toBe(false);
    expect(toggled[0]?.disabledReason).toBe("Disabled for this session");
  });

  test("returns only enabled servers for next session config", () => {
    const servers: McpServerConfig[] = [
      { name: "deepwiki", enabled: true },
      { name: "filesystem", enabled: true },
    ];

    const active = getActiveMcpServers(servers, { filesystem: false });
    expect(active.map((server) => server.name)).toEqual(["deepwiki"]);
  });

  test("builds sorted snapshot and masks sensitive values", () => {
    const servers: McpServerConfig[] = [
      {
        name: "zeta",
        type: "stdio",
        command: "npx",
        args: ["-y", "zeta-mcp"],
        env: { API_TOKEN: "secret" },
        enabled: true,
      },
      {
        name: "alpha",
        type: "http",
        url: "https://alpha.example/mcp",
        headers: { Authorization: "Bearer secret" },
        enabled: true,
      },
    ];

    const runtimeSnapshot: McpRuntimeSnapshot = {
      servers: {
        alpha: {
          authStatus: "OAuth",
          tools: ["search"],
        },
      },
    };

    const snapshot = buildMcpSnapshotView({ servers, runtimeSnapshot });
    expect(snapshot.hasConfiguredServers).toBe(true);
    expect(snapshot.servers.map((server) => server.name)).toEqual(["alpha", "zeta"]);
    expect(snapshot.servers[0]?.transport.httpHeaders).toBe("Authorization=*****");
    expect(snapshot.servers[0]?.authStatus).toBe("OAuth");
    expect(snapshot.servers[1]?.transport.env).toBe("API_TOKEN=*****");
    expect(snapshot.servers[1]?.authStatus).toBe("Unknown");
  });

  test("normalizes Claude MCP tool names to Codex-style tool labels", () => {
    const servers: McpServerConfig[] = [
      { name: "deepwiki", enabled: true },
    ];

    const runtimeSnapshot: McpRuntimeSnapshot = {
      servers: {
        deepwiki: {
          tools: [
            "mcp__deepwiki__ask_question",
            "ask_question",
            "mcp__deepwiki__read_page",
          ],
        },
      },
    };

    const snapshot = buildMcpSnapshotView({ servers, runtimeSnapshot });
    expect(snapshot.servers[0]?.tools).toEqual(["ask_question", "read_page"]);
  });

  test("produces no-server empty snapshot", () => {
    const snapshot = buildMcpSnapshotView({ servers: [] });
    expect(snapshot.hasConfiguredServers).toBe(false);
    expect(snapshot.servers).toEqual([]);
  });

  test("wildcard tools ['*'] makes noToolsAvailable false", () => {
    const servers: McpServerConfig[] = [
      { name: "deepwiki", type: "http", url: "https://mcp.deepwiki.com/mcp", tools: ["*"], enabled: true },
    ];

    const snapshot = buildMcpSnapshotView({ servers });
    expect(snapshot.noToolsAvailable).toBe(false);
    expect(snapshot.servers[0]?.tools).toEqual(["*"]);
  });

  test("runtime tools override wildcard config tools", () => {
    const servers: McpServerConfig[] = [
      { name: "deepwiki", type: "http", url: "https://mcp.deepwiki.com/mcp", tools: ["*"], enabled: true },
    ];

    const runtimeSnapshot: McpRuntimeSnapshot = {
      servers: {
        deepwiki: {
          tools: ["mcp__deepwiki__ask_question", "mcp__deepwiki__read_wiki_structure"],
        },
      },
    };

    const snapshot = buildMcpSnapshotView({ servers, runtimeSnapshot });
    expect(snapshot.servers[0]?.tools).toEqual(["ask_question", "read_wiki_structure"]);
    expect(snapshot.noToolsAvailable).toBe(false);
  });

  test("config tools whitelist filters runtime tools", () => {
    const servers: McpServerConfig[] = [
      { name: "deepwiki", type: "http", url: "https://mcp.deepwiki.com/mcp", tools: ["ask_question"], enabled: true },
    ];

    const runtimeSnapshot: McpRuntimeSnapshot = {
      servers: {
        deepwiki: {
          tools: ["mcp__deepwiki__ask_question", "mcp__deepwiki__read_wiki_structure", "mcp__deepwiki__read_wiki_contents"],
        },
      },
    };

    const snapshot = buildMcpSnapshotView({ servers, runtimeSnapshot });
    expect(snapshot.servers[0]?.tools).toEqual(["ask_question"]);
  });
});
