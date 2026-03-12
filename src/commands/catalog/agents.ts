/**
 * Compatibility barrel for agent catalog discovery and registration.
 *
 * The implementation now lives under `commands/catalog/agents/`, while the
 * historical `commands/catalog/agents.ts` path remains stable.
 */

export * from "@/commands/catalog/agents/index.ts";
