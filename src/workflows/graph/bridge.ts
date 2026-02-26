/**
 * Unified sub-agent bridge interface for workflow graph execution.
 * Replaces the dual bridge pattern (TUI + SDK) with a single composable interface.
 * The TUI bridge adapter is the sole production implementation.
 */

import type {
    SubagentSpawnOptions,
    SubagentResult,
} from "./subagent-bridge.ts";
import type { CommandContext } from "../../ui/commands/registry.ts";

/**
 * Bridge interface for spawning sub-agents within workflow graph execution.
 * Implementations wrap the environment's agent spawning mechanism.
 */
export interface WorkflowBridge {
    spawn(
        agent: SubagentSpawnOptions,
        abortSignal?: AbortSignal,
    ): Promise<SubagentResult>;
    spawnParallel(
        agents: SubagentSpawnOptions[],
        abortSignal?: AbortSignal,
    ): Promise<SubagentResult[]>;
}

/**
 * Creates a WorkflowBridge backed by the TUI's spawnSubagentParallel.
 * This is the sole bridge implementation for runtime execution.
 */
export function createTUIBridge(context: CommandContext): WorkflowBridge {
    return {
        async spawn(agent, abortSignal) {
            const [result] = await context.spawnSubagentParallel!(
                [{ ...agent, abortSignal }],
                abortSignal,
            );
            return result!;
        },
        spawnParallel: (agents, abortSignal) =>
            context.spawnSubagentParallel!(agents, abortSignal),
    };
}
