import { describe, expect, test } from "bun:test";
import { dirname, join } from "path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";

import { syncAtomicGlobalAgentConfigs } from "@/services/config/atomic-global-config.ts";
import { getConfigRoot } from "@/services/config/config-path.ts";

const PLAYWRIGHT_SKILL_RELATIVE_PATH = join("skills", "playwright-cli", "SKILL.md");
const LEGACY_WEB_TOOL_TOKENS = [
  '"web"',
  "webfetch: true",
  "websearch: true",
] as const;

const CLAUDE_DEBUGGER_PATH = join(".claude", "agents", "debugger.md");
const OPENCODE_DEBUGGER_PATH = join(".opencode", "agents", "debugger.md");
const COPILOT_TEMPLATE_DEBUGGER_PATH = join(".github", "agents", "debugger.md");
const CLAUDE_SKILL_TEMPLATE_PATH = join(".claude", PLAYWRIGHT_SKILL_RELATIVE_PATH);
const OPENCODE_SKILL_TEMPLATE_PATH = join(".opencode", PLAYWRIGHT_SKILL_RELATIVE_PATH);
const COPILOT_SKILL_TEMPLATE_PATH = join(".github", PLAYWRIGHT_SKILL_RELATIVE_PATH);

const CLAUDE_GLOBAL_DEBUGGER_PATH = join(".claude", "agents", "debugger.md");
const OPENCODE_GLOBAL_DEBUGGER_PATH = join(".opencode", "agents", "debugger.md");
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

describe("postinstall integration", () => {
  test("syncs cleaned configs and deploys playwright skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "postinstall-integration-"));

    try {
      const configRoot = getConfigRoot();
      const atomicHome = join(root, ".atomic");
      const homeRoot = root;

      await writeTextFile(
        join(homeRoot, CLAUDE_GLOBAL_DEBUGGER_PATH),
        "tools: Read, WebFetch, WebSearch\n",
      );
      await writeTextFile(
        join(homeRoot, ".opencode", "opencode.json"),
        '{"permission":{"webfetch":"allow"}}\n',
      );
      await writeTextFile(
        join(homeRoot, COPILOT_GLOBAL_DEBUGGER_PATH),
        'tools: ["execute", "read", "web"]\n',
      );

      await syncAtomicGlobalAgentConfigs(configRoot, atomicHome);

      const sourceClaudeDebugger = await readTextFile(configRoot, CLAUDE_DEBUGGER_PATH);
      const sourceOpencodeDebugger = await readTextFile(configRoot, OPENCODE_DEBUGGER_PATH);
      const sourceCopilotDebugger = await readTextFile(configRoot, COPILOT_TEMPLATE_DEBUGGER_PATH);

      const claudeDebugger = await readTextFile(homeRoot, CLAUDE_GLOBAL_DEBUGGER_PATH);
      const opencodeDebugger = await readTextFile(homeRoot, OPENCODE_GLOBAL_DEBUGGER_PATH);
      const copilotDebugger = await readTextFile(homeRoot, COPILOT_GLOBAL_DEBUGGER_PATH);
      const opencodeConfig = await readTextFile(homeRoot, join(".opencode", "opencode.json"));

      expect(claudeDebugger).toBe(sourceClaudeDebugger);
      expect(opencodeDebugger).toBe(sourceOpencodeDebugger);
      expect(copilotDebugger).toBe(sourceCopilotDebugger);
      expect(opencodeConfig).toBe('{"permission":{"webfetch":"allow"}}\n');

      for (const token of LEGACY_WEB_TOOL_TOKENS) {
        expect(claudeDebugger.includes(token)).toBe(false);
        expect(opencodeDebugger.includes(token)).toBe(false);
        expect(copilotDebugger.includes(token)).toBe(false);
      }

      // The opencode debugger config no longer uses YAML webfetch/websearch keys;
      // it uses a JSON tools array that simply omits disallowed tools.
      // Verify the legacy tokens are absent (checked above) and the new format
      // lists only allowed tools.
      expect(opencodeDebugger.includes("tools:")).toBe(true);

      const sourceClaudeSkill = await readTextFile(configRoot, CLAUDE_SKILL_TEMPLATE_PATH);
      const sourceOpencodeSkill = await readTextFile(configRoot, OPENCODE_SKILL_TEMPLATE_PATH);
      const sourceCopilotSkill = await readTextFile(configRoot, COPILOT_SKILL_TEMPLATE_PATH);

      const claudeSkill = await readTextFile(homeRoot, CLAUDE_GLOBAL_SKILL_PATH);
      const opencodeSkill = await readTextFile(homeRoot, OPENCODE_GLOBAL_SKILL_PATH);
      const copilotSkill = await readTextFile(homeRoot, COPILOT_GLOBAL_SKILL_PATH);

      expect(claudeSkill).toBe(sourceClaudeSkill);
      expect(opencodeSkill).toBe(sourceOpencodeSkill);
      expect(copilotSkill).toBe(sourceCopilotSkill);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
