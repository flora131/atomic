/**
 * Shared adapter-side correlation utility.
 *
 * Consolidates sub-agent registry lookups into a single shared
 * utility. Adapters call correlate() before publishing BusEvents
 * so events arrive at the consumer pipeline pre-correlated.
 *
 * Also exports resolveCorrelationIds() — the common pattern used by
 * all three provider adapters (Claude, OpenCode, Copilot) for
 * resolving and filtering variadic correlation ID lists through
 * an alias map.
 */

import type {
  BusEvent,
  BusEventDataMap,
  EnrichedBusEvent,
} from "@/services/events/bus-events/index.ts";

/**
 * Registry entry for a sub-agent, mapping it to its parent context.
 */
export interface SubagentRegistryEntry {
  parentAgentId: string;
  workflowRunId?: string;
  nodeId?: string;
}

/**
 * Context supplied by a provider adapter for event correlation.
 * Each adapter populates this from its own internal state.
 */
export interface AdapterCorrelationContext {
  /** Maps agentId -> parent context for sub-agents */
  subagentRegistry: ReadonlyMap<string, SubagentRegistryEntry>;
  /** Maps toolId -> owning agentId (for tool.complete fallback) */
  toolToAgent: ReadonlyMap<string, string>;
  /** Tool IDs belonging to sub-agents (not the main agent) */
  subAgentTools: ReadonlySet<string>;
  /** The primary agent ID for the current session (if any) */
  mainAgentId: string | null;
}

type AgentEventData = { agentId: string };
type ToolStartData = { toolId: string; parentAgentId?: string };
type ToolCompleteData = { toolId: string; parentAgentId?: string };
type ToolPartialData = { toolCallId: string; parentAgentId?: string };
type TextDeltaData = { agentId?: string; messageId: string };
type ThinkingDeltaData = { agentId?: string };
type UsageData = { agentId?: string };

/**
 * Extract the agent-relevant ID from a BusEvent based on its type.
 * Returns undefined for event types that carry no agent correlation.
 */
export function extractAgentId(event: BusEvent): string | undefined {
  switch (event.type) {
    case "stream.agent.start":
    case "stream.agent.update":
    case "stream.agent.complete":
      return (event.data as AgentEventData).agentId;

    case "stream.tool.start":
      return (event.data as ToolStartData).parentAgentId;

    case "stream.tool.complete":
      return (event.data as ToolCompleteData).parentAgentId;

    case "stream.tool.partial_result":
      return (event.data as ToolPartialData).parentAgentId;

    case "stream.text.delta":
      return (event.data as TextDeltaData).agentId;

    case "stream.thinking.delta":
      return (event.data as ThinkingDeltaData).agentId;

    case "stream.usage":
      return (event.data as UsageData).agentId;

    default:
      return undefined;
  }
}

/**
 * Look up sub-agent context for a given agent ID.
 */
function resolveSubagentContext(
  agentId: string | undefined,
  subagentRegistry: ReadonlyMap<string, SubagentRegistryEntry>,
): SubagentRegistryEntry | undefined {
  if (!agentId) return undefined;
  return subagentRegistry.get(agentId);
}

/**
 * Enrich a BusEvent with correlation metadata before publishing.
 *
 * Handles event correlation in the adapter layer. Each event type is
 * handled to resolve agent IDs, sub-agent parent context, and
 * suppression flags.
 *
 * Side effects: when processing tool.start events the caller is
 * responsible for registering the tool-to-agent mapping via the
 * mutable context (the function itself is pure and only reads).
 */
export function correlate(
  event: BusEvent,
  context: AdapterCorrelationContext,
): EnrichedBusEvent {
  const enriched: EnrichedBusEvent = {
    ...event,
    resolvedToolId: undefined,
    resolvedAgentId: undefined,
    parentAgentId: undefined,
    isSubagentTool: false,
    suppressFromMainChat: false,
  };

  switch (event.type) {
    case "stream.agent.start": {
      const data = event.data as BusEventDataMap["stream.agent.start"];
      enriched.resolvedAgentId = data.agentId;
      const ctx = resolveSubagentContext(data.agentId, context.subagentRegistry);
      if (ctx) {
        enriched.parentAgentId = ctx.parentAgentId;
      }
      break;
    }

    case "stream.agent.update": {
      const data = event.data as BusEventDataMap["stream.agent.update"];
      enriched.resolvedAgentId = data.agentId;
      const ctx = resolveSubagentContext(data.agentId, context.subagentRegistry);
      if (ctx) {
        enriched.parentAgentId = ctx.parentAgentId;
      }
      break;
    }

    case "stream.agent.complete": {
      const data = event.data as BusEventDataMap["stream.agent.complete"];
      enriched.resolvedAgentId = data.agentId;
      const ctx = resolveSubagentContext(data.agentId, context.subagentRegistry);
      if (ctx) {
        enriched.parentAgentId = ctx.parentAgentId;
      }
      break;
    }

    case "stream.tool.start": {
      const data = event.data as BusEventDataMap["stream.tool.start"];
      enriched.resolvedToolId = data.toolId;

      if (data.parentAgentId) {
        enriched.resolvedAgentId = data.parentAgentId;
        enriched.isSubagentTool = true;
        const ctx = resolveSubagentContext(data.parentAgentId, context.subagentRegistry);
        if (ctx) {
          enriched.parentAgentId = ctx.parentAgentId;
        }
      }

      if (!enriched.resolvedAgentId && context.mainAgentId) {
        enriched.resolvedAgentId = context.mainAgentId;
      }
      break;
    }

    case "stream.tool.complete": {
      const data = event.data as BusEventDataMap["stream.tool.complete"];
      enriched.resolvedToolId = data.toolId;

      const agentId = context.toolToAgent.get(data.toolId);
      if (agentId) {
        enriched.resolvedAgentId = agentId;
        enriched.isSubagentTool = context.subAgentTools.has(data.toolId);
        const ctx = resolveSubagentContext(agentId, context.subagentRegistry);
        if (ctx) {
          enriched.parentAgentId = ctx.parentAgentId;
          enriched.isSubagentTool = true;
        }
      } else if (data.parentAgentId) {
        enriched.resolvedAgentId = data.parentAgentId;
        enriched.isSubagentTool = true;
        const ctx = resolveSubagentContext(data.parentAgentId, context.subagentRegistry);
        if (ctx) {
          enriched.parentAgentId = ctx.parentAgentId;
        }
      }
      break;
    }

    case "stream.tool.partial_result": {
      const data = event.data as BusEventDataMap["stream.tool.partial_result"];
      enriched.resolvedToolId = data.toolCallId;

      const agentId = context.toolToAgent.get(data.toolCallId);
      if (agentId) {
        enriched.resolvedAgentId = agentId;
        enriched.isSubagentTool = context.subAgentTools.has(data.toolCallId);
        const ctx = resolveSubagentContext(agentId, context.subagentRegistry);
        if (ctx) {
          enriched.parentAgentId = ctx.parentAgentId;
          enriched.isSubagentTool = true;
        }
      } else if (data.parentAgentId) {
        enriched.resolvedAgentId = data.parentAgentId;
        enriched.isSubagentTool = true;
        const ctx = resolveSubagentContext(data.parentAgentId, context.subagentRegistry);
        if (ctx) {
          enriched.parentAgentId = ctx.parentAgentId;
        }
      }
      break;
    }

    case "stream.text.delta": {
      const data = event.data as BusEventDataMap["stream.text.delta"];
      if (data.agentId) {
        const ctx = resolveSubagentContext(data.agentId, context.subagentRegistry);
        if (ctx) {
          enriched.resolvedAgentId = data.agentId;
          enriched.parentAgentId = ctx.parentAgentId;
          break;
        }
      }
      enriched.resolvedAgentId = context.mainAgentId ?? undefined;
      break;
    }

    case "stream.text.complete": {
      const data = event.data as BusEventDataMap["stream.text.complete"];
      if (data.messageId?.startsWith("subagent-")) {
        const subAgentId = data.messageId.slice("subagent-".length);
        const ctx = resolveSubagentContext(subAgentId, context.subagentRegistry);
        if (ctx) {
          enriched.resolvedAgentId = subAgentId;
          enriched.parentAgentId = ctx.parentAgentId;
        }
        enriched.suppressFromMainChat = true;
      } else {
        enriched.resolvedAgentId = context.mainAgentId ?? undefined;
      }
      break;
    }

    case "stream.thinking.delta": {
      const data = event.data as BusEventDataMap["stream.thinking.delta"];
      if (data.agentId) {
        const ctx = resolveSubagentContext(data.agentId, context.subagentRegistry);
        if (ctx) {
          enriched.resolvedAgentId = data.agentId;
          enriched.parentAgentId = ctx.parentAgentId;
          break;
        }
      }
      enriched.resolvedAgentId = context.mainAgentId ?? undefined;
      break;
    }

    case "stream.usage": {
      const data = event.data as BusEventDataMap["stream.usage"];
      if (data.agentId) {
        const ctx = resolveSubagentContext(data.agentId, context.subagentRegistry);
        if (ctx) {
          enriched.resolvedAgentId = data.agentId;
          enriched.parentAgentId = ctx.parentAgentId;
          break;
        }
      }
      enriched.resolvedAgentId = context.mainAgentId ?? undefined;
      break;
    }

    default:
      break;
  }

  return enriched;
}

/**
 * Resolve a list of potentially-undefined correlation IDs through
 * an optional alias resolver, filtering out nullish/empty entries.
 *
 * This is the common pattern duplicated across Claude, OpenCode,
 * and Copilot adapters:
 *
 * ```ts
 * const ids = [toolId, ...correlationIds]
 *   .map((id) => resolve(id) ?? id)
 *   .filter((id): id is string => Boolean(id));
 * ```
 *
 * @param ids       Variadic list of correlation IDs (may include undefined)
 * @param resolve   Optional alias resolver (e.g. toolState.resolveToolCorrelationId)
 * @returns         Resolved, non-empty string IDs
 */
export function resolveCorrelationIds(
  ids: Array<string | undefined>,
  resolve?: (id: string) => string | undefined,
): string[] {
  const result: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    const resolved = resolve ? (resolve(id) ?? id) : id;
    if (resolved) {
      result.push(resolved);
    }
  }
  return result;
}
