import { createToolRendererAliases } from "@/components/tool-registry/registry/aliases.ts";
import { defaultToolRenderer } from "@/components/tool-registry/registry/renderers/default.ts";
import { mcpToolRenderer, parseMcpToolName } from "@/components/tool-registry/registry/renderers/mcp.ts";
import { taskToolRenderer } from "@/components/tool-registry/registry/renderers/task.ts";
import type { ToolRenderer } from "@/components/tool-registry/registry/types.ts";

export const TOOL_RENDERERS: Record<string, ToolRenderer> = createToolRendererAliases();

export function registerAgentToolNames(agentNames: string[]): void {
  for (const name of agentNames) {
    if (!TOOL_RENDERERS[name]) {
      TOOL_RENDERERS[name] = taskToolRenderer;
    }
  }
}

export function getToolRenderer(toolName: string): ToolRenderer {
  if (TOOL_RENDERERS[toolName]) {
    return TOOL_RENDERERS[toolName];
  }
  if (parseMcpToolName(toolName)) {
    return mcpToolRenderer;
  }
  return defaultToolRenderer;
}

export function getRegisteredToolNames(): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(TOOL_RENDERERS)) {
    names.add(key.charAt(0).toUpperCase() + key.slice(1).toLowerCase());
  }
  return Array.from(names).sort();
}

export function hasCustomRenderer(toolName: string): boolean {
  return toolName in TOOL_RENDERERS;
}
