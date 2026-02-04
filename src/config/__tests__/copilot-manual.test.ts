/**
 * Tests for Copilot Manual Configuration Module
 *
 * Tests loadCopilotAgents, loadCopilotInstructions, and loadAgentsFromDir functions.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock modules
const mockReaddir = mock((dir: string) => Promise.resolve([] as string[]));
const mockReadFile = mock((filePath: string, encoding?: string) => Promise.resolve(""));

// Track mock implementations for fs/promises
mock.module("fs/promises", () => ({
  default: {
    readdir: mockReaddir,
    readFile: mockReadFile,
  },
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

// Import after mocking
import {
  loadCopilotAgents,
  loadCopilotInstructions,
  loadAgentsFromDir,
} from "../copilot-manual";

describe("loadAgentsFromDir", () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  test("returns empty array when directory does not exist", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT: no such file or directory"));

    const agents = await loadAgentsFromDir("/nonexistent/path", "local");
    expect(agents).toEqual([]);
  });

  test("returns empty array when directory is empty", async () => {
    mockReaddir.mockResolvedValue([]);

    const agents = await loadAgentsFromDir("/empty/path", "local");
    expect(agents).toEqual([]);
  });

  test("ignores non-md files", async () => {
    mockReaddir.mockResolvedValue(["file.txt", "image.png", "readme.md"]);
    mockReadFile.mockResolvedValue("System prompt content");

    const agents = await loadAgentsFromDir("/test/path", "local");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("readme");
  });

  test("parses agent without frontmatter", async () => {
    mockReaddir.mockResolvedValue(["simple.md"]);
    mockReadFile.mockResolvedValue("Just a system prompt\nwith multiple lines");

    const agents = await loadAgentsFromDir("/test/path", "global");
    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual({
      name: "simple",
      description: "Agent: simple",
      systemPrompt: "Just a system prompt\nwith multiple lines",
      source: "global",
    });
  });

  test("parses agent with frontmatter", async () => {
    mockReaddir.mockResolvedValue(["agent.md"]);
    mockReadFile.mockResolvedValue(`---
name: my-agent
description: A test agent
tools:
  - bash
  - read
---
This is the system prompt.`);

    const agents = await loadAgentsFromDir("/test/path", "local");
    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual({
      name: "my-agent",
      description: "A test agent",
      tools: ["bash", "read"],
      systemPrompt: "This is the system prompt.",
      source: "local",
    });
  });

  test("uses filename as name when not in frontmatter", async () => {
    mockReaddir.mockResolvedValue(["custom-agent.md"]);
    mockReadFile.mockResolvedValue(`---
description: Has description but no name
---
System prompt here.`);

    const agents = await loadAgentsFromDir("/test/path", "local");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("custom-agent");
    expect(agents[0]!.description).toBe("Has description but no name");
  });

  test("skips files that cannot be read", async () => {
    mockReaddir.mockResolvedValue(["good.md", "bad.md"]);
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes("bad.md")) {
        return Promise.reject(new Error("Permission denied"));
      }
      return Promise.resolve("Good content");
    });

    const agents = await loadAgentsFromDir("/test/path", "local");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("good");
  });

  test("loads multiple agents from directory", async () => {
    mockReaddir.mockResolvedValue(["agent1.md", "agent2.md", "agent3.md"]);
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes("agent1")) return Promise.resolve("Prompt 1");
      if (filePath.includes("agent2")) return Promise.resolve("Prompt 2");
      if (filePath.includes("agent3")) return Promise.resolve("Prompt 3");
      return Promise.resolve("");
    });

    const agents = await loadAgentsFromDir("/test/path", "local");
    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.name).sort()).toEqual(["agent1", "agent2", "agent3"]);
  });
});

describe("loadCopilotAgents", () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  test("returns empty array when no directories exist", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT: no such file or directory"));

    const agents = await loadCopilotAgents("/project");
    expect(agents).toEqual([]);
  });

  test("loads agents from local directory", async () => {
    mockReaddir.mockImplementation((dir: string) => {
      if (dir.includes(".github/agents")) {
        return Promise.resolve(["local-agent.md"]);
      }
      return Promise.reject(new Error("ENOENT"));
    });
    mockReadFile.mockResolvedValue("Local agent prompt");

    const agents = await loadCopilotAgents("/project");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.source).toBe("local");
    expect(agents[0]!.name).toBe("local-agent");
  });

  test("loads agents from global directory", async () => {
    mockReaddir.mockImplementation((dir: string) => {
      if (dir.includes(".copilot/agents")) {
        return Promise.resolve(["global-agent.md"]);
      }
      return Promise.reject(new Error("ENOENT"));
    });
    mockReadFile.mockResolvedValue("Global agent prompt");

    const agents = await loadCopilotAgents("/project");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.source).toBe("global");
    expect(agents[0]!.name).toBe("global-agent");
  });

  test("local agents override global agents with same name", async () => {
    mockReaddir.mockImplementation((dir: string) => {
      if (dir.includes(".github/agents")) {
        return Promise.resolve(["shared.md"]);
      }
      if (dir.includes(".copilot/agents")) {
        return Promise.resolve(["shared.md"]);
      }
      return Promise.reject(new Error("ENOENT"));
    });
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes(".github")) {
        return Promise.resolve("Local version");
      }
      return Promise.resolve("Global version");
    });

    const agents = await loadCopilotAgents("/project");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.source).toBe("local");
    expect(agents[0]!.systemPrompt).toBe("Local version");
  });

  test("agents from both directories are combined when names differ", async () => {
    mockReaddir.mockImplementation((dir: string) => {
      if (dir.includes(".github/agents")) {
        return Promise.resolve(["local-only.md"]);
      }
      if (dir.includes(".copilot/agents")) {
        return Promise.resolve(["global-only.md"]);
      }
      return Promise.reject(new Error("ENOENT"));
    });
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes("local-only")) {
        return Promise.resolve("Local prompt");
      }
      return Promise.resolve("Global prompt");
    });

    const agents = await loadCopilotAgents("/project");
    expect(agents).toHaveLength(2);
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["global-only", "local-only"]);
  });

  test("case-insensitive name matching for override", async () => {
    mockReaddir.mockImplementation((dir: string) => {
      if (dir.includes(".github/agents")) {
        return Promise.resolve(["MyAgent.md"]);
      }
      if (dir.includes(".copilot/agents")) {
        return Promise.resolve(["myagent.md"]);
      }
      return Promise.reject(new Error("ENOENT"));
    });
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes(".github")) {
        return Promise.resolve("Local MyAgent");
      }
      return Promise.resolve("Global myagent");
    });

    const agents = await loadCopilotAgents("/project");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.source).toBe("local");
    expect(agents[0]!.name).toBe("MyAgent");
  });
});

describe("loadCopilotInstructions", () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  test("returns local file when exists", async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes(".github/copilot-instructions.md")) {
        return Promise.resolve("Local instructions content");
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const result = await loadCopilotInstructions("/project");
    expect(result).toBe("Local instructions content");
  });

  test("falls back to global when local does not exist", async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes(".github/copilot-instructions.md")) {
        return Promise.reject(new Error("ENOENT"));
      }
      if (filePath.includes(".copilot/copilot-instructions.md")) {
        return Promise.resolve("Global instructions content");
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const result = await loadCopilotInstructions("/project");
    expect(result).toBe("Global instructions content");
  });

  test("returns null when neither exists", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT: no such file or directory"));

    const result = await loadCopilotInstructions("/project");
    expect(result).toBeNull();
  });

  test("prefers local over global when both exist", async () => {
    mockReadFile.mockImplementation((filePath: string) => {
      if (filePath.includes(".github/copilot-instructions.md")) {
        return Promise.resolve("Local takes priority");
      }
      if (filePath.includes(".copilot/copilot-instructions.md")) {
        return Promise.resolve("Global fallback");
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const result = await loadCopilotInstructions("/project");
    expect(result).toBe("Local takes priority");
  });
});
