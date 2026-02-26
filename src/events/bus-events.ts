/**
 * Event Bus Type Definitions
 *
 * This module defines the typed event system for the new event bus architecture.
 * The event bus provides a centralized, type-safe pub/sub system for streaming
 * events from multiple SDK adapters (OpenCode, Claude, Copilot) and workflow nodes.
 *
 * Key concepts:
 * - BusEventType: String union of all event types
 * - BusEventDataMap: Type mapping from event type to payload structure
 * - BusEvent: The base event envelope with metadata
 * - EnrichedBusEvent: Extended event with correlation and suppression data
 * - BusEventSchemas: Zod schemas for runtime validation of event payloads
 */

import { z } from "zod";

/**
 * All event types supported by the event bus.
 *
 * Categories:
 * - stream.text.*: Text content streaming events
 * - stream.thinking.*: Reasoning/thinking content streaming
 * - stream.tool.*: Tool invocation lifecycle events
 * - stream.agent.*: Sub-agent lifecycle events
 * - stream.session.*: Session state management events
 * - workflow.*: Workflow execution events
 * - stream.permission.*: User permission request events
 * - stream.human_input_required: Human input request events
 * - stream.skill.*: Skill invocation events
 * - stream.usage: Token usage tracking events
 */
export type BusEventType =
  | "stream.text.delta"
  | "stream.text.complete"
  | "stream.thinking.delta"
  | "stream.thinking.complete"
  | "stream.tool.start"
  | "stream.tool.complete"
  | "stream.agent.start"
  | "stream.agent.update"
  | "stream.agent.complete"
  | "stream.session.start"
  | "stream.session.idle"
  | "stream.session.error"
  | "workflow.step.start"
  | "workflow.step.complete"
  | "workflow.task.update"
  | "stream.permission.requested"
  | "stream.human_input_required"
  | "stream.skill.invoked"
  | "stream.usage";

/**
 * Type mapping from event type to payload structure.
 *
 * This interface ensures type safety when publishing and subscribing to events.
 * Each event type has a well-defined payload structure.
 */
export interface BusEventDataMap {
  /**
   * Streaming text content delta (incremental chunk)
   */
  "stream.text.delta": {
    /** Text content delta to append */
    delta: string;
    /** Message ID this delta belongs to */
    messageId: string;
  };

  /**
   * Text streaming completion event
   */
  "stream.text.complete": {
    /** Message ID that completed */
    messageId: string;
    /** Full accumulated text content */
    fullText: string;
  };

  /**
   * Streaming thinking/reasoning content delta
   */
  "stream.thinking.delta": {
    /** Thinking content delta to append */
    delta: string;
    /** Source identifier for this thinking stream (e.g., block ID) */
    sourceKey: string;
    /** Message ID this thinking belongs to */
    messageId: string;
  };

  /**
   * Thinking stream completion event
   */
  "stream.thinking.complete": {
    /** Source identifier that completed */
    sourceKey: string;
    /** Duration of thinking in milliseconds */
    durationMs: number;
  };

  /**
   * Tool invocation started
   */
  "stream.tool.start": {
    /** Unique tool invocation ID */
    toolId: string;
    /** Name of the tool being invoked */
    toolName: string;
    /** Input parameters passed to the tool */
    toolInput: Record<string, unknown>;
    /** SDK correlation ID for tracking across adapters */
    sdkCorrelationId?: string;
    /** Parent agent ID if this tool was invoked by a sub-agent */
    parentAgentId?: string;
  };

  /**
   * Tool invocation completed
   */
  "stream.tool.complete": {
    /** Unique tool invocation ID */
    toolId: string;
    /** Name of the tool that completed */
    toolName: string;
    /** Input parameters passed to the tool (optional late payload) */
    toolInput?: Record<string, unknown>;
    /** Result returned by the tool */
    toolResult: unknown;
    /** Whether the tool execution succeeded */
    success: boolean;
    /** Error message if tool execution failed */
    error?: string;
    /** SDK correlation ID for tracking across adapters */
    sdkCorrelationId?: string;
  };

  /**
   * Sub-agent spawned and started
   */
  "stream.agent.start": {
    /** Unique agent ID */
    agentId: string;
    /** Type of agent (e.g., "explore", "task", "general-purpose") */
    agentType: string;
    /** Task description given to the agent */
    task: string;
    /** Whether the agent is running in background mode */
    isBackground: boolean;
    /** SDK correlation ID for tracking across adapters */
    sdkCorrelationId?: string;
  };

  /**
   * Sub-agent status update (progress notification)
   */
  "stream.agent.update": {
    /** Agent ID being updated */
    agentId: string;
    /** Current tool being used by the agent */
    currentTool?: string;
    /** Number of tool uses so far */
    toolUses?: number;
  };

  /**
   * Sub-agent completed execution
   */
  "stream.agent.complete": {
    /** Agent ID that completed */
    agentId: string;
    /** Whether the agent succeeded */
    success: boolean;
    /** Result summary returned by the agent */
    result?: string;
    /** Error message if agent execution failed */
    error?: string;
  };

  /**
   * Session started
   */
  "stream.session.start": {
    /** Session configuration (optional) */
    config?: Record<string, unknown>;
  };

  /**
   * Session entered idle state
   */
  "stream.session.idle": {
    /** Reason for entering idle state */
    reason?: string;
  };

  /**
   * Session error occurred
   */
  "stream.session.error": {
    /** Error message */
    error: string;
    /** Error code if available */
    code?: string;
  };

  /**
   * Workflow step started
   */
  "workflow.step.start": {
    /** Workflow instance ID */
    workflowId: string;
    /** Node ID within the workflow graph */
    nodeId: string;
    /** Human-readable node name */
    nodeName: string;
  };

  /**
   * Workflow step completed
   */
  "workflow.step.complete": {
    /** Workflow instance ID */
    workflowId: string;
    /** Node ID that completed */
    nodeId: string;
    /** Completion status */
    status: "success" | "error" | "skipped";
    /** Result data from the step (if any) */
    result?: unknown;
  };

  /**
   * Workflow task list updated
   */
  "workflow.task.update": {
    /** Workflow instance ID */
    workflowId: string;
    /** Updated task list */
    tasks: Array<{
      /** Task ID */
      id: string;
      /** Task title/description */
      title: string;
      /** Task status (e.g., "pending", "in_progress", "complete") */
      status: string;
    }>;
  };

  /**
   * Permission requested from user (e.g., for tool execution)
   */
  "stream.permission.requested": {
    /** Unique request ID */
    requestId: string;
    /** Name of the tool requiring permission */
    toolName: string;
    /** Input parameters for the tool (optional) */
    toolInput?: Record<string, unknown>;
    /** Question text to display to user */
    question: string;
    /** Header text for the permission dialog (optional) */
    header?: string;
    /** Available response options */
    options: Array<{
      /** Option label */
      label: string;
      /** Option value */
      value: string;
      /** Option description (optional) */
      description?: string;
    }>;
    /** Whether multiple options can be selected */
    multiSelect?: boolean;
    /** Callback to respond with user's answer */
    respond?: (answer: string | string[]) => void;
    /** Tool call ID for correlation (optional) */
    toolCallId?: string;
  };

  /**
   * Human input required from user (e.g., in workflow)
   */
  "stream.human_input_required": {
    /** Unique request ID */
    requestId: string;
    /** Question text to display to user */
    question: string;
    /** Header text for the input dialog (optional) */
    header?: string;
    /** Available response options (optional) */
    options?: Array<{
      /** Option label */
      label: string;
      /** Option description (optional) */
      description?: string;
    }>;
    /** Node ID in workflow requesting input */
    nodeId: string;
    /** Callback to respond with user's answer */
    respond?: (answer: string | string[]) => void;
  };

  /**
   * Skill invoked (custom command executed)
   */
  "stream.skill.invoked": {
    /** Name of the skill */
    skillName: string;
    /** File path to the skill (optional) */
    skillPath?: string;
  };

  /**
   * Token usage information
   */
  "stream.usage": {
    /** Number of input tokens consumed */
    inputTokens: number;
    /** Number of output tokens generated */
    outputTokens: number;
    /** Model identifier (optional) */
    model?: string;
  };
}

/**
 * Define a typed bus event with Zod schema validation (OpenCode pattern).
 *
 * @param type - Event type string
 * @param schema - Zod schema for validating event data
 * @returns Event definition with type, schema, and parse function
 */
export function defineBusEvent<T extends string, S extends z.ZodType>(
  type: T,
  schema: S,
) {
  return {
    type,
    schema,
    parse: (data: unknown) => schema.parse(data),
  } as const;
}

/**
 * Zod schemas for all bus event data payloads.
 * Used by publish() to validate event data at runtime.
 */
export const BusEventSchemas: Record<BusEventType, z.ZodType> = {
  "stream.text.delta": z.object({
    delta: z.string(),
    messageId: z.string(),
  }),
  "stream.text.complete": z.object({
    messageId: z.string(),
    fullText: z.string(),
  }),
  "stream.thinking.delta": z.object({
    delta: z.string(),
    sourceKey: z.string(),
    messageId: z.string(),
  }),
  "stream.thinking.complete": z.object({
    sourceKey: z.string(),
    durationMs: z.number(),
  }),
  "stream.tool.start": z.object({
    toolId: z.string(),
    toolName: z.string(),
    toolInput: z.record(z.string(), z.unknown()),
    sdkCorrelationId: z.string().optional(),
    parentAgentId: z.string().optional(),
  }),
  "stream.tool.complete": z.object({
    toolId: z.string(),
    toolName: z.string(),
    toolInput: z.record(z.string(), z.unknown()).optional(),
    toolResult: z.unknown(),
    success: z.boolean(),
    error: z.string().optional(),
    sdkCorrelationId: z.string().optional(),
  }),
  "stream.agent.start": z.object({
    agentId: z.string(),
    agentType: z.string(),
    task: z.string(),
    isBackground: z.boolean(),
    sdkCorrelationId: z.string().optional(),
  }),
  "stream.agent.update": z.object({
    agentId: z.string(),
    currentTool: z.string().optional(),
    toolUses: z.number().optional(),
  }),
  "stream.agent.complete": z.object({
    agentId: z.string(),
    success: z.boolean(),
    result: z.string().optional(),
    error: z.string().optional(),
  }),
  "stream.session.start": z.object({
    config: z.record(z.string(), z.unknown()).optional(),
  }),
  "stream.session.idle": z.object({
    reason: z.string().optional(),
  }),
  "stream.session.error": z.object({
    error: z.string(),
    code: z.string().optional(),
  }),
  "workflow.step.start": z.object({
    workflowId: z.string(),
    nodeId: z.string(),
    nodeName: z.string(),
  }),
  "workflow.step.complete": z.object({
    workflowId: z.string(),
    nodeId: z.string(),
    status: z.enum(["success", "error", "skipped"]),
    result: z.unknown().optional(),
  }),
  "workflow.task.update": z.object({
    workflowId: z.string(),
    tasks: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
    })),
  }),
  "stream.permission.requested": z.object({
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.record(z.string(), z.unknown()).optional(),
    question: z.string(),
    header: z.string().optional(),
    options: z.array(z.object({
      label: z.string(),
      value: z.string(),
      description: z.string().optional(),
    })),
    multiSelect: z.boolean().optional(),
    respond: z.function().optional(),
    toolCallId: z.string().optional(),
  }),
  "stream.human_input_required": z.object({
    requestId: z.string(),
    question: z.string(),
    header: z.string().optional(),
    options: z.array(z.object({
      label: z.string(),
      description: z.string().optional(),
    })).optional(),
    nodeId: z.string(),
    respond: z.function().optional(),
  }),
  "stream.skill.invoked": z.object({
    skillName: z.string(),
    skillPath: z.string().optional(),
  }),
  "stream.usage": z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    model: z.string().optional(),
  }),
};

/**
 * Base event envelope for all bus events.
 *
 * All events flowing through the bus are wrapped in this structure,
 * which provides metadata for routing, correlation, and timestamp tracking.
 *
 * @template T - The specific event type (from BusEventType)
 */
export interface BusEvent<T extends BusEventType = BusEventType> {
  /** Event type identifier */
  type: T;
  /** Session ID that generated this event */
  sessionId: string;
  /** Run ID for staleness detection (increments per stream) */
  runId: number;
  /** Unix timestamp (milliseconds) when event was created */
  timestamp: number;
  /** Event-specific payload data */
  data: BusEventDataMap[T];
}

/**
 * Event handler callback type for typed subscriptions.
 *
 * @template T - The specific event type being handled
 */
export type BusHandler<T extends BusEventType> = (event: BusEvent<T>) => void;

/**
 * Wildcard event handler type for subscribing to all events.
 *
 * Useful for debugging, logging, and observability.
 */
export type WildcardHandler = (event: BusEvent) => void;

/**
 * Enriched event with correlation and suppression metadata.
 *
 * This is used internally by consumers (CorrelationService, EchoSuppressor)
 * to track which events belong to sub-agents and should be filtered or routed
 * differently in the UI.
 */
export interface EnrichedBusEvent extends BusEvent {
  /** Resolved tool invocation ID after correlation */
  resolvedToolId?: string;
  /** Resolved agent ID after correlation */
  resolvedAgentId?: string;
  /** Whether this is a tool call from a sub-agent */
  isSubagentTool?: boolean;
  /** Whether this event should be hidden in the main chat UI */
  suppressFromMainChat?: boolean;
}
