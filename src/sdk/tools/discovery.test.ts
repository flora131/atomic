/**
 * Tests for registerCustomTools() in the chat init sequence.
 *
 * Verifies that:
 * 1. Each discovered tool is registered on the client via registerTool()
 * 2. Each discovered tool is added to the global ToolRegistry
 * 3. The returned count matches the number of discovered tools
 * 4. Zero tools results in no calls and a 0 return
 * 5. getDiscoveredCustomTools() reflects the latest registration
 */

import { describe, test, expect, beforeEach } from "bun:test";
import type { ToolDefinition } from "../types.ts";
import { ToolRegistry, setToolRegistry } from "./registry.ts";
import { registerCustomTools, getDiscoveredCustomTools } from "./discovery.ts";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Absolute path to zod so temp tool files can import it outside node_modules
const ZOD_PATH = resolve(import.meta.dir, "../../../node_modules/zod").replace(/\\/g, "/");

function makeFakeClient() {
  const registeredTools: ToolDefinition[] = [];
  return {
    registeredTools,
    registerTool(tool: ToolDefinition) {
      registeredTools.push(tool);
    },
  } as any;
}

async function withTempCwd(
  setup: (dir: string) => Promise<void>,
  run: () => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "atomic-discovery-test-"));
  await setup(tempDir);
  const originalCwd = process.cwd();
  process.chdir(tempDir);
  try {
    await run();
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

describe("registerCustomTools", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    setToolRegistry(registry);
  });

  test("registers discovered tools on client and in registry", async () => {
    await withTempCwd(
      async (dir) => {
        const toolsDir = join(dir, ".atomic", "tools");
        await mkdir(toolsDir, { recursive: true });
        await writeFile(
          join(toolsDir, "greet.ts"),
          `
import { z } from "${ZOD_PATH}";
export default {
  description: "Says hello",
  args: { name: z.string() },
  execute: async (input) => \`Hello, \${input.name}!\`,
};
`,
          "utf-8",
        );
      },
      async () => {
        const client = makeFakeClient();
        const count = await registerCustomTools(client);

        expect(count).toBe(1);
        expect(client.registeredTools).toHaveLength(1);
        expect(client.registeredTools[0].name).toBe("greet");
        expect(client.registeredTools[0].description).toBe("Says hello");

        // Registry should also contain the tool
        expect(registry.has("greet")).toBe(true);
        const entry = registry.get("greet")!;
        expect(entry.source).toBe("local");
        expect(entry.description).toBe("Says hello");

        // getDiscoveredCustomTools should reflect the registration
        const discovered = getDiscoveredCustomTools();
        expect(discovered).toHaveLength(1);
        expect(discovered[0]!.definition.name).toBe("greet");
      },
    );
  });

  test("returns 0 and makes no calls when no tools are found", async () => {
    await withTempCwd(
      async () => {
        // No .atomic/tools directory created
      },
      async () => {
        const client = makeFakeClient();
        const count = await registerCustomTools(client);

        expect(count).toBe(0);
        expect(client.registeredTools).toHaveLength(0);
        expect(registry.getAll()).toHaveLength(0);
      },
    );
  });

  test("registers multiple tools from multiple files", async () => {
    await withTempCwd(
      async (dir) => {
        const toolsDir = join(dir, ".atomic", "tools");
        await mkdir(toolsDir, { recursive: true });

        await writeFile(
          join(toolsDir, "alpha.ts"),
          `
import { z } from "${ZOD_PATH}";
export default {
  description: "Alpha tool",
  args: { x: z.number() },
  execute: async (input) => input.x * 2,
};
`,
          "utf-8",
        );

        await writeFile(
          join(toolsDir, "beta.ts"),
          `
import { z } from "${ZOD_PATH}";
export default {
  description: "Beta tool",
  args: {},
  execute: async () => "beta",
};
`,
          "utf-8",
        );
      },
      async () => {
        const client = makeFakeClient();
        const count = await registerCustomTools(client);

        expect(count).toBe(2);
        expect(client.registeredTools).toHaveLength(2);

        const names = client.registeredTools.map((t: ToolDefinition) => t.name).sort();
        expect(names).toEqual(["alpha", "beta"]);

        expect(registry.has("alpha")).toBe(true);
        expect(registry.has("beta")).toBe(true);
      },
    );
  });
});
