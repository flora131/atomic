/**
 * Compatibility barrel for the OpenCode stream adapter.
 *
 * The provider-specific implementation now lives under
 * `events/adapters/providers/opencode.ts`, while the historical import path
 * remains stable.
 */

export * from "@/services/events/adapters/providers/opencode.ts";
