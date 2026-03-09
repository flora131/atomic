import { describe, expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FsOps } from "@/services/config/copilot-config.ts";
import { loadCopilotInstructions } from "@/services/config/copilot-config.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";

describe("loadCopilotInstructions", () => {
  test("loads local instructions when available", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const localInstructionsPath = join(root, ".github", "copilot-instructions.md");
      await mkdir(join(root, ".github"), { recursive: true });
      await writeFile(localInstructionsPath, "Local project instructions", "utf-8");

      const mockFsOps = {
        readdir: async () => [],
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          return fs.readFile(file.replace(homedir(), root), encoding as BufferEncoding);
        },
      } as unknown as FsOps;

      const instructions = await loadCopilotInstructions(root, mockFsOps);
      expect(instructions).toBe("Local project instructions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("falls back to ~/.copilot instructions when local instructions are missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const globalInstructionsPath = join(root, ".copilot", "copilot-instructions.md");
      await mkdir(join(root, ".copilot"), { recursive: true });
      await writeFile(globalInstructionsPath, "Global user instructions", "utf-8");

      const mockFsOps = {
        readdir: async () => [],
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          return fs.readFile(file.replace(homedir(), root), encoding as BufferEncoding);
        },
      } as unknown as FsOps;

      const instructions = await loadCopilotInstructions(root, mockFsOps);
      expect(instructions).toBe("Global user instructions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("falls back to XDG Copilot instructions when discovery plan resolves to XDG", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const projectRoot = join(root, "workspace");
      const xdgConfigHome = join(root, ".config");
      const xdgInstructionsPath = join(xdgConfigHome, ".copilot", "copilot-instructions.md");
      await mkdir(join(xdgConfigHome, ".copilot"), { recursive: true });
      await writeFile(xdgInstructionsPath, "XDG user instructions", "utf-8");

      const plan = buildProviderDiscoveryPlan("copilot", { projectRoot, homeDir: root, xdgConfigHome, platform: "linux" });
      const instructions = await loadCopilotInstructions(projectRoot, undefined, { providerDiscoveryPlan: plan });
      expect(instructions).toBe("XDG user instructions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("prefers XDG Copilot instructions over ~/.copilot when both exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const projectRoot = join(root, "workspace");
      const xdgConfigHome = join(root, ".config");
      await mkdir(join(root, ".copilot"), { recursive: true });
      await writeFile(join(root, ".copilot", "copilot-instructions.md"), "Home instructions", "utf-8");
      await mkdir(join(xdgConfigHome, ".copilot"), { recursive: true });
      await writeFile(join(xdgConfigHome, ".copilot", "copilot-instructions.md"), "XDG instructions", "utf-8");

      const plan = buildProviderDiscoveryPlan("copilot", { projectRoot, homeDir: root, xdgConfigHome, platform: "linux" });
      const instructions = await loadCopilotInstructions(projectRoot, undefined, { providerDiscoveryPlan: plan });
      expect(instructions).toBe("XDG instructions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("local instructions override global instructions", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      await mkdir(join(root, ".github"), { recursive: true });
      await writeFile(join(root, ".github", "copilot-instructions.md"), "Local instructions", "utf-8");
      await mkdir(join(root, ".copilot"), { recursive: true });
      await writeFile(join(root, ".copilot", "copilot-instructions.md"), "Global instructions", "utf-8");

      const mockFsOps = {
        readdir: async () => [],
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          return fs.readFile(file.replace(homedir(), root), encoding as BufferEncoding);
        },
      } as unknown as FsOps;

      const instructions = await loadCopilotInstructions(root, mockFsOps);
      expect(instructions).toBe("Local instructions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns null when no instructions files exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const mockFsOps = {
        readdir: async () => [],
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          return fs.readFile(file.replace(homedir(), root), encoding as BufferEncoding);
        },
      } as unknown as FsOps;

      const instructions = await loadCopilotInstructions(root, mockFsOps);
      expect(instructions).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
