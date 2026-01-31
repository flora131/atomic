/**
 * HookManager - Unified hook registration for cross-SDK event handling
 *
 * This module provides a unified interface for registering hooks that work
 * across all coding agent SDKs (Claude, OpenCode, Copilot). It abstracts
 * the differences between SDK-specific hook implementations.
 */

import type { AgentType } from "../utils/telemetry/types.ts";
import type { ClaudeAgentClient, ClaudeHookConfig } from "./claude-client.ts";
import type { OpenCodeClient } from "./opencode-client.ts";
import type { CopilotClient } from "./copilot-client.ts";
import type { EventType } from "./types.ts";

/**
 * Unified hook event types that work across all SDKs
 */
export type UnifiedHookEvent =
  // Session lifecycle
  | "session.start"
  | "session.end"
  | "session.error"
  // Tool execution
  | "tool.before"
  | "tool.after"
  | "tool.error"
  // Message handling
  | "message.before"
  | "message.after"
  // Permission handling
  | "permission.request"
  // Subagent handling
  | "subagent.start"
  | "subagent.end";

/**
 * Context provided to hook handlers
 */
export interface HookContext {
  /** Session ID where the event occurred */
  sessionId: string;
  /** Type of agent that triggered the event */
  agentType: AgentType;
  /** ISO 8601 timestamp of the event */
  timestamp: string;
  /** Event-specific data */
  data: HookEventData;
}

/**
 * Base event data interface
 */
export interface BaseHookEventData {
  [key: string]: unknown;
}

/**
 * Session start event data
 */
export interface SessionStartEventData extends BaseHookEventData {
  config?: Record<string, unknown>;
}

/**
 * Session end event data
 */
export interface SessionEndEventData extends BaseHookEventData {
  reason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Session error event data
 */
export interface SessionErrorEventData extends BaseHookEventData {
  error: string | Error;
  code?: string;
}

/**
 * Tool before event data
 */
export interface ToolBeforeEventData extends BaseHookEventData {
  toolName: string;
  toolInput: unknown;
  toolUseId?: string;
}

/**
 * Tool after event data
 */
export interface ToolAfterEventData extends BaseHookEventData {
  toolName: string;
  toolResult: unknown;
  success: boolean;
  duration?: number;
}

/**
 * Tool error event data
 */
export interface ToolErrorEventData extends BaseHookEventData {
  toolName: string;
  error: string | Error;
  toolInput?: unknown;
}

/**
 * Message before event data
 */
export interface MessageBeforeEventData extends BaseHookEventData {
  content: string;
  role: "user" | "assistant" | "system";
}

/**
 * Message after event data
 */
export interface MessageAfterEventData extends BaseHookEventData {
  content: string;
  role: "user" | "assistant" | "system";
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Permission request event data
 */
export interface PermissionRequestEventData extends BaseHookEventData {
  toolName: string;
  toolInput: unknown;
  reason?: string;
}

/**
 * Subagent start event data
 */
export interface SubagentStartEventData extends BaseHookEventData {
  subagentId: string;
  subagentType?: string;
  task?: string;
}

/**
 * Subagent end event data
 */
export interface SubagentEndEventData extends BaseHookEventData {
  subagentId: string;
  success: boolean;
  result?: unknown;
}

/**
 * Union of all hook event data types
 */
export type HookEventData =
  | SessionStartEventData
  | SessionEndEventData
  | SessionErrorEventData
  | ToolBeforeEventData
  | ToolAfterEventData
  | ToolErrorEventData
  | MessageBeforeEventData
  | MessageAfterEventData
  | PermissionRequestEventData
  | SubagentStartEventData
  | SubagentEndEventData
  | BaseHookEventData;

/**
 * Hook handler function type
 */
export type HookHandler = (
  context: HookContext
) => void | Promise<void> | HookResult | Promise<HookResult>;

/**
 * Result that can be returned from a hook handler
 */
export interface HookResult {
  /** Whether to continue execution (default: true) */
  continue?: boolean;
  /** Modified data to pass to subsequent handlers */
  modifiedData?: Record<string, unknown>;
  /** Error to throw and abort execution */
  error?: Error | string;
}

/**
 * Map of event types to their corresponding data types
 */
export interface HookEventDataMap {
  "session.start": SessionStartEventData;
  "session.end": SessionEndEventData;
  "session.error": SessionErrorEventData;
  "tool.before": ToolBeforeEventData;
  "tool.after": ToolAfterEventData;
  "tool.error": ToolErrorEventData;
  "message.before": MessageBeforeEventData;
  "message.after": MessageAfterEventData;
  "permission.request": PermissionRequestEventData;
  "subagent.start": SubagentStartEventData;
  "subagent.end": SubagentEndEventData;
}

/**
 * Maps unified hook events to Claude SDK hook events
 */
const CLAUDE_HOOK_MAPPING: Partial<
  Record<UnifiedHookEvent, keyof ClaudeHookConfig>
> = {
  "session.start": "SessionStart",
  "session.end": "SessionEnd",
  "session.error": "Stop",
  "tool.before": "PreToolUse",
  "tool.after": "PostToolUse",
  "tool.error": "PostToolUseFailure",
  "permission.request": "PermissionRequest",
  "subagent.start": "SubagentStart",
  "subagent.end": "SubagentStop",
};

/**
 * Maps unified hook events to Copilot SDK event types
 */
const COPILOT_EVENT_MAPPING: Partial<Record<UnifiedHookEvent, EventType>> = {
  "session.start": "session.start",
  "session.end": "session.idle",
  "session.error": "session.error",
  "tool.before": "tool.start",
  "tool.after": "tool.complete",
  "subagent.start": "subagent.start",
  "subagent.end": "subagent.complete",
};

/**
 * Maps unified hook events to OpenCode SDK event types
 */
const OPENCODE_EVENT_MAPPING: Partial<Record<UnifiedHookEvent, EventType>> = {
  "session.start": "session.start",
  "session.end": "session.idle",
  "session.error": "session.error",
  "tool.before": "tool.start",
  "tool.after": "tool.complete",
  "message.after": "message.complete",
};

/**
 * HookManager provides unified hook registration across all SDK clients.
 *
 * It allows registering handlers for unified hook events, then applying
 * those handlers to any SDK client. The manager handles mapping between
 * unified events and SDK-specific events.
 *
 * @example
 * ```typescript
 * const hooks = new HookManager();
 *
 * hooks.on("tool.before", async (ctx) => {
 *   console.log(`Tool ${ctx.data.toolName} starting...`);
 * });
 *
 * hooks.on("session.end", async (ctx) => {
 *   console.log(`Session ${ctx.sessionId} ended`);
 * });
 *
 * // Apply to a Claude client
 * hooks.applyToClaudeClient(claudeClient);
 *
 * // Or apply to any client type
 * hooks.applyToCopilotClient(copilotClient);
 * ```
 */
export class HookManager {
  private handlers: Map<UnifiedHookEvent, Set<HookHandler>> = new Map();

  /**
   * Register a handler for a unified hook event
   * @param event - The unified hook event type
   * @param handler - The handler function to call
   * @returns Unsubscribe function to remove the handler
   */
  on<T extends UnifiedHookEvent>(event: T, handler: HookHandler): () => void {
    let eventHandlers = this.handlers.get(event);
    if (!eventHandlers) {
      eventHandlers = new Set();
      this.handlers.set(event, eventHandlers);
    }

    eventHandlers.add(handler);

    return () => {
      eventHandlers?.delete(handler);
    };
  }

  /**
   * Remove all handlers for a specific event
   * @param event - The unified hook event type
   */
  off(event: UnifiedHookEvent): void {
    this.handlers.delete(event);
  }

  /**
   * Remove all handlers
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Emit an event to all registered handlers
   * @param event - The unified hook event type
   * @param context - The hook context
   * @returns Combined result from all handlers
   */
  async emit(event: UnifiedHookEvent, context: HookContext): Promise<HookResult> {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers || eventHandlers.size === 0) {
      return { continue: true };
    }

    let modifiedData = { ...context.data };
    let shouldContinue = true;

    for (const handler of eventHandlers) {
      try {
        const result = await handler({
          ...context,
          data: modifiedData,
        });

        if (result && typeof result === "object") {
          if (result.error) {
            throw typeof result.error === "string"
              ? new Error(result.error)
              : result.error;
          }
          if (result.continue === false) {
            shouldContinue = false;
            break;
          }
          if (result.modifiedData) {
            modifiedData = { ...modifiedData, ...result.modifiedData };
          }
        }
      } catch (error) {
        console.error(`Error in hook handler for ${event}:`, error);
        return {
          continue: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }

    return { continue: shouldContinue, modifiedData };
  }

  /**
   * Get the number of handlers registered for an event
   * @param event - The unified hook event type
   * @returns Number of handlers
   */
  handlerCount(event: UnifiedHookEvent): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /**
   * Check if any handlers are registered for an event
   * @param event - The unified hook event type
   * @returns True if handlers exist
   */
  hasHandlers(event: UnifiedHookEvent): boolean {
    return this.handlerCount(event) > 0;
  }

  /**
   * Apply registered hooks to a Claude client
   * @param client - The Claude client to apply hooks to
   */
  applyToClaudeClient(client: ClaudeAgentClient): void {
    const hookConfig: ClaudeHookConfig = {};

    for (const [unifiedEvent, claudeEvent] of Object.entries(CLAUDE_HOOK_MAPPING)) {
      if (this.hasHandlers(unifiedEvent as UnifiedHookEvent)) {
        hookConfig[claudeEvent as keyof ClaudeHookConfig] = [
          async (input, toolUseId, _options) => {
            const context: HookContext = {
              sessionId: input.session_id,
              agentType: "claude",
              timestamp: new Date().toISOString(),
              data: this.mapClaudeInputToEventData(
                unifiedEvent as UnifiedHookEvent,
                input,
                toolUseId
              ),
            };

            const result = await this.emit(unifiedEvent as UnifiedHookEvent, context);
            return { continue: result.continue !== false };
          },
        ];
      }
    }

    client.registerHooks(hookConfig);
  }

  /**
   * Apply registered hooks to an OpenCode client
   * @param client - The OpenCode client to apply hooks to
   */
  applyToOpenCodeClient(client: OpenCodeClient): void {
    for (const [unifiedEvent, openCodeEvent] of Object.entries(OPENCODE_EVENT_MAPPING)) {
      if (this.hasHandlers(unifiedEvent as UnifiedHookEvent) && openCodeEvent) {
        client.on(openCodeEvent, async (event) => {
          const context: HookContext = {
            sessionId: event.sessionId,
            agentType: "opencode",
            timestamp: event.timestamp,
            data: this.mapOpenCodeEventToData(
              unifiedEvent as UnifiedHookEvent,
              event.data as Record<string, unknown>
            ),
          };

          await this.emit(unifiedEvent as UnifiedHookEvent, context);
        });
      }
    }
  }

  /**
   * Apply registered hooks to a Copilot client
   * @param client - The Copilot client to apply hooks to
   */
  applyToCopilotClient(client: CopilotClient): void {
    for (const [unifiedEvent, copilotEvent] of Object.entries(COPILOT_EVENT_MAPPING)) {
      if (this.hasHandlers(unifiedEvent as UnifiedHookEvent) && copilotEvent) {
        client.on(copilotEvent, async (event) => {
          const context: HookContext = {
            sessionId: event.sessionId,
            agentType: "copilot",
            timestamp: event.timestamp,
            data: this.mapCopilotEventToData(
              unifiedEvent as UnifiedHookEvent,
              event.data as Record<string, unknown>
            ),
          };

          await this.emit(unifiedEvent as UnifiedHookEvent, context);
        });
      }
    }
  }

  /**
   * Map Claude hook input to unified event data
   */
  private mapClaudeInputToEventData(
    event: UnifiedHookEvent,
    input: Record<string, unknown>,
    toolUseId?: string
  ): HookEventData {
    switch (event) {
      case "session.start":
        return { config: input } as SessionStartEventData;
      case "session.end":
        return { reason: "ended" } as SessionEndEventData;
      case "session.error":
        return { error: input.error ?? "Unknown error" } as SessionErrorEventData;
      case "tool.before":
        return {
          toolName: input.tool_name as string,
          toolInput: input.tool_input,
          toolUseId,
        } as ToolBeforeEventData;
      case "tool.after":
        return {
          toolName: input.tool_name as string,
          toolResult: input.tool_result,
          success: true,
        } as ToolAfterEventData;
      case "tool.error":
        return {
          toolName: input.tool_name as string,
          error: input.error ?? "Unknown error",
          toolInput: input.tool_input,
        } as ToolErrorEventData;
      case "permission.request":
        return {
          toolName: input.tool_name as string,
          toolInput: input.tool_input,
          reason: input.reason as string,
        } as PermissionRequestEventData;
      case "subagent.start":
        return {
          subagentId: input.agent_id as string,
          subagentType: input.agent_type as string,
          task: input.task as string,
        } as SubagentStartEventData;
      case "subagent.end":
        return {
          subagentId: input.agent_id as string,
          success: true,
          result: input.result,
        } as SubagentEndEventData;
      default:
        return input as BaseHookEventData;
    }
  }

  /**
   * Map OpenCode event data to unified event data
   */
  private mapOpenCodeEventToData(
    event: UnifiedHookEvent,
    data: Record<string, unknown>
  ): HookEventData {
    switch (event) {
      case "session.start":
        return { config: data.config } as SessionStartEventData;
      case "session.end":
        return { reason: data.reason as string } as SessionEndEventData;
      case "session.error":
        return { error: data.error ?? "Unknown error" } as SessionErrorEventData;
      case "tool.before":
        return {
          toolName: data.toolName as string,
          toolInput: data.toolInput,
        } as ToolBeforeEventData;
      case "tool.after":
        return {
          toolName: data.toolName as string,
          toolResult: data.toolResult,
          success: data.success as boolean,
        } as ToolAfterEventData;
      case "message.after":
        return {
          content: data.content as string,
          role: "assistant",
          usage: data.usage as { inputTokens: number; outputTokens: number },
        } as MessageAfterEventData;
      default:
        return data as BaseHookEventData;
    }
  }

  /**
   * Map Copilot event data to unified event data
   */
  private mapCopilotEventToData(
    event: UnifiedHookEvent,
    data: Record<string, unknown>
  ): HookEventData {
    switch (event) {
      case "session.start":
        return { config: data.config } as SessionStartEventData;
      case "session.end":
        return { reason: data.reason as string } as SessionEndEventData;
      case "session.error":
        return { error: data.error ?? "Unknown error" } as SessionErrorEventData;
      case "tool.before":
        return {
          toolName: data.toolName as string,
          toolInput: data.toolInput,
        } as ToolBeforeEventData;
      case "tool.after":
        return {
          toolName: data.toolName as string,
          toolResult: data.toolResult,
          success: data.success as boolean,
        } as ToolAfterEventData;
      case "subagent.start":
        return {
          subagentId: data.subagentId as string,
          subagentType: data.subagentType as string,
          task: data.task as string,
        } as SubagentStartEventData;
      case "subagent.end":
        return {
          subagentId: data.subagentId as string,
          success: data.success as boolean,
          result: data.result,
        } as SubagentEndEventData;
      default:
        return data as BaseHookEventData;
    }
  }
}

/**
 * Factory function to create a HookManager instance
 */
export function createHookManager(): HookManager {
  return new HookManager();
}
