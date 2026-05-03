/**
 * Compatibility barrel for the init CLI command.
 *
 * The implementation now lives under `commands/cli/init/`, while the
 * historical `commands/cli/init.ts` path remains stable.
 */

export * from "./init/index.ts";
