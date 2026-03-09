import { describe, expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FsOps } from "@/services/config/copilot-config.ts";
import { loadCopilotAgents } from "@/services/config/copilot-config.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import {
  invalidateProviderDiscoveryCaches,
  startProviderDiscoverySessionCache,
} from "@/services/config/provider-discovery-cache.ts";

describe("loadCopilotAgents", () => {
  test("merges agents from ~/.copilot and .github with local priority", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const globalAgentsDir = join(root, ".copilot", "agents");
      await mkdir(globalAgentsDir, { recursive: true });
      await writeFile(join(globalAgentsDir, "global-agent.md"), "---\nname: Global Agent\n---\nGlobal content", "utf-8");
      await writeFile(join(globalAgentsDir, "shared-agent.md"), "---\nname: Shared Agent\ndescription: From global\n---\nGlobal version", "utf-8");

      const localAgentsDir = join(root, ".github", "agents");
      await mkdir(localAgentsDir, { recursive: true });
      await writeFile(join(localAgentsDir, "local-agent.md"), "---\nname: Local Agent\n---\nLocal content", "utf-8");
      await writeFile(join(localAgentsDir, "shared-agent.md"), "---\nname: Shared Agent\ndescription: From local\n---\nLocal version", "utf-8");

      const mockFsOps = {
        readdir: async (dir: string) => {
          const fs = await import("node:fs/promises");
          return fs.readdir(dir.replace(homedir(), root));
        },
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          return fs.readFile(file.replace(homedir(), root), encoding as BufferEncoding);
        },
      } as unknown as FsOps;

      const agents = await loadCopilotAgents(root, mockFsOps);
      expect(agents).toHaveLength(3);
      expect(agents.find((agent) => agent.name === "Global Agent")?.source).toBe("global");
      expect(agents.find((agent) => agent.name === "Local Agent")?.source).toBe("local");
      expect(agents.find((agent) => agent.name === "Shared Agent")?.description).toBe("From local");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads agents from ~/.copilot global directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const homeAgentsDir = join(root, ".copilot", "agents");
      await mkdir(homeAgentsDir, { recursive: true });
      await writeFile(join(homeAgentsDir, "home-agent.md"), "---\nname: Home Global Agent\n---\nHome global content", "utf-8");

      const mockFsOps = {
        readdir: async (dir: string) => {
          const fs = await import("node:fs/promises");
          return fs.readdir(dir.replace(homedir(), root));
        },
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          return fs.readFile(file.replace(homedir(), root), encoding as BufferEncoding);
        },
      } as unknown as FsOps;

      const agents = await loadCopilotAgents(root, mockFsOps);
      expect(agents).toHaveLength(1);
      expect(agents[0]?.name).toBe("Home Global Agent");
      expect(agents[0]?.source).toBe("global");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads agents from both ~/.copilot and XDG Copilot directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const projectRoot = join(root, "workspace");
      const homeAgentsDir = join(root, ".copilot", "agents");
      const xdgAgentsDir = join(root, ".config", ".copilot", "agents");
      await mkdir(homeAgentsDir, { recursive: true });
      await mkdir(xdgAgentsDir, { recursive: true });
      await writeFile(join(homeAgentsDir, "home-agent.md"), "---\nname: Home Agent\n---\nHome content", "utf-8");
      await writeFile(join(xdgAgentsDir, "xdg-agent.md"), "---\nname: XDG Agent\n---\nXDG content", "utf-8");
      await writeFile(join(homeAgentsDir, "shared.md"), "---\nname: Shared Agent\ndescription: From home\n---\nHome version", "utf-8");
      await writeFile(join(xdgAgentsDir, "shared.md"), "---\nname: Shared Agent\ndescription: From xdg\n---\nXDG version", "utf-8");

      const plan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
        xdgConfigHome: join(root, ".config"),
      });

      const agents = await loadCopilotAgents(projectRoot, undefined, { providerDiscoveryPlan: plan });
      expect(agents.some((agent) => agent.name === "Home Agent")).toBe(true);
      expect(agents.some((agent) => agent.name === "XDG Agent")).toBe(true);
      expect(agents.find((agent) => agent.name === "Shared Agent")?.description).toBe("From xdg");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("performs case-insensitive deduplication", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const globalDir = join(root, ".copilot", "agents");
      await mkdir(globalDir, { recursive: true });
      await writeFile(join(globalDir, "agent1.md"), "---\nname: Test Agent\n---\nLowercase version", "utf-8");
      const localDir = join(root, ".github", "agents");
      await mkdir(localDir, { recursive: true });
      await writeFile(join(localDir, "agent2.md"), "---\nname: TEST AGENT\n---\nUppercase version", "utf-8");

      const mockFsOps = {
        readdir: async (dir: string) => {
          const fs = await import("node:fs/promises");
          return fs.readdir(dir.replace(homedir(), root));
        },
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          return fs.readFile(file.replace(homedir(), root), encoding as BufferEncoding);
        },
      } as unknown as FsOps;

      const agents = await loadCopilotAgents(root, mockFsOps);
      expect(agents).toHaveLength(1);
      expect(agents[0]?.name).toBe("TEST AGENT");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns empty array when no agent directories exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const mockFsOps = {
        readdir: async (dir: string) => {
          const fs = await import("node:fs/promises");
          return fs.readdir(dir.replace(homedir(), root));
        },
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          return fs.readFile(file.replace(homedir(), root), encoding as BufferEncoding);
        },
      } as unknown as FsOps;

      const agents = await loadCopilotAgents(root, mockFsOps);
      expect(agents).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses provided discovery plan roots for custom agent loading", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const projectRoot = join(root, "workspace");
      const userRoot = join(root, ".copilot");
      await mkdir(join(projectRoot, ".github", "agents"), { recursive: true });
      await writeFile(join(projectRoot, ".github", "agents", "shared.md"), "---\nname: Shared Agent\ndescription: From local\n---\nLocal version", "utf-8");
      await mkdir(join(userRoot, "agents"), { recursive: true });
      await writeFile(join(userRoot, "agents", "shared.md"), "---\nname: Shared Agent\ndescription: From global\n---\nGlobal version", "utf-8");
      await writeFile(join(userRoot, "agents", "global-only.md"), "---\nname: Global Only\n---\nGlobal agent", "utf-8");

      const plan = buildProviderDiscoveryPlan("copilot", { projectRoot, homeDir: root });
      const agents = await loadCopilotAgents(projectRoot, undefined, { providerDiscoveryPlan: plan });
      expect(agents.find((agent) => agent.name === "Shared Agent")?.description).toBe("From local");
      expect(agents.some((agent) => agent.name === "Global Only")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses startup discovery plan cache when options omit providerDiscoveryPlan", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const projectRoot = join(root, "workspace");
      const userRoot = join(root, ".copilot");
      await mkdir(join(projectRoot, ".github", "agents"), { recursive: true });
      await writeFile(join(projectRoot, ".github", "agents", "local.md"), "---\nname: Local Agent\n---\nProject-local agent", "utf-8");
      await mkdir(join(userRoot, "agents"), { recursive: true });
      await writeFile(join(userRoot, "agents", "global.md"), "---\nname: Global Agent\n---\nGlobal agent", "utf-8");

      const startupPlan = buildProviderDiscoveryPlan("copilot", { projectRoot, homeDir: root });
      startProviderDiscoverySessionCache({ projectRoot, startupPlan });

      const agents = await loadCopilotAgents(projectRoot);
      expect(agents.some((agent) => agent.name === "Local Agent")).toBe(true);
      expect(agents.some((agent) => agent.name === "Global Agent")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("invalidateProviderDiscoveryCaches clears Copilot agent discovery cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));
    try {
      const projectRoot = join(root, "workspace");
      await mkdir(join(projectRoot, ".github", "agents"), { recursive: true });
      await writeFile(join(projectRoot, ".github", "agents", "local.md"), "---\nname: Local Agent\n---\nProject-local agent", "utf-8");

      const startupPlan = buildProviderDiscoveryPlan("copilot", { projectRoot, homeDir: root });
      startProviderDiscoverySessionCache({ projectRoot, startupPlan });

      let readdirCalls = 0;
      const countingFsOps = {
        readdir: async (dir: string) => {
          readdirCalls += 1;
          return readdir(dir);
        },
        readFile: async (file: string, encoding?: string) => readFile(file, encoding as BufferEncoding),
      } as unknown as FsOps;

      await loadCopilotAgents(projectRoot, countingFsOps, { providerDiscoveryPlan: startupPlan });
      const firstCallCount = readdirCalls;
      await loadCopilotAgents(projectRoot, countingFsOps, { providerDiscoveryPlan: startupPlan });
      expect(readdirCalls).toBe(firstCallCount);
      invalidateProviderDiscoveryCaches();
      await loadCopilotAgents(projectRoot, countingFsOps, { providerDiscoveryPlan: startupPlan });
      expect(readdirCalls).toBeGreaterThan(firstCallCount);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
