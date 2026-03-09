import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import {
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
  isBackgroundTerminationKey,
  type BackgroundTerminationDecision,
} from "@/lib/ui/background-agent-termination.ts";
import {
  BACKGROUND_FOOTER_CONTRACT,
  BACKGROUND_TREE_HINT_CONTRACT,
  type BackgroundFooterContract,
  type BackgroundTreeHintContract,
} from "@/lib/ui/background-agent-contracts.ts";
import {
  getActiveBackgroundAgents,
  formatBackgroundAgentFooterStatus,
  resolveBackgroundAgentsForFooter,
  type BackgroundAgentFooterMessage,
} from "@/lib/ui/background-agent-footer.ts";
import { buildParallelAgentsHeaderHint } from "@/lib/ui/background-agent-tree-hints.ts";

export {
  BACKGROUND_FOOTER_CONTRACT,
  BACKGROUND_TREE_HINT_CONTRACT,
  buildParallelAgentsHeaderHint,
  formatBackgroundAgentFooterStatus,
  getActiveBackgroundAgents,
  getBackgroundTerminationDecision,
  interruptActiveBackgroundAgents,
  isBackgroundTerminationKey,
  resolveBackgroundAgentsForFooter,
};

export type {
  BackgroundAgentFooterMessage,
  BackgroundFooterContract,
  BackgroundTerminationDecision,
  BackgroundTreeHintContract,
  ParallelAgent,
};

export function createAgent(
  overrides: Partial<ParallelAgent> = {},
): ParallelAgent {
  return {
    id: overrides.id ?? "agent-1",
    name: overrides.name ?? "task",
    task: overrides.task ?? "Background task",
    status: overrides.status ?? "background",
    background: overrides.background,
    startedAt: overrides.startedAt ?? new Date(1000000000000).toISOString(),
    currentTool: overrides.currentTool,
    durationMs: overrides.durationMs,
    result: overrides.result,
  };
}
