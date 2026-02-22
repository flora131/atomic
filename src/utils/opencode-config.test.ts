import { describe, expect, test } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "fs/promises";
import { prepareOpenCodeConfigDir } from "./opencode-config.ts";

describe("prepareOpenCodeConfigDir", () => {
  test("returns null when ~/.atomic/.opencode is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-opencode-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const mergedDir = join(root, "merged");

    await mkdir(homeDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    try {
      const result = await prepareOpenCodeConfigDir({
        homeDir,
        projectRoot,
        mergedDir,
      });
      expect(result).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads ~/.atomic/.opencode and applies overlays in precedence order", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-opencode-config-"));
    const homeDir = join(root, "home");
    const projectRoot = join(root, "project");
    const mergedDir = join(root, "merged");

    const atomicAgent = join(homeDir, ".atomic", ".opencode", "agents", "example.md");
    const globalAgent = join(homeDir, ".config", "opencode", "agents", "example.md");
    const userAgent = join(homeDir, ".opencode", "agents", "example.md");
    const projectAgent = join(projectRoot, ".opencode", "agents", "example.md");
    const atomicOnlyAgent = join(homeDir, ".atomic", ".opencode", "agents", "atomic-only.md");

    await mkdir(join(homeDir, ".atomic", ".opencode", "agents"), { recursive: true });
    await mkdir(join(homeDir, ".config", "opencode", "agents"), { recursive: true });
    await mkdir(join(homeDir, ".opencode", "agents"), { recursive: true });
    await mkdir(join(projectRoot, ".opencode", "agents"), { recursive: true });

    await writeFile(atomicAgent, "atomic", "utf-8");
    await writeFile(globalAgent, "global", "utf-8");
    await writeFile(userAgent, "user", "utf-8");
    await writeFile(projectAgent, "project", "utf-8");
    await writeFile(atomicOnlyAgent, "atomic-only", "utf-8");

    try {
      const result = await prepareOpenCodeConfigDir({
        homeDir,
        projectRoot,
        mergedDir,
      });
      expect(result).toBe(mergedDir);

      const mergedExample = await readFile(join(mergedDir, "agents", "example.md"), "utf-8");
      const mergedAtomicOnly = await readFile(join(mergedDir, "agents", "atomic-only.md"), "utf-8");

      expect(mergedExample).toBe("project");
      expect(mergedAtomicOnly).toBe("atomic-only");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
