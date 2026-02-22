import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  ensureAtomicGlobalAgentConfigs,
  hasAtomicGlobalAgentConfigs,
  syncAtomicGlobalAgentConfigs,
} from "./atomic-global-config";

async function createTemplateAgentConfigs(configRoot: string): Promise<void> {
  await mkdir(join(configRoot, ".claude", "agents"), { recursive: true });
  await mkdir(join(configRoot, ".claude", "skills", "init"), { recursive: true });
  await writeFile(
    join(configRoot, ".claude", "settings.json"),
    '{"permissions":{}}\n',
    "utf-8"
  );
  await writeFile(join(configRoot, ".claude", "agents", "debugger.md"), "# debugger\n", "utf-8");
  await writeFile(join(configRoot, ".claude", "skills", "init", "SKILL.md"), "# init\n", "utf-8");

  await mkdir(join(configRoot, ".opencode", "agents"), { recursive: true });
  await mkdir(join(configRoot, ".opencode", "skills", "init"), { recursive: true });
  await writeFile(
    join(configRoot, ".opencode", "opencode.json"),
    '{"permissions":[]}\n',
    "utf-8"
  );
  await writeFile(join(configRoot, ".opencode", "agents", "debugger.md"), "# debugger\n", "utf-8");
  await writeFile(join(configRoot, ".opencode", "skills", "init", "SKILL.md"), "# init\n", "utf-8");

  await mkdir(join(configRoot, ".github", "agents"), { recursive: true });
  await mkdir(join(configRoot, ".github", "skills", "init"), { recursive: true });
  await writeFile(join(configRoot, ".github", "agents", "debugger.md"), "# debugger\n", "utf-8");
  await writeFile(join(configRoot, ".github", "skills", "init", "SKILL.md"), "# init\n", "utf-8");
  await writeFile(
    join(configRoot, ".github", "mcp-config.json"),
    '{"mcpServers":{"deepwiki":{"type":"http","url":"https://mcp.deepwiki.com/mcp"}}}\n',
    "utf-8"
  );

  await writeFile(
    join(configRoot, ".mcp.json"),
    '{"mcpServers":{"deepwiki":{"type":"http","url":"https://mcp.deepwiki.com/mcp"}}}\n',
    "utf-8"
  );
}

test("syncAtomicGlobalAgentConfigs installs all agents under ~/.atomic", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-global-sync-"));

  try {
    const configRoot = join(root, "config");
    const atomicHome = join(root, ".atomic");

    await createTemplateAgentConfigs(configRoot);
    await syncAtomicGlobalAgentConfigs(configRoot, atomicHome);

    expect(existsSync(join(atomicHome, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(atomicHome, ".opencode", "opencode.json"))).toBe(true);
    expect(existsSync(join(atomicHome, ".copilot", "agents", "debugger.md"))).toBe(true);
    expect(existsSync(join(atomicHome, ".mcp.json"))).toBe(true);
    expect(existsSync(join(atomicHome, ".copilot", "mcp-config.json"))).toBe(true);

    expect(existsSync(join(root, ".claude"))).toBe(false);
    expect(existsSync(join(root, ".opencode"))).toBe(false);
    expect(existsSync(join(root, ".copilot"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hasAtomicGlobalAgentConfigs requires complete global config contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-global-check-"));

  try {
    const configRoot = join(root, "config");
    const atomicHome = join(root, ".atomic");

    await mkdir(join(atomicHome, ".claude"), { recursive: true });
    await mkdir(join(atomicHome, ".opencode"), { recursive: true });
    await mkdir(join(atomicHome, ".copilot"), { recursive: true });

    expect(await hasAtomicGlobalAgentConfigs(atomicHome)).toBe(false);

    await createTemplateAgentConfigs(configRoot);
    await syncAtomicGlobalAgentConfigs(configRoot, atomicHome);
    expect(await hasAtomicGlobalAgentConfigs(atomicHome)).toBe(true);

    await rm(join(atomicHome, ".mcp.json"), { force: true });
    expect(await hasAtomicGlobalAgentConfigs(atomicHome)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ensureAtomicGlobalAgentConfigs re-syncs when config folders are incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-global-ensure-"));

  try {
    const configRoot = join(root, "config");
    const atomicHome = join(root, ".atomic");

    await createTemplateAgentConfigs(configRoot);

    await mkdir(join(atomicHome, ".claude"), { recursive: true });
    await mkdir(join(atomicHome, ".opencode"), { recursive: true });
    await mkdir(join(atomicHome, ".copilot"), { recursive: true });

    await ensureAtomicGlobalAgentConfigs(configRoot, atomicHome);

    expect(existsSync(join(atomicHome, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(atomicHome, ".opencode", "opencode.json"))).toBe(true);
    expect(existsSync(join(atomicHome, ".copilot", "skills", "init", "SKILL.md"))).toBe(true);
    expect(existsSync(join(atomicHome, ".mcp.json"))).toBe(true);
    expect(existsSync(join(atomicHome, ".copilot", "mcp-config.json"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
