import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  ensureAtomicGlobalAgentConfigs,
  ensureAtomicGlobalAgentConfigsForInstallType,
  hasAtomicGlobalAgentConfigs,
  syncAtomicGlobalAgentConfigs,
} from "@/services/config/atomic-global-config.ts";

async function createTemplateAgentConfigs(configRoot: string): Promise<void> {
  await mkdir(join(configRoot, ".claude", "agents"), { recursive: true });
  await mkdir(join(configRoot, ".claude", "skills", "init"), { recursive: true });
  await writeFile(
    join(configRoot, ".claude", "settings.json"),
    '{"permissions":{}}\n',
    "utf-8",
  );
  await writeFile(join(configRoot, ".claude", "agents", "debugger.md"), "# debugger\n", "utf-8");
  await writeFile(join(configRoot, ".claude", "skills", "init", "SKILL.md"), "# init\n", "utf-8");

  await mkdir(join(configRoot, ".opencode", "agents"), { recursive: true });
  await mkdir(join(configRoot, ".opencode", "skills", "init"), { recursive: true });
  await writeFile(
    join(configRoot, ".opencode", "opencode.json"),
    '{"permissions":[]}\n',
    "utf-8",
  );
  await writeFile(join(configRoot, ".opencode", "agents", "debugger.md"), "# debugger\n", "utf-8");
  await writeFile(join(configRoot, ".opencode", "skills", "init", "SKILL.md"), "# init\n", "utf-8");

  await mkdir(join(configRoot, ".github", "agents"), { recursive: true });
  await mkdir(join(configRoot, ".github", "skills", "init"), { recursive: true });
  await mkdir(join(configRoot, ".vscode"), { recursive: true });
  await writeFile(join(configRoot, ".github", "agents", "debugger.md"), "# debugger\n", "utf-8");
  await writeFile(join(configRoot, ".github", "skills", "init", "SKILL.md"), "# init\n", "utf-8");
  await writeFile(
    join(configRoot, ".vscode", "mcp.json"),
    '{"servers":{"deepwiki":{"type":"http","url":"https://mcp.deepwiki.com/mcp"}}}\n',
    "utf-8",
  );

  await writeFile(
    join(configRoot, ".mcp.json"),
    '{"mcpServers":{"deepwiki":{"type":"http","url":"https://mcp.deepwiki.com/mcp"}}}\n',
    "utf-8",
  );
}

test("syncAtomicGlobalAgentConfigs installs only global agents and skills into home roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-global-sync-"));

  try {
    const configRoot = join(root, "config");
    const atomicHome = join(root, ".atomic");

    await createTemplateAgentConfigs(configRoot);
    await syncAtomicGlobalAgentConfigs(configRoot, atomicHome);

    expect(existsSync(join(root, ".claude", "agents", "debugger.md"))).toBe(true);
    expect(existsSync(join(root, ".claude", "skills", "init", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(root, ".claude", ".mcp.json"))).toBe(false);
    expect(existsSync(join(root, ".opencode", "agents", "debugger.md"))).toBe(true);
    expect(existsSync(join(root, ".opencode", "skills", "init", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".opencode", "opencode.json"))).toBe(false);
    expect(existsSync(join(root, ".copilot", "agents", "debugger.md"))).toBe(true);
    expect(existsSync(join(root, ".copilot", "skills", "init", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".copilot", "mcp-config.json"))).toBe(false);

    expect(existsSync(join(atomicHome, ".claude"))).toBe(false);
    expect(existsSync(join(atomicHome, ".opencode"))).toBe(false);
    expect(existsSync(join(atomicHome, ".copilot"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("syncAtomicGlobalAgentConfigs preserves existing user-owned provider configs", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-global-user-owned-configs-"));

  try {
    const configRoot = join(root, "config");
    const atomicHome = join(root, ".atomic");

    await createTemplateAgentConfigs(configRoot);
    await mkdir(join(root, ".claude"), { recursive: true });
    await mkdir(join(root, ".opencode"), { recursive: true });
    await mkdir(join(root, ".copilot"), { recursive: true });
    await writeFile(
      join(root, ".claude", "settings.json"),
      '{"permissions":{"allow":["existing-claude"]}}\n',
      "utf-8",
    );
    await writeFile(
      join(root, ".claude", ".mcp.json"),
      '{"mcpServers":{"existing":{"type":"stdio","command":"claude-server"}}}\n',
      "utf-8",
    );
    await writeFile(
      join(root, ".opencode", "opencode.json"),
      '{"permission":"ask"}\n',
      "utf-8",
    );
    await writeFile(
      join(root, ".copilot", "mcp-config.json"),
      '{"mcpServers":{"existing":{"type":"local","command":"copilot-server"}}}\n',
      "utf-8",
    );

    await syncAtomicGlobalAgentConfigs(configRoot, atomicHome);

    expect(await readFile(join(root, ".claude", "settings.json"), "utf-8")).toBe(
      '{"permissions":{"allow":["existing-claude"]}}\n',
    );
    expect(await readFile(join(root, ".claude", ".mcp.json"), "utf-8")).toBe(
      '{"mcpServers":{"existing":{"type":"stdio","command":"claude-server"}}}\n',
    );
    expect(await readFile(join(root, ".opencode", "opencode.json"), "utf-8")).toBe(
      '{"permission":"ask"}\n',
    );
    expect(await readFile(join(root, ".copilot", "mcp-config.json"), "utf-8")).toBe(
      '{"mcpServers":{"existing":{"type":"local","command":"copilot-server"}}}\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hasAtomicGlobalAgentConfigs requires only managed global agents and skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-global-check-"));

  try {
    const configRoot = join(root, "config");
    const atomicHome = join(root, ".atomic");

    await mkdir(join(root, ".claude"), { recursive: true });
    await mkdir(join(root, ".opencode"), { recursive: true });
    await mkdir(join(root, ".copilot"), { recursive: true });

    expect(await hasAtomicGlobalAgentConfigs(atomicHome)).toBe(false);

    await createTemplateAgentConfigs(configRoot);
    await syncAtomicGlobalAgentConfigs(configRoot, atomicHome);
    expect(await hasAtomicGlobalAgentConfigs(atomicHome)).toBe(true);

    await rm(join(root, ".claude", "skills"), { recursive: true, force: true });
    expect(await hasAtomicGlobalAgentConfigs(atomicHome)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ensureAtomicGlobalAgentConfigs re-syncs when provider home roots are incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "atomic-global-ensure-"));

  try {
    const configRoot = join(root, "config");
    const atomicHome = join(root, ".atomic");

    await createTemplateAgentConfigs(configRoot);

    await mkdir(join(root, ".claude"), { recursive: true });
    await mkdir(join(root, ".opencode"), { recursive: true });
    await mkdir(join(root, ".copilot"), { recursive: true });

    await ensureAtomicGlobalAgentConfigs(configRoot, atomicHome);

    expect(existsSync(join(root, ".claude", "agents", "debugger.md"))).toBe(true);
    expect(existsSync(join(root, ".copilot", "skills", "init", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(root, ".opencode", "opencode.json"))).toBe(false);
    expect(existsSync(join(root, ".copilot", "mcp-config.json"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const INSTALL_TYPES = ["source", "npm", "binary"] as const;

for (const installType of INSTALL_TYPES) {
  test(`ensureAtomicGlobalAgentConfigsForInstallType syncs for ${installType} installs`, async () => {
    const root = await mkdtemp(join(tmpdir(), `atomic-global-install-${installType}-`));

    try {
      const configRoot = join(root, "config");
      const atomicHome = join(root, ".atomic");

      await createTemplateAgentConfigs(configRoot);
      await ensureAtomicGlobalAgentConfigsForInstallType(installType, configRoot, atomicHome);

      expect(existsSync(join(root, ".claude", "agents", "debugger.md"))).toBe(true);
      expect(existsSync(join(root, ".opencode", "agents", "debugger.md"))).toBe(true);
      expect(existsSync(join(root, ".copilot", "skills", "init", "SKILL.md"))).toBe(true);
      expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
      expect(existsSync(join(root, ".claude", ".mcp.json"))).toBe(false);
      expect(existsSync(join(root, ".opencode", "opencode.json"))).toBe(false);
      expect(existsSync(join(root, ".copilot", "mcp-config.json"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
