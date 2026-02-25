import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { deployPlaywrightSkill } from "./postinstall-playwright";

const PLAYWRIGHT_SKILL_RELATIVE_PATH = join("skills", "playwright-cli", "SKILL.md");

async function writeSkillTemplate(
  configRoot: string,
  agentFolder: string,
  content: string
): Promise<void> {
  const skillPath = join(configRoot, agentFolder, PLAYWRIGHT_SKILL_RELATIVE_PATH);
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, content, "utf-8");
}

test("deployPlaywrightSkill copies SKILL.md to each global agent folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "postinstall-playwright-"));

  try {
    const configRoot = join(root, "config");
    const atomicHome = join(root, ".atomic");

    await writeSkillTemplate(configRoot, ".claude", "# claude skill\n");
    await writeSkillTemplate(configRoot, ".opencode", "# opencode skill\n");
    await writeSkillTemplate(configRoot, ".github", "# copilot skill\n");

    await deployPlaywrightSkill(configRoot, atomicHome);

    const claudeSkill = await readFile(
      join(atomicHome, ".claude", PLAYWRIGHT_SKILL_RELATIVE_PATH),
      "utf-8"
    );
    const opencodeSkill = await readFile(
      join(atomicHome, ".opencode", PLAYWRIGHT_SKILL_RELATIVE_PATH),
      "utf-8"
    );
    const copilotSkill = await readFile(
      join(atomicHome, ".copilot", PLAYWRIGHT_SKILL_RELATIVE_PATH),
      "utf-8"
    );

    expect(claudeSkill).toBe("# claude skill\n");
    expect(opencodeSkill).toBe("# opencode skill\n");
    expect(copilotSkill).toBe("# copilot skill\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deployPlaywrightSkill errors when templates are missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "postinstall-playwright-missing-"));

  try {
    const configRoot = join(root, "config");
    const atomicHome = join(root, ".atomic");

    await writeSkillTemplate(configRoot, ".claude", "# claude skill\n");
    await writeSkillTemplate(configRoot, ".opencode", "# opencode skill\n");

    await expect(deployPlaywrightSkill(configRoot, atomicHome)).rejects.toThrow(
      "Missing Playwright skill template"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
