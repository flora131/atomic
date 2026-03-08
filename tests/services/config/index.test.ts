import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  type FsOps,
  loadAgentsFromDir,
  loadCopilotAgents,
  loadCopilotInstructions,
  resolveCopilotSkillDirectories,
} from "@/services/config/copilot-config.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";
import {
  clearProviderDiscoverySessionCache,
  invalidateProviderDiscoveryCaches,
  startProviderDiscoverySessionCache,
} from "@/services/config/provider-discovery-cache.ts";

beforeEach(() => {
  clearProviderDiscoverySessionCache();
});

describe("loadAgentsFromDir", () => {
  test("loads agent with frontmatter", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "test-agent.md"),
        `---
name: Test Agent
description: A test agent
tools:
  - bash
  - edit
---
You are a test agent.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");

      expect(agents.length).toBe(1);
      expect(agents[0]).toMatchObject({
        name: "Test Agent",
        description: "A test agent",
        tools: ["bash", "edit"],
        systemPrompt: "You are a test agent.",
        source: "local",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads agent without frontmatter using filename as name", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "simple-agent.md"),
        "You are a simple agent without frontmatter.",
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "global");

      expect(agents.length).toBe(1);
      expect(agents[0]).toMatchObject({
        name: "simple-agent",
        description: "Agent: simple-agent",
        systemPrompt: "You are a simple agent without frontmatter.",
        source: "global",
      });
      expect(agents[0]?.tools).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses filename as fallback when frontmatter lacks name", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "fallback-name.md"),
        `---
description: Agent with no name field
---
Agent content here.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");

      expect(agents.length).toBe(1);
      expect(agents[0]?.name).toBe("fallback-name");
      expect(agents[0]?.description).toBe("Agent with no name field");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("generates default description when frontmatter lacks description", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "no-desc.md"),
        `---
name: NoDesc Agent
---
Agent without description.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");

      expect(agents.length).toBe(1);
      expect(agents[0]?.description).toBe("Agent: NoDesc Agent");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("filters out non-string tools from frontmatter tools array", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "mixed-tools.md"),
        `---
name: Mixed Tools
description: Agent with mixed tool types
tools:
  - bash
  - edit
---
Agent with tools.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");

      expect(agents.length).toBe(1);
      expect(agents[0]?.tools).toEqual(["bash", "edit"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses flow-sequence tool arrays without retaining quote characters", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(
        join(root, "agents", "flow-tools.md"),
        `---
name: Flow Tools
description: Agent with flow-sequence tools
tools: ["execute", "agent", "edit", "search", "read"]
---
Agent with flow tools.`,
        "utf-8",
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");

      expect(agents.length).toBe(1);
      expect(agents[0]?.tools).toEqual(["execute", "agent", "edit", "search", "read"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ignores non-markdown files", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(join(root, "agents", "agent.md"), "---\nname: Valid\n---\nContent", "utf-8");
      await writeFile(join(root, "agents", "readme.txt"), "Not a markdown file", "utf-8");
      await writeFile(join(root, "agents", "config.json"), "{}", "utf-8");

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");

      expect(agents.length).toBe(1);
      expect(agents[0]?.name).toBe("Valid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns empty array when directory does not exist", async () => {
    const agents = await loadAgentsFromDir("/non/existent/directory", "local");
    expect(agents).toEqual([]);
  });

  test("skips unreadable or invalid files without failing", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      await mkdir(join(root, "agents"), { recursive: true });
      await writeFile(join(root, "agents", "valid.md"), "---\nname: Valid\n---\nContent", "utf-8");
      await writeFile(join(root, "agents", "invalid.md"), "\x00\x01\x02", "utf-8");

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");

      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.some((a) => a.name === "Valid")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("loadCopilotAgents", () => {
  test("merges agents from ~/.copilot and .github with local priority", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      const globalAgentsDir = join(root, ".copilot", "agents");
      await mkdir(globalAgentsDir, { recursive: true });
      await writeFile(
        join(globalAgentsDir, "global-agent.md"),
        "---\nname: Global Agent\n---\nGlobal content",
        "utf-8",
      );
      await writeFile(
        join(globalAgentsDir, "shared-agent.md"),
        "---\nname: Shared Agent\ndescription: From global\n---\nGlobal version",
        "utf-8",
      );

      const localAgentsDir = join(root, ".github", "agents");
      await mkdir(localAgentsDir, { recursive: true });
      await writeFile(
        join(localAgentsDir, "local-agent.md"),
        "---\nname: Local Agent\n---\nLocal content",
        "utf-8",
      );
      await writeFile(
        join(localAgentsDir, "shared-agent.md"),
        "---\nname: Shared Agent\ndescription: From local\n---\nLocal version",
        "utf-8",
      );

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
      expect(agents.find((a) => a.name === "Global Agent")?.source).toBe("global");
      expect(agents.find((a) => a.name === "Local Agent")?.source).toBe("local");
      expect(agents.find((a) => a.name === "Shared Agent")?.description).toBe("From local");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads agents from ~/.copilot global directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      const homeAgentsDir = join(root, ".copilot", "agents");
      await mkdir(homeAgentsDir, { recursive: true });
      await writeFile(
        join(homeAgentsDir, "home-agent.md"),
        "---\nname: Home Global Agent\n---\nHome global content",
        "utf-8",
      );

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

      await writeFile(
        join(homeAgentsDir, "home-agent.md"),
        "---\nname: Home Agent\n---\nHome content",
        "utf-8",
      );
      await writeFile(
        join(xdgAgentsDir, "xdg-agent.md"),
        "---\nname: XDG Agent\n---\nXDG content",
        "utf-8",
      );
      await writeFile(
        join(homeAgentsDir, "shared.md"),
        "---\nname: Shared Agent\ndescription: From home\n---\nHome version",
        "utf-8",
      );
      await writeFile(
        join(xdgAgentsDir, "shared.md"),
        "---\nname: Shared Agent\ndescription: From xdg\n---\nXDG version",
        "utf-8",
      );

      const plan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
        xdgConfigHome: join(root, ".config"),
      });

      const agents = await loadCopilotAgents(projectRoot, undefined, {
        providerDiscoveryPlan: plan,
      });

      expect(agents.some((agent) => agent.name === "Home Agent")).toBe(true);
      expect(agents.some((agent) => agent.name === "XDG Agent")).toBe(true);
      expect(agents.find((agent) => agent.name === "Shared Agent")?.description).toBe(
        "From xdg",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("performs case-insensitive deduplication", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      const globalDir = join(root, ".copilot", "agents");
      await mkdir(globalDir, { recursive: true });
      await writeFile(
        join(globalDir, "agent1.md"),
        "---\nname: Test Agent\n---\nLowercase version",
        "utf-8",
      );

      const localDir = join(root, ".github", "agents");
      await mkdir(localDir, { recursive: true });
      await writeFile(
        join(localDir, "agent2.md"),
        "---\nname: TEST AGENT\n---\nUppercase version",
        "utf-8",
      );

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
      await writeFile(
        join(projectRoot, ".github", "agents", "shared.md"),
        "---\nname: Shared Agent\ndescription: From local\n---\nLocal version",
        "utf-8",
      );

      await mkdir(join(userRoot, "agents"), { recursive: true });
      await writeFile(
        join(userRoot, "agents", "shared.md"),
        "---\nname: Shared Agent\ndescription: From global\n---\nGlobal version",
        "utf-8",
      );
      await writeFile(
        join(userRoot, "agents", "global-only.md"),
        "---\nname: Global Only\n---\nGlobal agent",
        "utf-8",
      );

      const plan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
      });

      const agents = await loadCopilotAgents(projectRoot, undefined, {
        providerDiscoveryPlan: plan,
      });

      expect(agents.find((agent) => agent.name === "Shared Agent")?.description).toBe(
        "From local",
      );
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
      await writeFile(
        join(projectRoot, ".github", "agents", "local.md"),
        "---\nname: Local Agent\n---\nProject-local agent",
        "utf-8",
      );

      await mkdir(join(userRoot, "agents"), { recursive: true });
      await writeFile(
        join(userRoot, "agents", "global.md"),
        "---\nname: Global Agent\n---\nGlobal agent",
        "utf-8",
      );

      const startupPlan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
      });

      startProviderDiscoverySessionCache({
        projectRoot,
        startupPlan,
      });

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
      await writeFile(
        join(projectRoot, ".github", "agents", "local.md"),
        "---\nname: Local Agent\n---\nProject-local agent",
        "utf-8",
      );

      const startupPlan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
      });

      startProviderDiscoverySessionCache({
        projectRoot,
        startupPlan,
      });

      let readdirCalls = 0;
      const countingFsOps = {
        readdir: async (dir: string) => {
          readdirCalls += 1;
          return readdir(dir);
        },
        readFile: async (file: string, encoding?: string) => {
          return readFile(file, encoding as BufferEncoding);
        },
      } as unknown as FsOps;

      await loadCopilotAgents(projectRoot, countingFsOps, {
        providerDiscoveryPlan: startupPlan,
      });
      const firstCallCount = readdirCalls;

      await loadCopilotAgents(projectRoot, countingFsOps, {
        providerDiscoveryPlan: startupPlan,
      });
      expect(readdirCalls).toBe(firstCallCount);

      invalidateProviderDiscoveryCaches();

      await loadCopilotAgents(projectRoot, countingFsOps, {
        providerDiscoveryPlan: startupPlan,
      });
      expect(readdirCalls).toBeGreaterThan(firstCallCount);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolveCopilotSkillDirectories", () => {
  test("uses provided discovery plan and returns existing skill directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      const projectRoot = join(root, "workspace");

      const expectedDirectories = [
        join(projectRoot, ".github", "skills"),
        join(root, ".copilot", "skills"),
      ];

      await Promise.all(
        expectedDirectories.map((directoryPath) =>
          mkdir(directoryPath, { recursive: true }),
        ),
      );

      const plan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
      });

      const skillDirectories = await resolveCopilotSkillDirectories(projectRoot, {
        providerDiscoveryPlan: plan,
      });

      expect(skillDirectories).toEqual(expectedDirectories);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses XDG Copilot root when discovery plan resolves to XDG", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      const projectRoot = join(root, "workspace");
      const xdgConfigHome = join(root, ".config");

      const expectedDirectories = [
        join(projectRoot, ".github", "skills"),
        join(xdgConfigHome, ".copilot", "skills"),
      ];

      await Promise.all(
        expectedDirectories.map((directoryPath) =>
          mkdir(directoryPath, { recursive: true }),
        ),
      );

      const plan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
        xdgConfigHome,
      });

      const skillDirectories = await resolveCopilotSkillDirectories(projectRoot, {
        providerDiscoveryPlan: plan,
      });

      expect(skillDirectories).toEqual(expectedDirectories);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

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
      const xdgInstructionsPath = join(
        xdgConfigHome,
        ".copilot",
        "copilot-instructions.md",
      );

      await mkdir(join(xdgConfigHome, ".copilot"), { recursive: true });
      await writeFile(xdgInstructionsPath, "XDG user instructions", "utf-8");

      const plan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
        xdgConfigHome,
      });

      const instructions = await loadCopilotInstructions(projectRoot, undefined, {
        providerDiscoveryPlan: plan,
      });

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
      await writeFile(
        join(root, ".copilot", "copilot-instructions.md"),
        "Home instructions",
        "utf-8",
      );

      await mkdir(join(xdgConfigHome, ".copilot"), { recursive: true });
      await writeFile(
        join(xdgConfigHome, ".copilot", "copilot-instructions.md"),
        "XDG instructions",
        "utf-8",
      );

      const plan = buildProviderDiscoveryPlan("copilot", {
        projectRoot,
        homeDir: root,
        xdgConfigHome,
      });

      const instructions = await loadCopilotInstructions(projectRoot, undefined, {
        providerDiscoveryPlan: plan,
      });

      expect(instructions).toBe("XDG instructions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("local instructions override global instructions", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      await mkdir(join(root, ".github"), { recursive: true });
      await writeFile(
        join(root, ".github", "copilot-instructions.md"),
        "Local instructions",
        "utf-8",
      );

      await mkdir(join(root, ".copilot"), { recursive: true });
      await writeFile(
        join(root, ".copilot", "copilot-instructions.md"),
        "Global instructions",
        "utf-8",
      );

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
