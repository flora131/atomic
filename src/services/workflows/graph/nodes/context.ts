import type {
  BaseState,
  ContextWindowUsage,
  ExecutionContext,
  NodeDefinition,
  NodeResult,
  SignalData,
} from "@/services/workflows/graph/types.ts";
import {
  BACKGROUND_COMPACTION_THRESHOLD,
  computeCompactionThresholdPercent,
} from "@/services/workflows/graph/types.ts";
import type { ContextUsage, Session } from "@/services/agents/types.ts";
import type { AgentNodeAgentType } from "@/services/workflows/graph/nodes/agent.ts";

export type ContextCompactionAction =
  | "summarize"
  | "recreate"
  | "warn"
  | "none";

export interface ContextMonitoringState extends BaseState {
  contextWindowUsage: ContextWindowUsage | null;
}

export interface ContextMonitorNodeConfig<
  TState extends BaseState = BaseState,
> {
  id: string;
  agentType: AgentNodeAgentType;
  threshold?: number;
  action?: ContextCompactionAction;
  getSession?: (state: TState) => Session | null;
  getContextUsage?: (state: TState) => Promise<ContextUsage | null>;
  onCompaction?: (
    usage: ContextUsage,
    action: ContextCompactionAction,
  ) => void;
  name?: string;
  description?: string;
}

export function getDefaultCompactionAction(
  agentType: AgentNodeAgentType,
): ContextCompactionAction {
  switch (agentType) {
    case "opencode":
      return "summarize";
    case "claude":
      return "recreate";
    case "copilot":
      return "warn";
    default:
      return "warn";
  }
}

export function toContextWindowUsage(
  usage: ContextUsage,
): ContextWindowUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    maxTokens: usage.maxTokens,
    usagePercentage: usage.usagePercentage,
  };
}

export function isContextThresholdExceeded(
  usage: ContextUsage | ContextWindowUsage | null,
  threshold: number,
): boolean {
  if (!usage) {
    return false;
  }
  return usage.usagePercentage >= threshold;
}

export function contextMonitorNode<
  TState extends ContextMonitoringState = ContextMonitoringState,
>(config: ContextMonitorNodeConfig<TState>): NodeDefinition<TState> {
  const {
    id,
    agentType,
    threshold: configThreshold,
    action = getDefaultCompactionAction(agentType),
    getSession,
    getContextUsage: customGetContextUsage,
    onCompaction,
    name,
    description,
  } = config;

  return {
    id,
    type: "tool",
    name: name ?? "context-monitor",
    description: description ?? `Monitor context window usage (dynamic threshold)`,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      let usage: ContextUsage | null = null;

      if (customGetContextUsage) {
        usage = await customGetContextUsage(ctx.state);
      } else if (getSession) {
        const session = getSession(ctx.state);
        if (session) {
          usage = await session.getContextUsage();
        }
      } else if (ctx.contextWindowUsage) {
        usage = {
          inputTokens: ctx.contextWindowUsage.inputTokens,
          outputTokens: ctx.contextWindowUsage.outputTokens,
          maxTokens: ctx.contextWindowUsage.maxTokens,
          usagePercentage: ctx.contextWindowUsage.usagePercentage,
        };
      }

      const stateUpdate: Partial<TState> = {
        contextWindowUsage: usage ? toContextWindowUsage(usage) : null,
      } as Partial<TState>;

      const threshold = configThreshold
        ?? (usage ? computeCompactionThresholdPercent(usage.maxTokens) : BACKGROUND_COMPACTION_THRESHOLD * 100);

      if (!isContextThresholdExceeded(usage, threshold)) {
        return { stateUpdate };
      }

      const signals: SignalData[] = [];

      switch (action) {
        case "summarize": {
          const session = getSession?.(ctx.state);
          if (!session) {
            throw new Error(
              "Context compaction failed: no session available for summarization",
            );
          }
          const compactionState = session.getCompactionState?.();
          if (compactionState?.isCompacting || compactionState?.hasAutoCompacted) {
            break;
          }
          await session.summarize();
          onCompaction?.(usage!, action);

          const newUsage = await session.getContextUsage();
          stateUpdate.contextWindowUsage = newUsage
            ? toContextWindowUsage(newUsage)
            : null;
          break;
        }

        case "recreate":
          onCompaction?.(usage!, action);
          signals.push({
            type: "context_window_warning",
            message: `Context usage at ${usage!.usagePercentage.toFixed(1)}% - session recreation recommended`,
            data: {
              usagePercentage: usage!.usagePercentage,
              threshold,
              action: "recreate",
              shouldRecreateSession: true,
            },
          });
          break;

        case "warn":
          signals.push({
            type: "context_window_warning",
            message: `Context usage at ${usage!.usagePercentage.toFixed(1)}%`,
            data: {
              usagePercentage: usage!.usagePercentage,
              threshold,
              action: "warn",
            },
          });
          break;

        case "none":
          break;
      }

      return {
        stateUpdate,
        signals: signals.length > 0 ? signals : undefined,
      };
    },
  };
}

export interface ContextCheckOptions {
  threshold?: number;
  emitSignal?: boolean;
}

export async function checkContextUsage(
  session: Session,
  options: ContextCheckOptions = {},
): Promise<{ exceeded: boolean; usage: ContextUsage }> {
  const usage = await session.getContextUsage();
  const threshold = options.threshold ?? computeCompactionThresholdPercent(usage.maxTokens);
  return {
    exceeded: isContextThresholdExceeded(usage, threshold),
    usage,
  };
}

export async function compactContext(
  session: Session,
  agentType: AgentNodeAgentType,
): Promise<boolean> {
  const action = getDefaultCompactionAction(agentType);
  if (action === "summarize") {
    await session.summarize();
    return true;
  }
  return false;
}
