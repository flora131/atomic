/**
 * Tests for MCP Config Discovery Module
 *
 * Verifies parsers for Claude, Copilot, and OpenCode config formats,
 * and the unified discoverMcpConfigs() discovery function.
 *
 * Reference: specs/mcp-support-and-discovery.md section 8.2
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseClaudeMcpConfig,
  parseCopilotMcpConfig,
  parseOpenCodeMcpConfig,
  discoverMcpConfigs,
} from "../../src/utils/mcp-config.ts";

// ============================================================================
// TEST HELPERS
// ============================================================================

let testDir: string;

function setupTestDir(): string {
  const dir = join(tmpdir(), `mcp-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonFile(filePath: string, content: unknown): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, JSON.stringify(content, null, 2));
}

function writeRawFile(filePath: string, content: string): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content);
}

// ============================================================================
// parseClaudeMcpConfig TESTS
// ============================================================================

describe("parseClaudeMcpConfig", () => {
  beforeEach(() => {
    testDir = setupTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("parses valid .mcp.json with stdio server", () => {
    const filePath = join(testDir, ".mcp.json");
    writeJsonFile(filePath, {
      mcpServers: {
        myserver: {
          command: "node",
          args: ["server.js"],
          env: { API_KEY: "test" },
        },
      },
    });

    const result = parseClaudeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.name).toBe("myserver");
    expect(server.command).toBe("node");
    expect(server.args).toEqual(["server.js"]);
    expect(server.env).toEqual({ API_KEY: "test" });
    expect(server.enabled).toBe(true);
  });

  test("parses valid .mcp.json with http server", () => {
    const filePath = join(testDir, ".mcp.json");
    writeJsonFile(filePath, {
      mcpServers: {
        remote: {
          type: "http",
          url: "https://example.com/mcp",
        },
      },
    });

    const result = parseClaudeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.name).toBe("remote");
    expect(server.type).toBe("http");
    expect(server.url).toBe("https://example.com/mcp");
  });

  test("parses valid .mcp.json with sse server", () => {
    const filePath = join(testDir, ".mcp.json");
    writeJsonFile(filePath, {
      mcpServers: {
        sse_server: {
          type: "sse",
          url: "https://example.com/sse",
        },
      },
    });

    const result = parseClaudeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.type).toBe("sse");
    expect(server.url).toBe("https://example.com/sse");
  });

  test("preserves headers field", () => {
    const filePath = join(testDir, ".mcp.json");
    writeJsonFile(filePath, {
      mcpServers: {
        authenticated: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer token123" },
        },
      },
    });

    const result = parseClaudeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.headers).toEqual({ Authorization: "Bearer token123" });
  });

  test("returns empty array for missing file", () => {
    const result = parseClaudeMcpConfig(join(testDir, "nonexistent.json"));
    expect(result).toEqual([]);
  });

  test("returns empty array for malformed JSON", () => {
    const filePath = join(testDir, ".mcp.json");
    writeRawFile(filePath, "{ invalid json }");

    const result = parseClaudeMcpConfig(filePath);
    expect(result).toEqual([]);
  });

  test("returns empty array when mcpServers key is missing", () => {
    const filePath = join(testDir, ".mcp.json");
    writeJsonFile(filePath, { other: "data" });

    const result = parseClaudeMcpConfig(filePath);
    expect(result).toEqual([]);
  });

  test("parses multiple servers", () => {
    const filePath = join(testDir, ".mcp.json");
    writeJsonFile(filePath, {
      mcpServers: {
        server1: { command: "cmd1" },
        server2: { type: "http", url: "https://example.com" },
      },
    });

    const result = parseClaudeMcpConfig(filePath);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("server1");
    expect(result[1]!.name).toBe("server2");
  });
});

// ============================================================================
// parseCopilotMcpConfig TESTS
// ============================================================================

describe("parseCopilotMcpConfig", () => {
  beforeEach(() => {
    testDir = setupTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("parses valid mcp-config.json with local type mapped to stdio", () => {
    const filePath = join(testDir, "mcp-config.json");
    writeJsonFile(filePath, {
      mcpServers: {
        localserver: {
          type: "local",
          command: "python",
          args: ["-m", "server"],
        },
      },
    });

    const result = parseCopilotMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.name).toBe("localserver");
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("python");
    expect(server.args).toEqual(["-m", "server"]);
  });

  test("preserves cwd and timeout fields", () => {
    const filePath = join(testDir, "mcp-config.json");
    writeJsonFile(filePath, {
      mcpServers: {
        server: {
          type: "local",
          command: "node",
          cwd: "/workspace",
          timeout: 30000,
        },
      },
    });

    const result = parseCopilotMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.cwd).toBe("/workspace");
    expect(server.timeout).toBe(30000);
  });

  test("preserves headers for http server", () => {
    const filePath = join(testDir, "mcp-config.json");
    writeJsonFile(filePath, {
      mcpServers: {
        remote: {
          type: "http",
          url: "https://example.com",
          headers: { "X-Token": "abc" },
        },
      },
    });

    const result = parseCopilotMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.headers).toEqual({ "X-Token": "abc" });
  });

  test("returns empty array for missing file", () => {
    const result = parseCopilotMcpConfig(join(testDir, "nonexistent.json"));
    expect(result).toEqual([]);
  });

  test("returns empty array when mcpServers key is missing", () => {
    const filePath = join(testDir, "mcp-config.json");
    writeJsonFile(filePath, { settings: {} });

    const result = parseCopilotMcpConfig(filePath);
    expect(result).toEqual([]);
  });
});

// ============================================================================
// parseOpenCodeMcpConfig TESTS
// ============================================================================

describe("parseOpenCodeMcpConfig", () => {
  beforeEach(() => {
    testDir = setupTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("parses valid opencode.json with local mapped to stdio", () => {
    const filePath = join(testDir, "opencode.json");
    writeJsonFile(filePath, {
      mcp: {
        mylocal: {
          type: "local",
          command: ["node", "server.js", "--port", "3000"],
        },
      },
    });

    const result = parseOpenCodeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.name).toBe("mylocal");
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("node");
    expect(server.args).toEqual(["server.js", "--port", "3000"]);
  });

  test("maps remote type to http", () => {
    const filePath = join(testDir, "opencode.json");
    writeJsonFile(filePath, {
      mcp: {
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
        },
      },
    });

    const result = parseOpenCodeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.type).toBe("http");
    expect(server.url).toBe("https://example.com/mcp");
  });

  test("splits command string on whitespace", () => {
    const filePath = join(testDir, "opencode.json");
    writeJsonFile(filePath, {
      mcp: {
        server: {
          type: "local",
          command: "node server.js --port 3000",
        },
      },
    });

    const result = parseOpenCodeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.command).toBe("node");
    expect(server.args).toEqual(["server.js", "--port", "3000"]);
  });

  test("maps environment to env", () => {
    const filePath = join(testDir, "opencode.json");
    writeJsonFile(filePath, {
      mcp: {
        server: {
          type: "local",
          command: ["node"],
          environment: { API_KEY: "test123" },
        },
      },
    });

    const result = parseOpenCodeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.env).toEqual({ API_KEY: "test123" });
  });

  test("respects enabled: false", () => {
    const filePath = join(testDir, "opencode.json");
    writeJsonFile(filePath, {
      mcp: {
        disabled_server: {
          type: "local",
          command: ["node"],
          enabled: false,
        },
      },
    });

    const result = parseOpenCodeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.enabled).toBe(false);
  });

  test("defaults enabled to true when not specified", () => {
    const filePath = join(testDir, "opencode.json");
    writeJsonFile(filePath, {
      mcp: {
        server: {
          type: "local",
          command: ["node"],
        },
      },
    });

    const result = parseOpenCodeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.enabled).toBe(true);
  });

  test("returns empty array for missing file", () => {
    const result = parseOpenCodeMcpConfig(join(testDir, "nonexistent.json"));
    expect(result).toEqual([]);
  });

  test("returns empty array when mcp key is missing", () => {
    const filePath = join(testDir, "opencode.json");
    writeJsonFile(filePath, { theme: "dark" });

    const result = parseOpenCodeMcpConfig(filePath);
    expect(result).toEqual([]);
  });

  test("parses JSONC with comments and trailing commas", () => {
    const filePath = join(testDir, "opencode.jsonc");
    writeRawFile(filePath, `{
  // This is a comment
  "mcp": {
    "server": {
      "type": "local",
      "command": ["node", "server.js"],
      /* block comment */
    },
  }
}`);

    const result = parseOpenCodeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.name).toBe("server");
    expect(server.command).toBe("node");
    expect(server.args).toEqual(["server.js"]);
  });

  test("preserves timeout field", () => {
    const filePath = join(testDir, "opencode.json");
    writeJsonFile(filePath, {
      mcp: {
        server: {
          type: "local",
          command: ["node"],
          timeout: 5000,
        },
      },
    });

    const result = parseOpenCodeMcpConfig(filePath);
    expect(result).toHaveLength(1);
    const server = result[0]!;
    expect(server.timeout).toBe(5000);
  });
});

// ============================================================================
// discoverMcpConfigs TESTS
// ============================================================================

describe("discoverMcpConfigs", () => {
  beforeEach(() => {
    testDir = setupTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("returns array when no config files exist", () => {
    const result = discoverMcpConfigs(testDir);
    expect(Array.isArray(result)).toBe(true);
  });

  test("discovers project-level .mcp.json", () => {
    writeJsonFile(join(testDir, ".mcp.json"), {
      mcpServers: {
        claude_server: {
          command: "node",
          args: ["server.js"],
        },
      },
    });

    const result = discoverMcpConfigs(testDir);
    const server = result.find(s => s.name === "claude_server");
    expect(server).toBeDefined();
    expect(server!.command).toBe("node");
  });

  test("discovers project-level .copilot/mcp-config.json", () => {
    writeJsonFile(join(testDir, ".copilot", "mcp-config.json"), {
      mcpServers: {
        copilot_server: {
          type: "local",
          command: "python",
        },
      },
    });

    const result = discoverMcpConfigs(testDir);
    const server = result.find(s => s.name === "copilot_server");
    expect(server).toBeDefined();
    expect(server!.type).toBe("stdio");
  });

  test("discovers project-level .github/mcp-config.json", () => {
    writeJsonFile(join(testDir, ".github", "mcp-config.json"), {
      mcpServers: {
        github_server: {
          type: "http",
          url: "https://example.com",
        },
      },
    });

    const result = discoverMcpConfigs(testDir);
    const server = result.find(s => s.name === "github_server");
    expect(server).toBeDefined();
    expect(server!.url).toBe("https://example.com");
  });

  test("discovers project-level opencode.json", () => {
    writeJsonFile(join(testDir, "opencode.json"), {
      mcp: {
        opencode_server: {
          type: "local",
          command: ["bun", "run", "mcp"],
        },
      },
    });

    const result = discoverMcpConfigs(testDir);
    const server = result.find(s => s.name === "opencode_server");
    expect(server).toBeDefined();
    expect(server!.command).toBe("bun");
    expect(server!.args).toEqual(["run", "mcp"]);
  });

  test("discovers project-level opencode.jsonc", () => {
    writeRawFile(join(testDir, "opencode.jsonc"), `{
  // JSONC config
  "mcp": {
    "jsonc_server": {
      "type": "local",
      "command": ["node"],
    }
  }
}`);

    const result = discoverMcpConfigs(testDir);
    const server = result.find(s => s.name === "jsonc_server");
    expect(server).toBeDefined();
  });

  test("discovers project-level .opencode/opencode.json", () => {
    writeJsonFile(join(testDir, ".opencode", "opencode.json"), {
      mcp: {
        opencode_nested: {
          type: "local",
          command: ["node"],
        },
      },
    });

    const result = discoverMcpConfigs(testDir);
    const server = result.find(s => s.name === "opencode_nested");
    expect(server).toBeDefined();
  });

  test("deduplicates by name (later sources override earlier)", () => {
    writeJsonFile(join(testDir, ".mcp.json"), {
      mcpServers: {
        shared_server: {
          command: "old_command",
        },
      },
    });
    writeJsonFile(join(testDir, "opencode.json"), {
      mcp: {
        shared_server: {
          type: "local",
          command: ["new_command"],
        },
      },
    });

    const result = discoverMcpConfigs(testDir);
    const servers = result.filter(s => s.name === "shared_server");
    expect(servers).toHaveLength(1);
    expect(servers[0]!.command).toBe("new_command");
  });

  test("filters out disabled servers", () => {
    writeJsonFile(join(testDir, "opencode.json"), {
      mcp: {
        enabled_server: {
          type: "local",
          command: ["node"],
          enabled: true,
        },
        disabled_server: {
          type: "local",
          command: ["node"],
          enabled: false,
        },
      },
    });

    const result = discoverMcpConfigs(testDir);
    const enabled = result.find(s => s.name === "enabled_server");
    const disabled = result.find(s => s.name === "disabled_server");
    expect(enabled).toBeDefined();
    expect(disabled).toBeUndefined();
  });

  test("merges from multiple sources", () => {
    writeJsonFile(join(testDir, ".mcp.json"), {
      mcpServers: {
        claude_only: { command: "claude_cmd" },
      },
    });
    writeJsonFile(join(testDir, ".copilot", "mcp-config.json"), {
      mcpServers: {
        copilot_only: { type: "local", command: "copilot_cmd" },
      },
    });
    writeJsonFile(join(testDir, "opencode.json"), {
      mcp: {
        opencode_only: { type: "local", command: ["opencode_cmd"] },
      },
    });

    const result = discoverMcpConfigs(testDir);
    expect(result.find(s => s.name === "claude_only")).toBeDefined();
    expect(result.find(s => s.name === "copilot_only")).toBeDefined();
    expect(result.find(s => s.name === "opencode_only")).toBeDefined();
  });
});
