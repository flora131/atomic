/**
 * Command types — re-exported from the canonical location in `types/command.ts`.
 * The definitions live in `types/` so both `commands/` and `services/` can
 * import them without violating the dependency direction rule.
 */
export type {
  CommandCategory,
  CommandContext,
  CommandContextState,
  CommandDefinition,
  CommandResult,
  SpawnSubagentOptions,
  SpawnSubagentResult,
  StreamMessageOptions,
  StreamResult,
} from "@/types/command.ts";
