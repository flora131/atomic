/**
 * Compatibility barrel for skill command discovery and registration.
 *
 * The implementation now lives under `commands/catalog/skills.ts`, while the
 * original `commands/tui/skill-commands.ts` import path remains stable.
 */

export * from "@/commands/catalog/skills/index.ts";
