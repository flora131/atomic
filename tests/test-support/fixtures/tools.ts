/**
 * Test fixture factories for tool-related types.
 *
 * Provides properly-typed mock builders for ToolContext and other
 * tool-related interfaces, eliminating `{} as any` casts in tool tests.
 */

import type { ToolContext } from "@/services/agents/contracts/tools.ts";

// ---------------------------------------------------------------------------
// ToolContext factory
// ---------------------------------------------------------------------------

/**
 * Creates a properly-typed ToolContext with sensible defaults.
 *
 * Use this instead of `{} as any` for ToolContext in tests.
 *
 * @example
 * ```ts
 * const ctx = createMockToolContext({ sessionID: "session-1" });
 * const result = await tool.handler(input, ctx);
 * ```
 */
export function createMockToolContext(
  overrides?: Partial<ToolContext>,
): ToolContext {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    directory: process.cwd(),
    abort: new AbortController().signal,
    ...overrides,
  };
}
