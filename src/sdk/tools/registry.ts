/**
 * Tool Registry
 *
 * A singleton registry that stores discovered custom tool entries (handler + metadata)
 * and provides name-based lookup. Populated during startup alongside existing
 * registerCustomTools() flow, enabling graph nodes to reference tools by name.
 *
 * Follows the existing setClientProvider() / setWorkflowResolver() global setter pattern.
 */

import type { ToolDefinition } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export interface ToolEntry {
  name: string;
  description: string;
  definition: ToolDefinition;
  source: "local" | "global";
  filePath: string;
}

// ============================================================================
// Registry
// ============================================================================

export class ToolRegistry {
  private tools = new Map<string, ToolEntry>();

  register(entry: ToolEntry): void {
    this.tools.set(entry.name, entry);
  }

  get(name: string): ToolEntry | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): ToolEntry[] {
    return Array.from(this.tools.values());
  }

  clear(): void {
    this.tools.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalToolRegistry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!globalToolRegistry) {
    globalToolRegistry = new ToolRegistry();
  }
  return globalToolRegistry;
}

export function setToolRegistry(registry: ToolRegistry): void {
  globalToolRegistry = registry;
}
