import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";

import {
  discoverMcpConfigs,
  parseCopilotMcpConfig,
} from "@/services/config/mcp-config.ts";

async function writeCopilotMcpConfig(
  filePath: string,
  serverName: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify(
      {
        servers: {
          [serverName]: {
            type: "local",
            command: "echo",
          },
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function withTempHome(homeDir: string): () => void {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  return () => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
  };
}

describe("discoverMcpConfigs path guardrails", () => {
  test("loads valid in-root project config", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-mcp-path-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");

    await mkdir(homeDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    const restoreHome = withTempHome(homeDir);

    try {
      await writeCopilotMcpConfig(
        join(projectRoot, ".vscode", "mcp.json"),
        "project-server",
      );

      const configs = await discoverMcpConfigs(projectRoot);
      expect(configs.some((config) => config.name === "project-server")).toBe(true);
    } finally {
      restoreHome();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks traversal paths that escape the allowed project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-mcp-path-"));
    const projectRoot = join(root, "project");
    const outsideRoot = join(root, "outside");

    await mkdir(projectRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });

    try {
      await writeCopilotMcpConfig(
        join(outsideRoot, "mcp-config.json"),
        "outside-server",
      );

      const configs = await parseCopilotMcpConfig(
        join(projectRoot, "..", "outside", "mcp-config.json"),
        projectRoot,
      );

      expect(configs).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks symlink escapes that resolve outside the project root", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "atomic-mcp-path-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const outsideRoot = join(root, "outside");

    await mkdir(homeDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });

    const restoreHome = withTempHome(homeDir);

    try {
      const outsideConfig = join(outsideRoot, "mcp-config.json");
      await writeCopilotMcpConfig(outsideConfig, "outside-server");

      await mkdir(join(projectRoot, ".vscode"), { recursive: true });
      await symlink(outsideConfig, join(projectRoot, ".vscode", "mcp.json"));

      const configs = await discoverMcpConfigs(projectRoot);
      expect(configs.some((config) => config.name === "outside-server")).toBe(false);
    } finally {
      restoreHome();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("allows symlinked config files that resolve inside the project root", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "atomic-mcp-path-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");

    await mkdir(homeDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    const restoreHome = withTempHome(homeDir);

    try {
      const sharedConfig = join(projectRoot, "shared", "copilot-mcp.json");
      await writeCopilotMcpConfig(sharedConfig, "inside-server");

      await mkdir(join(projectRoot, ".vscode"), { recursive: true });
      await symlink(sharedConfig, join(projectRoot, ".vscode", "mcp.json"));

      const configs = await discoverMcpConfigs(projectRoot);
      expect(configs.some((config) => config.name === "inside-server")).toBe(true);
    } finally {
      restoreHome();
      await rm(root, { recursive: true, force: true });
    }
  });
});
