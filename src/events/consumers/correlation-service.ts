/**
 * Correlation Service for Event Enrichment
 *
 * This module implements the CorrelationService class that enriches BusEvents
 * with correlation metadata. It tracks tool-to-agent mappings and distinguishes
 * sub-agent tools from main agent tools.
 *
 * The CorrelationService replaces the correlation logic previously embedded in
 * the monolithic subscribeToToolEvents() function in src/ui/index.ts.
 *
 * Key responsibilities:
 * - Enrich BusEvents with resolvedToolId, resolvedAgentId, and isSubagentTool flags
 * - Track tool-to-agent relationships for attribution
 * - Maintain state across streaming events
 * - Support reset() for cleanup between runs
 *
 * Usage:
 * ```typescript
 * const correlationService = new CorrelationService();
 *
 * // Register tools as they start
 * correlationService.registerTool("tool_123", "agent_456", false);
 *
 * // Enrich events before processing
 * const enriched = correlationService.enrich(busEvent);
 *
 * // Reset state between streaming sessions
 * correlationService.reset();
 * ```
 */

import type { BusEvent, EnrichedBusEvent, BusEventDataMap } from "../bus-events.ts";

/**
 * Context for a registered sub-agent, mapping it to its parent workflow agent.
 */
export interface SubagentContext {
  /** The parent agent ID that spawned this sub-agent */
  parentAgentId: string;
  /** The workflow run ID this sub-agent belongs to */
  workflowRunId: string;
  /** The graph node ID this sub-agent is executing within (optional) */
  nodeId?: string;
}

/**
 * Service for enriching BusEvents with correlation metadata.
 *
 * The CorrelationService maintains mappings between tools and agents,
 * and enriches each event with resolved identifiers and flags that
 * determine how the event should be processed and displayed.
 *
 * The service tracks:
 * - Tool-to-agent mappings (which agent spawned which tool)
 * - Sub-agent tool set (tools belonging to sub-agents vs. main agent)
 * - Main agent ID (the primary agent driving the session)
 *
 * Enriched events include:
 * - resolvedToolId: The tool invocation ID associated with this event
 * - resolvedAgentId: The agent ID associated with this event
 * - isSubagentTool: Whether this tool belongs to a sub-agent
 * - suppressFromMainChat: Whether to hide this event in the main UI
 */
export class CorrelationService {
  /**
   * Maps tool IDs to their parent agent IDs.
   * Used to attribute tool events to the correct agent.
   */
  private toolToAgent = new Map<string, string>();

  /**
   * Set of tool IDs that belong to sub-agents (not the main chat agent).
   * These tools are displayed in the parallel agents tree and suppressed
   * from the main chat UI to avoid duplicate display.
   */
  private subAgentTools = new Set<string>();

  /**
   * Current main agent ID (if any).
   * The main agent is the first agent started in a streaming session.
   * Subsequent agents are considered sub-agents.
   */
  private mainAgentId: string | null = null;

  /**
   * Active run ID for this correlation service instance.
   * Set via startRun() to track which run this service is processing.
   */
  private _activeRunId: number | null = null;

  /**
   * Set of session IDs that this service owns.
   * Events from these sessions are considered "owned" by this service.
   */
  private ownedSessionIds = new Set<string>();

  /**
   * Maps tool IDs to their run IDs.
   * Populated when processing stream.tool.start events.
   */
  private toolIdToRunMap = new Map<string, number>();

  /**
   * Maps sub-agent agentId to parent context.
   * Used to attribute events from workflow sub-agents to their parent agent.
   */
  private subagentRegistry = new Map<string, SubagentContext>();

  /**
   * Enrich a BusEvent with correlation metadata.
   *
   * This method takes a raw BusEvent from the event bus and enriches it
   * with correlation information based on the service's internal tracking state.
   *
   * The enrichment process:
   * 1. Copies the original event properties
   * 2. Adds correlation fields (resolvedToolId, resolvedAgentId, etc.)
   * 3. Determines if the event belongs to a sub-agent
   * 4. Calculates suppression flags for UI filtering
   *
   * @param event - The raw BusEvent to enrich
   * @returns An EnrichedBusEvent with correlation metadata
   */
  enrich(event: BusEvent): EnrichedBusEvent {
    // Start with a copy of the event and initialize enrichment fields
    const enriched: EnrichedBusEvent = {
      ...event,
      resolvedToolId: undefined,
      resolvedAgentId: undefined,
      parentAgentId: undefined,
      isSubagentTool: false,
      suppressFromMainChat: false,
    };

    // Enrich based on event type
    switch (event.type) {
      case "stream.agent.start": {
        const data = event.data as BusEventDataMap["stream.agent.start"];

        // First agent started becomes the main agent
        if (!this.mainAgentId) {
          this.mainAgentId = data.agentId;
        }

        enriched.resolvedAgentId = data.agentId;

        // Check if this agent is a registered sub-agent
        const agentCtx = this.subagentRegistry.get(data.agentId);
        if (agentCtx) {
          enriched.parentAgentId = agentCtx.parentAgentId;
          enriched.suppressFromMainChat = false;
        }
        break;
      }

      case "stream.agent.update": {
        const data = event.data as BusEventDataMap["stream.agent.update"];
        enriched.resolvedAgentId = data.agentId;

        // Check if this agent is a registered sub-agent
        const updateCtx = this.subagentRegistry.get(data.agentId);
        if (updateCtx) {
          enriched.parentAgentId = updateCtx.parentAgentId;
          enriched.suppressFromMainChat = false;
        }
        break;
      }

      case "stream.agent.complete": {
        const data = event.data as BusEventDataMap["stream.agent.complete"];
        enriched.resolvedAgentId = data.agentId;

        // Check if this agent is a registered sub-agent
        const completeCtx = this.subagentRegistry.get(data.agentId);
        if (completeCtx) {
          enriched.parentAgentId = completeCtx.parentAgentId;
          enriched.suppressFromMainChat = false;
        }
        break;
      }

      case "stream.tool.start": {
        const data = event.data as BusEventDataMap["stream.tool.start"];
        enriched.resolvedToolId = data.toolId;

        // Track which run this tool belongs to
        this.toolIdToRunMap.set(data.toolId, event.runId);

        // Check if this tool's parentAgentId refers to a registered sub-agent
        if (data.parentAgentId) {
          const toolSubCtx = this.subagentRegistry.get(data.parentAgentId);
          if (toolSubCtx) {
            enriched.resolvedAgentId = data.parentAgentId;
            enriched.parentAgentId = toolSubCtx.parentAgentId;
            enriched.isSubagentTool = true;
            enriched.suppressFromMainChat = false;
            // Register tool ID so stream.tool.complete can look up the agent
            this.toolToAgent.set(data.toolId, data.parentAgentId);
            this.subAgentTools.add(data.toolId);
            break;
          }
        }

        // If we know which agent spawned this tool, correlate it
        // For tools without explicit agent correlation, use the main agent
        if (this.mainAgentId) {
          enriched.resolvedAgentId = this.mainAgentId;
        }
        break;
      }

      case "stream.tool.complete": {
        const data = event.data as BusEventDataMap["stream.tool.complete"];
        enriched.resolvedToolId = data.toolId;

        // Look up which agent owns this tool
        const agentId = this.toolToAgent.get(data.toolId);
        if (agentId) {
          enriched.resolvedAgentId = agentId;
          enriched.isSubagentTool = this.subAgentTools.has(data.toolId);

          // Check if the owning agent is a registered sub-agent
          const completeToolCtx = this.subagentRegistry.get(agentId);
          if (completeToolCtx) {
            enriched.parentAgentId = completeToolCtx.parentAgentId;
            enriched.isSubagentTool = true;
            enriched.suppressFromMainChat = false;
          }
        }
        break;
      }

      case "stream.text.delta": {
        const textDeltaData = event.data as BusEventDataMap["stream.text.delta"];
        // Check if agentId maps to a registered sub-agent
        if (textDeltaData.agentId) {
          const subCtx = this.subagentRegistry.get(textDeltaData.agentId);
          if (subCtx) {
            enriched.resolvedAgentId = textDeltaData.agentId;
            enriched.parentAgentId = subCtx.parentAgentId;
            break;
          }
        }
        enriched.resolvedAgentId = this.mainAgentId ?? undefined;
        break;
      }

      case "stream.text.complete": {
        const textCompleteData = event.data as BusEventDataMap["stream.text.complete"];
        // Sub-agent text-complete events must not trigger main stream completion.
        // Detect by messageId prefix set by SubagentStreamAdapter.
        if (textCompleteData.messageId?.startsWith("subagent-")) {
          const subAgentId = textCompleteData.messageId.slice("subagent-".length);
          const subCtx = this.subagentRegistry.get(subAgentId);
          if (subCtx) {
            enriched.resolvedAgentId = subAgentId;
            enriched.parentAgentId = subCtx.parentAgentId;
          }
          enriched.suppressFromMainChat = true;
        } else {
          enriched.resolvedAgentId = this.mainAgentId ?? undefined;
        }
        break;
      }

      case "stream.thinking.delta": {
        const thinkingData = event.data as BusEventDataMap["stream.thinking.delta"];
        if (thinkingData.agentId) {
          const subCtx = this.subagentRegistry.get(thinkingData.agentId);
          if (subCtx) {
            enriched.resolvedAgentId = thinkingData.agentId;
            enriched.parentAgentId = subCtx.parentAgentId;
            break;
          }
        }
        enriched.resolvedAgentId = this.mainAgentId ?? undefined;
        break;
      }

      case "stream.usage": {
        const usageData = event.data as BusEventDataMap["stream.usage"];
        if (usageData.agentId) {
          const subCtx = this.subagentRegistry.get(usageData.agentId);
          if (subCtx) {
            enriched.resolvedAgentId = usageData.agentId;
            enriched.parentAgentId = subCtx.parentAgentId;
            break;
          }
        }
        enriched.resolvedAgentId = this.mainAgentId ?? undefined;
        break;
      }

      // For other event types, leave enrichment fields as undefined
      // The consumer can handle them as appropriate
      default:
        break;
    }

    return enriched;
  }

  /**
   * Register a tool as belonging to an agent.
   *
   * This method establishes the correlation between a tool invocation
   * and the agent that spawned it. It should be called when a tool.start
   * event is processed and the agent context is known.
   *
   * @param toolId - The unique tool invocation ID
   * @param agentId - The agent ID that spawned this tool
   * @param isSubagent - Whether this tool belongs to a sub-agent (default: false)
   */
  registerTool(toolId: string, agentId: string, isSubagent = false): void {
    this.toolToAgent.set(toolId, agentId);

    if (isSubagent) {
      this.subAgentTools.add(toolId);
    }
  }

  /**
   * Register a sub-agent with its parent context.
   *
   * This enables the correlation service to attribute events from workflow
   * sub-agents to their parent agent and workflow run. When events with
   * the registered agentId are processed, the enrichment will include
   * parentAgentId and workflowRunId from the provided context.
   *
   * @param agentId - The unique sub-agent ID to register
   * @param context - Parent context including parentAgentId, workflowRunId, and optional nodeId
   */
  registerSubagent(agentId: string, context: SubagentContext): void {
    this.subagentRegistry.set(agentId, context);
  }

  /**
   * Unregister a sub-agent from the registry.
   *
   * Should be called when a sub-agent completes or is aborted to clean up
   * the registry entry. Events from the unregistered agentId will no longer
   * receive parent context enrichment.
   *
   * @param agentId - The sub-agent ID to unregister
   */
  unregisterSubagent(agentId: string): void {
    this.subagentRegistry.delete(agentId);
  }

  /**
   * Start tracking a new run.
   *
   * This method sets the active run ID and adds the session ID to the
   * set of owned sessions. It also calls reset() to clear any previous
   * run state (tool mappings, agent IDs, etc.).
   *
   * @param runId - The run ID to start tracking
   * @param sessionId - The session ID associated with this run
   */
  startRun(runId: number, sessionId: string): void {
    this.reset();
    this._activeRunId = runId;
    this.ownedSessionIds.add(sessionId);
  }

  /**
   * Add a session ID to the set of owned sessions without resetting state.
   *
   * Unlike startRun() which clears all state, this method only adds the
   * session ID to the ownership set. Use this to register additional sessions
   * (e.g., parent sessions for workflow sub-agents) that should be recognized
   * by isOwnedEvent().
   *
   * @param sessionId - The session ID to add to the owned set
   */
  addOwnedSession(sessionId: string): void {
    this.ownedSessionIds.add(sessionId);
  }

  /**
   * Check if an event is owned by this service.
   *
   * An event is considered "owned" if:
   * - Its runId matches the active run ID, OR
   * - Its sessionId is in the set of owned session IDs
   *
   * @param event - The event to check
   * @returns true if the event is owned by this service
   */
  isOwnedEvent(event: BusEvent): boolean {
    return (
      event.runId === this._activeRunId ||
      this.ownedSessionIds.has(event.sessionId)
    );
  }

  /**
   * Get the active run ID.
   *
   * @returns The active run ID, or null if no run is active
   */
  get activeRunId(): number | null {
    return this._activeRunId;
  }

  /**
   * Process a batch of events.
   *
   * This method enriches all events in the batch by calling enrich()
   * on each event.
   *
   * @param events - The batch of events to process
   * @returns An array of enriched events
   */
  processBatch(events: BusEvent[]): EnrichedBusEvent[] {
    return events.map(e => this.enrich(e));
  }

  /**
   * Reset all correlation state (call between runs).
   *
   * This method clears all internal tracking state, preparing the service
   * for a new streaming session. It should be called:
   * - Before starting a new streaming session
   * - When switching conversations
   * - On error recovery
   *
   * After reset(), the service behaves as if it was freshly instantiated.
   */
  reset(): void {
    this.toolToAgent.clear();
    this.subAgentTools.clear();
    this.mainAgentId = null;
    this._activeRunId = null;
    this.ownedSessionIds.clear();
    this.toolIdToRunMap.clear();
    this.subagentRegistry.clear();
  }
}
