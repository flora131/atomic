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
        break;
      }

      case "stream.tool.start": {
        const data = event.data as BusEventDataMap["stream.tool.start"];
        enriched.resolvedToolId = data.toolId;
        
        // Track which run this tool belongs to
        this.toolIdToRunMap.set(data.toolId, event.runId);
        
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
        }
        break;
      }

      case "stream.text.delta":
      case "stream.text.complete": {
        // Text events belong to the main agent by default
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
  }
}
