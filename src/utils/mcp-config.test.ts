import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverMcpConfigs } from "./mcp-config";

test("discoverMcpConfigs finds Copilot MCP config in .vscode/mcp.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-mcp-config-"));
  const previousHome = process.env.HOME;

  try {
    const projectRoot = join(root, "project");
    const homeDir = join(root, "home");
    await mkdir(homeDir, { recursive: true });
    process.env.HOME = homeDir;

    await mkdir(join(projectRoot, ".vscode"), { recursive: true });
    await writeFile(
      join(projectRoot, ".vscode", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          vscode_server: {
            type: "local",
            command: "bunx",
            args: ["example-mcp"],
          },
        },
      }),
      "utf-8"
    );

    const servers = discoverMcpConfigs(projectRoot);
    const server = servers.find((entry) => entry.name === "vscode_server");

    expect(server).toBeDefined();
    expect(server?.type).toBe("stdio");
    expect(server?.command).toBe("bunx");
    expect(server?.args).toEqual(["example-mcp"]);
  } finally {
    if (typeof previousHome === "string") {
      process.env.HOME = previousHome;
    } else {
      delete process.env.HOME;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("discoverMcpConfigs applies includeDisabled to .vscode/mcp.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-mcp-config-"));
  const previousHome = process.env.HOME;

  try {
    const projectRoot = join(root, "project");
    const homeDir = join(root, "home");
    await mkdir(homeDir, { recursive: true });
    process.env.HOME = homeDir;

    await mkdir(join(projectRoot, ".vscode"), { recursive: true });
    await writeFile(
      join(projectRoot, ".vscode", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          disabled_server: {
            type: "http",
            url: "https://example.com/mcp",
            enabled: false,
          },
        },
      }),
      "utf-8"
    );

    expect(discoverMcpConfigs(projectRoot)).toEqual([]);

    const allServers = discoverMcpConfigs(projectRoot, { includeDisabled: true });
    expect(allServers).toHaveLength(1);
    expect(allServers[0]?.name).toBe("disabled_server");
    expect(allServers[0]?.enabled).toBe(false);
  } finally {
    if (typeof previousHome === "string") {
      process.env.HOME = previousHome;
    } else {
      delete process.env.HOME;
    }
    await rm(root, { recursive: true, force: true });
  }
});
