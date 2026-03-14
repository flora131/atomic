/**
 * Custom Tools Module
 *
 * Re-exports tool registry, discovery, and plugin types for external consumers.
 */

export { getToolRegistry, setToolRegistry, ToolRegistry } from "@/services/agents/tools/registry.ts";
export type { ToolEntry } from "@/services/agents/tools/registry.ts";
export { registerCustomTools, cleanupTempToolFiles } from "@/services/agents/tools/discovery.ts";
