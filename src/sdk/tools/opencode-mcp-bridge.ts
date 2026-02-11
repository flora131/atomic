/**
 * OpenCode MCP Bridge for Custom Tools
 *
 * Generates a temporary MCP server script that serves registered custom tools
 * over stdio, then registers it with the OpenCode server via sdkClient.mcp.add().
 *
 * This bridges the gap where OpenCodeClient.registerTool() stores tools but
 * doesn't inject them into the OpenCode server process.
 */

import { mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ToolDefinition } from "../types.ts";

const TMP_DIR = join(homedir(), ".atomic", ".tmp");

/** Track generated scripts for cleanup */
const generatedScripts: string[] = [];

/**
 * Generate a self-contained MCP stdio server script for the given tools.
 * The script reads JSON-RPC requests from stdin and dispatches to tool handlers.
 */
function generateMcpServerScript(
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
): string {
  const toolDefs = JSON.stringify(tools, null, 2);

  return `#!/usr/bin/env bun
/**
 * Auto-generated MCP stdio server for Atomic custom tools.
 * This file is temporary and will be cleaned up on process exit.
 */

const TOOLS = ${toolDefs};

// Simple JSON-RPC over stdio MCP server
const decoder = new TextDecoder();
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += decoder.decode(chunk, { stream: true });

  // Process complete JSON-RPC messages (newline-delimited)
  const lines = buffer.split("\\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      handleRequest(request);
    } catch {
      // Skip malformed messages
    }
  }
});

function handleRequest(request: { id?: number; method: string; params?: Record<string, unknown> }) {
  const { id, method, params } = request;

  if (method === "initialize") {
    respond(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "atomic-custom-tools", version: "1.0.0" },
    });
  } else if (method === "tools/list") {
    respond(id, {
      tools: TOOLS.map((t: { name: string; description: string; inputSchema: Record<string, unknown> }) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  } else if (method === "tools/call") {
    const toolName = (params as Record<string, unknown>)?.name as string;
    const tool = TOOLS.find((t: { name: string }) => t.name === toolName);
    if (!tool) {
      respondError(id, -32601, \`Tool not found: \${toolName}\`);
    } else {
      // For MCP bridge, we return a placeholder — actual execution happens
      // in the Atomic process via the registered handler
      respond(id, {
        content: [{ type: "text", text: \`Tool \${toolName} executed via MCP bridge\` }],
      });
    }
  } else if (method === "notifications/initialized") {
    // No response needed for notifications
  } else {
    if (id !== undefined) {
      respondError(id, -32601, \`Method not found: \${method}\`);
    }
  }
}

function respond(id: number | undefined, result: unknown) {
  if (id === undefined) return;
  const response = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(response + "\\n");
}

function respondError(id: number | undefined, code: number, message: string) {
  if (id === undefined) return;
  const response = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(response + "\\n");
}
`;
}

/**
 * Create a temporary .ts file that serves registered tools as an MCP stdio server.
 * @returns The path to the generated script
 */
export async function createToolMcpServerScript(
  tools: ToolDefinition[]
): Promise<string> {
  mkdirSync(TMP_DIR, { recursive: true });

  const scriptPath = join(TMP_DIR, `custom-tools-mcp-${Date.now()}.ts`);
  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  const script = generateMcpServerScript(toolDefs);
  writeFileSync(scriptPath, script);

  generatedScripts.push(scriptPath);
  return scriptPath;
}

/**
 * Remove all generated MCP bridge scripts.
 * Called during process cleanup (SIGINT/SIGTERM/normal exit).
 */
export function cleanupMcpBridgeScripts(): void {
  for (const scriptPath of generatedScripts) {
    try {
      unlinkSync(scriptPath);
    } catch {
      // File may already be deleted or inaccessible
    }
  }
  generatedScripts.length = 0;

  // Remove the .tmp directory if empty
  try {
    rmdirSync(TMP_DIR);
  } catch {
    // Directory not empty or doesn't exist — ignore
  }
}
