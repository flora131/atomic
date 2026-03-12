/**
 * Compatibility barrel for workflow command discovery and registration.
 *
 * The implementation now lives under `commands/tui/workflow-commands/`,
 * while the historical `commands/tui/workflow-commands.ts` path remains stable.
 */

export * from "@/commands/tui/workflow-commands/index.ts";
