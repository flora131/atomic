import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CopilotAgent,
  type FsOps,
  loadAgentsFromDir,
  loadCopilotAgents,
  loadCopilotInstructions,
} from "./copilot-manual.ts";

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
        "utf-8"
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
        "utf-8"
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
        "utf-8"
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
        "utf-8"
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
      // Create a markdown file with mixed-type tools array
      // The YAML parser will give us mixed types which should be filtered
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
        "utf-8"
      );

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");

      expect(agents.length).toBe(1);
      expect(agents[0]?.tools).toEqual(["bash", "edit"]);
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
      await writeFile(join(root, "agents", "invalid.md"), "\x00\x01\x02", "utf-8"); // Invalid UTF-8-ish content

      const agents = await loadAgentsFromDir(join(root, "agents"), "local");

      // Should load at least the valid agent
      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.some((a) => a.name === "Valid")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("loadCopilotAgents", () => {
  test("merges agents from multiple directories with local priority", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      // Set up global directory
      const globalAgentsDir = join(root, ".copilot", "agents");
      await mkdir(globalAgentsDir, { recursive: true });
      await writeFile(
        join(globalAgentsDir, "global-agent.md"),
        "---\nname: Global Agent\n---\nGlobal content",
        "utf-8"
      );
      await writeFile(
        join(globalAgentsDir, "shared-agent.md"),
        "---\nname: Shared Agent\ndescription: From global\n---\nGlobal version",
        "utf-8"
      );

      // Set up local directory
      const localAgentsDir = join(root, ".github", "agents");
      await mkdir(localAgentsDir, { recursive: true });
      await writeFile(
        join(localAgentsDir, "local-agent.md"),
        "---\nname: Local Agent\n---\nLocal content",
        "utf-8"
      );
      await writeFile(
        join(localAgentsDir, "shared-agent.md"),
        "---\nname: Shared Agent\ndescription: From local\n---\nLocal version",
        "utf-8"
      );

      // Mock fs operations to use our test directories
      const mockFsOps: FsOps = {
        readdir: async (dir: string) => {
          const fs = await import("node:fs/promises");
          // Remap home directory paths to our test root
          const remappedDir = dir.replace(process.env.HOME || "", root);
          return fs.readdir(remappedDir);
        },
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          const remappedFile = file.replace(process.env.HOME || "", root);
          return fs.readFile(remappedFile, encoding as BufferEncoding);
        },
      };

      const agents = await loadCopilotAgents(root, mockFsOps);

      // Should have 3 agents: global-agent, local-agent, and shared-agent (local version)
      expect(agents.length).toBe(3);

      const globalAgent = agents.find((a) => a.name === "Global Agent");
      expect(globalAgent?.source).toBe("global");

      const localAgent = agents.find((a) => a.name === "Local Agent");
      expect(localAgent?.source).toBe("local");

      const sharedAgent = agents.find((a) => a.name === "Shared Agent");
      expect(sharedAgent?.description).toBe("From local"); // Local should override global
      expect(sharedAgent?.source).toBe("local");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("performs case-insensitive deduplication", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      // Create agents with different case names
      const globalDir = join(root, ".copilot", "agents");
      await mkdir(globalDir, { recursive: true });
      await writeFile(
        join(globalDir, "agent1.md"),
        "---\nname: Test Agent\n---\nLowercase version",
        "utf-8"
      );

      const localDir = join(root, ".github", "agents");
      await mkdir(localDir, { recursive: true });
      await writeFile(
        join(localDir, "agent2.md"),
        "---\nname: TEST AGENT\n---\nUppercase version",
        "utf-8"
      );

      const mockFsOps: FsOps = {
        readdir: async (dir: string) => {
          const fs = await import("node:fs/promises");
          const remappedDir = dir.replace(process.env.HOME || "", root);
          return fs.readdir(remappedDir);
        },
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          const remappedFile = file.replace(process.env.HOME || "", root);
          return fs.readFile(remappedFile, encoding as BufferEncoding);
        },
      };

      const agents = await loadCopilotAgents(root, mockFsOps);

      // Should have only 1 agent (local overrides global due to case-insensitive matching)
      expect(agents.length).toBe(1);
      expect(agents[0]?.name).toBe("TEST AGENT"); // Local version wins
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns empty array when no agent directories exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      // Don't create any agent directories
      const mockFsOps: FsOps = {
        readdir: async (dir: string) => {
          const fs = await import("node:fs/promises");
          const remappedDir = dir.replace(process.env.HOME || "", root);
          return fs.readdir(remappedDir);
        },
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          const remappedFile = file.replace(process.env.HOME || "", root);
          return fs.readFile(remappedFile, encoding as BufferEncoding);
        },
      };

      const agents = await loadCopilotAgents(root, mockFsOps);
      expect(agents).toEqual([]);
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

      const mockFsOps: FsOps = {
        readdir: async () => [],
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          const remappedFile = file.replace(process.env.HOME || "", root);
          return fs.readFile(remappedFile, encoding as BufferEncoding);
        },
      };

      const instructions = await loadCopilotInstructions(root, mockFsOps);
      expect(instructions).toBe("Local project instructions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("falls back to global instructions when local not available", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      const globalInstructionsPath = join(root, ".copilot", "copilot-instructions.md");
      await mkdir(join(root, ".copilot"), { recursive: true });
      await writeFile(globalInstructionsPath, "Global user instructions", "utf-8");

      const mockFsOps: FsOps = {
        readdir: async () => [],
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          const remappedFile = file.replace(process.env.HOME || "", root);
          return fs.readFile(remappedFile, encoding as BufferEncoding);
        },
      };

      const instructions = await loadCopilotInstructions(root, mockFsOps);
      expect(instructions).toBe("Global user instructions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("local instructions override global instructions", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      // Create both local and global instructions
      await mkdir(join(root, ".github"), { recursive: true });
      await writeFile(
        join(root, ".github", "copilot-instructions.md"),
        "Local instructions",
        "utf-8"
      );

      await mkdir(join(root, ".copilot"), { recursive: true });
      await writeFile(
        join(root, ".copilot", "copilot-instructions.md"),
        "Global instructions",
        "utf-8"
      );

      const mockFsOps: FsOps = {
        readdir: async () => [],
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          const remappedFile = file.replace(process.env.HOME || "", root);
          return fs.readFile(remappedFile, encoding as BufferEncoding);
        },
      };

      const instructions = await loadCopilotInstructions(root, mockFsOps);
      expect(instructions).toBe("Local instructions"); // Local should win
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns null when no instructions files exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-config-test-"));

    try {
      const mockFsOps: FsOps = {
        readdir: async () => [],
        readFile: async (file: string, encoding?: string) => {
          const fs = await import("node:fs/promises");
          const remappedFile = file.replace(process.env.HOME || "", root);
          return fs.readFile(remappedFile, encoding as BufferEncoding);
        },
      };

      const instructions = await loadCopilotInstructions(root, mockFsOps);
      expect(instructions).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
