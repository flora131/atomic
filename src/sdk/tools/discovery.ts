/**
 * Custom Tool Discovery and Registration
 *
 * Discovers .ts tool files from .atomic/tools/ (project-local) and
 * ~/.atomic/tools/ (global), dynamically imports them, and registers
 * them with SDK clients via CodingAgentClient.registerTool().
 *
 * Follows the same Filesystem Discovery + Dynamic Import pattern as
 * workflows (loadWorkflowsFromDisk in workflow-commands.ts) and skills
 * (discoverAndRegisterDiskSkills in skill-commands.ts).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { z } from "zod";
import type { CodingAgentClient, ToolDefinition, ToolContext, ToolHandlerResult } from "../types.ts";
import type { ToolInput } from "./plugin.ts";
import { zodToJsonSchema } from "./schema-utils.ts";
import { truncateToolOutput } from "./truncate.ts";
import { getToolRegistry } from "./registry.ts";

// ============================================================================
// Types
// ============================================================================

export type ToolSource = "local" | "global";

export interface DiscoveredToolFile {
  path: string;
  filename: string;
  source: ToolSource;
}

export interface LoadedCustomTool {
  definition: ToolDefinition;
  source: ToolSource;
  filePath: string;
}

// ============================================================================
// Constants
// ============================================================================

const HOME = homedir();

export const TOOL_SEARCH_PATHS = [
  // Project-local (highest priority)
  ".atomic/tools",
  // Global user tools
  join(HOME, ".atomic", "tools"),
] as const;

// ============================================================================
// Module State
// ============================================================================

let discoveredCustomTools: LoadedCustomTool[] = [];
/** Temporary rewritten tool files for cleanup */
const tempToolFiles: string[] = [];

// ============================================================================
// Plugin Import Resolution
// ============================================================================

/**
 * Get the absolute path to plugin.ts for @atomic/plugin resolution.
 */
function getPluginPath(): string {
  return resolve(dirname(import.meta.path), "plugin.ts");
}

/**
 * Prepare a tool file for import by resolving @atomic/plugin to an absolute path.
 *
 * Bun.plugin() onResolve doesn't intercept @-scoped packages at runtime,
 * so we rewrite the import to use the absolute path directly.
 * The rewritten file is placed in a temp directory and cleaned up on exit.
 */
function prepareToolFileForImport(toolFilePath: string): string {
  const content = readFileSync(toolFilePath, "utf-8");

  // If the file doesn't import @atomic/plugin, import it directly
  if (!content.includes("@atomic/plugin")) {
    return toolFilePath;
  }

  const pluginPath = getPluginPath();
  // Replace @atomic/plugin with the absolute path
  const rewritten = content.replace(
    /["']@atomic\/plugin["']/g,
    `"${pluginPath}"`
  );

  // Write to a temp file next to the original
  const tmpDir = join(HOME, ".atomic", ".tmp", "tools");
  mkdirSync(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, `${Date.now()}-${toolFilePath.split("/").pop()}`);
  writeFileSync(tmpFile, rewritten);
  tempToolFiles.push(tmpFile);

  return tmpFile;
}

/**
 * Clean up temporary rewritten tool files.
 */
export function cleanupTempToolFiles(): void {
  for (const tmpFile of tempToolFiles) {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
  tempToolFiles.length = 0;

  const tmpDir = join(HOME, ".atomic", ".tmp", "tools");
  try {
    const { rmdirSync } = require("fs");
    rmdirSync(tmpDir);
  } catch { /* ignore if not empty */ }
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Scan TOOL_SEARCH_PATHS for .ts and .js tool files.
 * Local tools are collected before global to enable first-found-wins deduplication.
 */
export function discoverToolFiles(): DiscoveredToolFile[] {
  const discovered: DiscoveredToolFile[] = [];
  const cwd = process.cwd();

  for (let i = 0; i < TOOL_SEARCH_PATHS.length; i++) {
    const rawPath = TOOL_SEARCH_PATHS[i]!;
    const searchPath = rawPath.startsWith("/") ? rawPath : join(cwd, rawPath);
    const source: ToolSource = i === 0 ? "local" : "global";

    if (!existsSync(searchPath)) continue;

    try {
      const files = readdirSync(searchPath);
      for (const file of files) {
        if (file.endsWith(".ts") || file.endsWith(".js")) {
          discovered.push({
            path: join(searchPath, file),
            filename: file.replace(/\.(ts|js)$/, ""),
            source,
          });
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return discovered;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard: narrows a module export to ToolInput by checking required fields.
 */
function isToolExport(value: unknown): value is ToolInput<z.ZodRawShape> {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.description === "string" &&
    typeof obj.args === "object" &&
    obj.args !== null &&
    typeof obj.execute === "function"
  );
}

// ============================================================================
// Conversion
// ============================================================================

/**
 * Convert a user-authored ToolInput (Zod-based) to a ToolDefinition (JSON Schema-based).
 * The handler wraps the user's execute function with Zod validation and output truncation.
 */
function convertToToolDefinition(
  name: string,
  toolInput: ToolInput<z.ZodRawShape>
): ToolDefinition {
  const zodSchema = z.object(toolInput.args);
  const jsonSchema = zodToJsonSchema(zodSchema);

  return {
    name,
    description: toolInput.description,
    inputSchema: jsonSchema,
    handler: async (
      input: Record<string, unknown>,
      context: ToolContext
    ): Promise<ToolHandlerResult> => {
      const parsed = zodSchema.parse(input);
      const result = await toolInput.execute(parsed, context);
      const output = typeof result === "string" ? result : JSON.stringify(result);
      return truncateToolOutput(output);
    },
  };
}

// ============================================================================
// Loading
// ============================================================================

/**
 * Dynamically import discovered .ts files and extract ToolDefinition objects.
 *
 * Naming convention:
 * - Default export → tool name is the filename (e.g., lint.ts → lint)
 * - Named exports → tool name is <filename>_<exportName> (e.g., weather.ts:getTemp → weather_getTemp)
 *
 * Local tools override global tools with the same name (first-found-wins).
 */
export async function loadToolsFromDisk(): Promise<LoadedCustomTool[]> {
  const discovered = discoverToolFiles();
  const loaded: LoadedCustomTool[] = [];
  const loadedNames = new Set<string>();

  for (const { path, filename, source } of discovered) {
    try {
      const importPath = prepareToolFileForImport(path);
      const module = await import(importPath);

      for (const [exportName, exportValue] of Object.entries(module)) {
        if (!isToolExport(exportValue)) continue;

        const toolName =
          exportName === "default" ? filename : `${filename}_${exportName}`;

        // Local takes priority over global (first-found-wins)
        if (loadedNames.has(toolName)) continue;
        loadedNames.add(toolName);

        const definition = convertToToolDefinition(toolName, exportValue);
        loaded.push({ definition, source, filePath: path });
      }
    } catch (err) {
      console.warn(`Failed to load tool from ${path}: ${err}`);
    }
  }

  return loaded;
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Discover, load, and register custom tools with an SDK client.
 * Called from chat.ts after client creation, before client.start().
 *
 * @returns Number of tools registered
 */
export async function registerCustomTools(
  client: CodingAgentClient
): Promise<number> {
  const registry = getToolRegistry();
  discoveredCustomTools = await loadToolsFromDisk();

  for (const { definition, source, filePath } of discoveredCustomTools) {
    client.registerTool(definition);
    registry.register({
      name: definition.name,
      description: definition.description,
      definition,
      source,
      filePath,
    });
  }

  return discoveredCustomTools.length;
}

/**
 * Get the list of discovered custom tools (for /context display).
 */
export function getDiscoveredCustomTools(): LoadedCustomTool[] {
  return discoveredCustomTools;
}
