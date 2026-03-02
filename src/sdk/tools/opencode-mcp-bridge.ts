/**
 * OpenCode MCP Bridge for Custom Tools
 *
 * Generates a temporary MCP server script that serves registered custom tools
 * over stdio, then registers it with the OpenCode server via sdkClient.mcp.add().
 *
 * Tool execution is dispatched back to the main Atomic process via a local HTTP
 * IPC server. This avoids the fundamental problem of serializing JavaScript
 * handler closures across process boundaries.
 *
 * Architecture:
 *   OpenCode server ──stdio──▶ MCP script ──HTTP──▶ Dispatch server (main process)
 *                                                        │
 *                                                   tool.handler()
 */

import { mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ToolDefinition, ToolContext } from "../types.ts";

const TMP_DIR = join(homedir(), ".atomic", ".tmp");

/** Track generated scripts for cleanup */
const generatedScripts: string[] = [];

// ============================================================================
// Tool Dispatch HTTP Server
// ============================================================================

/** Active dispatch server instance */
let dispatchServer: ReturnType<typeof Bun.serve> | null = null;

/** Factory that produces a ToolContext for the current session state */
export type ToolContextFactory = () => ToolContext;

/**
 * Start a local HTTP server that dispatches tool execution requests from the
 * generated MCP script back to the in-process tool handlers.
 *
 * @param tools    - Registered tool definitions (name → ToolDefinition)
 * @param contextFactory - Factory producing a ToolContext for handler invocations
 * @returns The port the server is listening on and a stop function
 */
export async function startToolDispatchServer(
  tools: Map<string, ToolDefinition>,
  contextFactory: ToolContextFactory,
): Promise<{ port: number; stop: () => void }> {
  // Stop any existing server before starting a new one
  stopToolDispatchServer();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0, // OS-assigned ephemeral port
    async fetch(req: Request): Promise<Response> {
      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      try {
        const body = (await req.json()) as {
          name: string;
          arguments?: Record<string, unknown>;
        };
        const { name, arguments: args } = body;

        const tool = tools.get(name);
        if (!tool) {
          return Response.json(
            { error: `Tool not found: ${name}` },
            { status: 404 },
          );
        }

        const context = contextFactory();
        const result = await tool.handler(args ?? {}, context);
        const text =
          typeof result === "string" ? result : JSON.stringify(result);

        return Response.json({
          content: [{ type: "text", text }],
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        return Response.json({
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        });
      }
    },
  });

  dispatchServer = server;

  return {
    port: server.port as number,
    stop: () => {
      server.stop();
      dispatchServer = null;
    },
  };
}

/**
 * Stop the active tool dispatch server (if any).
 * Called during process cleanup.
 */
export function stopToolDispatchServer(): void {
  if (dispatchServer) {
    dispatchServer.stop();
    dispatchServer = null;
  }
}

// ============================================================================
// MCP Script Generation
// ============================================================================

/**
 * Generate a self-contained MCP stdio server script for the given tools.
 * The script reads JSON-RPC requests from stdin and dispatches tool calls
 * to the main Atomic process via HTTP IPC on the given port.
 */
function generateMcpServerScript(
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[],
  dispatchPort: number,
): string {
  const toolDefs = JSON.stringify(tools, null, 2);

  return `#!/usr/bin/env bun
/**
 * Auto-generated MCP stdio server for Atomic custom tools.
 * Tool execution is dispatched to the main Atomic process via HTTP IPC.
 * This file is temporary and will be cleaned up on process exit.
 */

const TOOLS = ${toolDefs};
const DISPATCH_URL = "http://127.0.0.1:${dispatchPort}";

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

async function handleRequest(request: { id?: number; method: string; params?: Record<string, unknown> }) {
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
    const toolArgs = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>;
    const tool = TOOLS.find((t: { name: string }) => t.name === toolName);

    if (!tool) {
      respondError(id, -32601, \`Tool not found: \${toolName}\`);
      return;
    }

    try {
      const res = await fetch(DISPATCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: toolName, arguments: toolArgs }),
      });

      const result = await res.json() as { content?: unknown[]; error?: string; isError?: boolean };

      if (!res.ok && result.error) {
        respondError(id, -32603, result.error);
      } else {
        respond(id, {
          content: result.content ?? [{ type: "text", text: "Tool executed successfully" }],
          isError: result.isError ?? false,
        });
      }
    } catch (err) {
      respondError(id, -32603, \`Tool dispatch failed: \${err instanceof Error ? err.message : String(err)}\`);
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
 * The script dispatches tool calls to the main process via HTTP on the given port.
 *
 * @param tools         - Tool definitions to expose
 * @param dispatchPort  - Port of the local tool dispatch HTTP server
 * @returns The path to the generated script
 */
export async function createToolMcpServerScript(
  tools: ToolDefinition[],
  dispatchPort: number,
): Promise<string> {
  mkdirSync(TMP_DIR, { recursive: true });

  const scriptPath = join(TMP_DIR, `custom-tools-mcp-${Date.now()}.ts`);
  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  const script = generateMcpServerScript(toolDefs, dispatchPort);
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
