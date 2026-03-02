import { describe, expect, test } from "bun:test";
import { dirname, join } from "path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";

import { syncAtomicGlobalAgentConfigs } from "../utils/atomic-global-config";
import { getConfigRoot } from "../utils/config-path";
import { deployPlaywrightSkill } from "./postinstall-playwright";

const PLAYWRIGHT_SKILL_RELATIVE_PATH = join("skills", "playwright-cli", "SKILL.md");
const LEGACY_WEB_TOOL_TOKENS = ["WebFetch", "WebSearch", "webfetch", '"web"'] as const;

const CLAUDE_DEBUGGER_PATH = join(".claude", "agents", "debugger.md");
const OPENCODE_CONFIG_PATH = join(".opencode", "opencode.json");
const COPILOT_TEMPLATE_DEBUGGER_PATH = join(".github", "agents", "debugger.md");
const CLAUDE_SKILL_TEMPLATE_PATH = join(".claude", PLAYWRIGHT_SKILL_RELATIVE_PATH);
const OPENCODE_SKILL_TEMPLATE_PATH = join(".opencode", PLAYWRIGHT_SKILL_RELATIVE_PATH);
const COPILOT_SKILL_TEMPLATE_PATH = join(".github", PLAYWRIGHT_SKILL_RELATIVE_PATH);

const CLAUDE_GLOBAL_DEBUGGER_PATH = join(".claude", "agents", "debugger.md");
const OPENCODE_GLOBAL_CONFIG_PATH = join(".opencode", "opencode.json");
const COPILOT_GLOBAL_DEBUGGER_PATH = join(".copilot", "agents", "debugger.md");
const CLAUDE_GLOBAL_SKILL_PATH = join(".claude", PLAYWRIGHT_SKILL_RELATIVE_PATH);
const OPENCODE_GLOBAL_SKILL_PATH = join(".opencode", PLAYWRIGHT_SKILL_RELATIVE_PATH);
const COPILOT_GLOBAL_SKILL_PATH = join(".copilot", PLAYWRIGHT_SKILL_RELATIVE_PATH);

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

async function readTextFile(baseDir: string, relativePath: string): Promise<string> {
  return readFile(join(baseDir, relativePath), "utf-8");
}

async function seedLegacyToolConfigs(atomicHome: string): Promise<void> {
  await writeTextFile(
    join(atomicHome, CLAUDE_GLOBAL_DEBUGGER_PATH),
    "tools: Read, WebFetch, WebSearch\n",
  );
  await writeTextFile(join(atomicHome, OPENCODE_GLOBAL_CONFIG_PATH), '{"permission":{"webfetch":"allow"}}\n');
  await writeTextFile(
    join(atomicHome, COPILOT_GLOBAL_DEBUGGER_PATH),
    'tools: ["execute", "read", "web"]\n',
  );
}

describe("postinstall integration", () => {
  test("syncs cleaned configs and re-deploys playwright skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "postinstall-integration-"));

    try {
      const configRoot = getConfigRoot();
      const atomicHome = join(root, ".atomic");

      await seedLegacyToolConfigs(atomicHome);

      await syncAtomicGlobalAgentConfigs(configRoot, atomicHome);

      const sourceClaudeDebugger = await readTextFile(configRoot, CLAUDE_DEBUGGER_PATH);
      const sourceOpencodeConfig = await readTextFile(configRoot, OPENCODE_CONFIG_PATH);
      const sourceCopilotDebugger = await readTextFile(configRoot, COPILOT_TEMPLATE_DEBUGGER_PATH);

      const claudeDebugger = await readTextFile(atomicHome, CLAUDE_GLOBAL_DEBUGGER_PATH);
      const opencodeConfig = await readTextFile(atomicHome, OPENCODE_GLOBAL_CONFIG_PATH);
      const copilotDebugger = await readTextFile(atomicHome, COPILOT_GLOBAL_DEBUGGER_PATH);

      expect(claudeDebugger).toBe(sourceClaudeDebugger);
      expect(opencodeConfig).toBe(sourceOpencodeConfig);
      expect(copilotDebugger).toBe(sourceCopilotDebugger);

      for (const token of LEGACY_WEB_TOOL_TOKENS) {
        expect(claudeDebugger.includes(token)).toBe(false);
        expect(opencodeConfig.includes(token)).toBe(false);
        expect(copilotDebugger.includes(token)).toBe(false);
      }

      await rm(join(atomicHome, CLAUDE_GLOBAL_SKILL_PATH), { force: true });
      await rm(join(atomicHome, OPENCODE_GLOBAL_SKILL_PATH), { force: true });
      await rm(join(atomicHome, COPILOT_GLOBAL_SKILL_PATH), { force: true });

      await deployPlaywrightSkill(configRoot, atomicHome);

      const sourceClaudeSkill = await readTextFile(configRoot, CLAUDE_SKILL_TEMPLATE_PATH);
      const sourceOpencodeSkill = await readTextFile(configRoot, OPENCODE_SKILL_TEMPLATE_PATH);
      const sourceCopilotSkill = await readTextFile(configRoot, COPILOT_SKILL_TEMPLATE_PATH);

      const claudeSkill = await readTextFile(atomicHome, CLAUDE_GLOBAL_SKILL_PATH);
      const opencodeSkill = await readTextFile(atomicHome, OPENCODE_GLOBAL_SKILL_PATH);
      const copilotSkill = await readTextFile(atomicHome, COPILOT_GLOBAL_SKILL_PATH);

      expect(claudeSkill).toBe(sourceClaudeSkill);
      expect(opencodeSkill).toBe(sourceOpencodeSkill);
      expect(copilotSkill).toBe(sourceCopilotSkill);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
