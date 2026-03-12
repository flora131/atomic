/**
 * Compatibility barrel for the Copilot stream adapter.
 *
 * The provider-specific implementation now lives under
 * `events/adapters/providers/copilot.ts`, while the historical import path
 * remains stable.
 */

export * from "@/services/events/adapters/providers/copilot.ts";
