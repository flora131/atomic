/**
 * Compatibility barrel for agent command discovery and registration.
 *
 * The implementation now lives under `commands/catalog/agents.ts`, while the
 * original `commands/tui/agent-commands.ts` import path remains stable.
 */

export * from "@/commands/catalog/agents.ts";
