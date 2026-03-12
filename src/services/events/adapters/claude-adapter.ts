/**
 * Compatibility barrel for the Claude stream adapter.
 *
 * The provider-specific implementation now lives under
 * `events/adapters/providers/claude.ts`, while the historical import path
 * remains stable.
 */

export * from "@/services/events/adapters/providers/claude.ts";
