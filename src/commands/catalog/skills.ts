/**
 * Compatibility barrel for skill catalog discovery and registration.
 *
 * The implementation now lives under `commands/catalog/skills/`, while the
 * historical `commands/catalog/skills.ts` path remains stable.
 */

export * from "@/commands/catalog/skills/index.ts";
