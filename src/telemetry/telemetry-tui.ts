/**
 * Native TUI telemetry tracking.
 *
 * Tracks the actual chat UI lifecycle and interactions directly from the TUI:
 * - Session start/end
 * - Message submissions
 * - Slash command execution results
 * - Tool lifecycle
 * - User interrupts
 */

import { VERSION } from "../version";
import { appendEvent } from "./telemetry-file-io";
import { getOrCreateTelemetryState, isTelemetryEnabledSync } from "./telemetry";
import type {
  AgentType,
  TelemetryEventBase,
  TuiBackgroundTerminationEvent,
  TuiCommandCategory,
  TuiCommandExecutionEvent,
  TuiCommandTrigger,
  TuiInterruptEvent,
  TuiMessageSubmitEvent,
  TuiSessionEndEvent,
  TuiSessionStartEvent,
  TuiToolLifecycleEvent,
} from "./types";

export interface CreateTuiTelemetrySessionOptions {
  agentType: AgentType;
  workflowEnabled: boolean;
  hasInitialPrompt: boolean;
}

export interface TrackTuiMessageSubmitOptions {
  messageLength: number;
  queued: boolean;
  fromInitialPrompt: boolean;
  hasFileMentions: boolean;
  hasAgentMentions: boolean;
}

export interface TrackTuiCommandExecutionOptions {
  commandName: string;
  commandCategory: TuiCommandCategory;
  argsLength: number;
  success: boolean;
  trigger: TuiCommandTrigger;
}

export interface TuiSessionSummary {
  durationMs: number;
  messageCount: number;
  backgroundTerminationWarnCount?: number;
  backgroundTerminationExecuteCount?: number;
  backgroundTerminationNoopCount?: number;
}

function createCommonBaseEvent(anonymousId: string): TelemetryEventBase {
  return {
    anonymousId,
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    platform: process.platform,
    atomicVersion: VERSION,
    source: "tui",
  };
}

/**
 * Tracks one TUI chat session. All methods are safe no-ops when telemetry is disabled.
 */
export class TuiTelemetrySessionTracker {
  private readonly enabled: boolean;
  private readonly agentType: AgentType;
  private readonly sessionId: string;
  private readonly anonymousId: string | null;
  private ended: boolean;
  private messageSubmitCount: number;
  private commandCount: number;
  private toolCallCount: number;
  private interruptCount: number;
  private backgroundTerminationWarnCount: number;
  private backgroundTerminationExecuteCount: number;
  private backgroundTerminationNoopCount: number;

  constructor(options: CreateTuiTelemetrySessionOptions) {
    this.agentType = options.agentType;
    this.sessionId = crypto.randomUUID();
    this.ended = false;
    this.messageSubmitCount = 0;
    this.commandCount = 0;
    this.toolCallCount = 0;
    this.interruptCount = 0;
    this.backgroundTerminationWarnCount = 0;
    this.backgroundTerminationExecuteCount = 0;
    this.backgroundTerminationNoopCount = 0;
    this.enabled = isTelemetryEnabledSync();
    this.anonymousId = this.enabled ? getOrCreateTelemetryState().anonymousId : null;

    if (!this.enabled || !this.anonymousId) {
      return;
    }

    const event: TuiSessionStartEvent = {
      ...createCommonBaseEvent(this.anonymousId),
      eventType: "tui_session_start",
      source: "tui",
      sessionId: this.sessionId,
      agentType: this.agentType,
      workflowEnabled: options.workflowEnabled,
      hasInitialPrompt: options.hasInitialPrompt,
    };

    appendEvent(event, this.agentType);
  }

  trackMessageSubmit(options: TrackTuiMessageSubmitOptions): void {
    if (!this.enabled || !this.anonymousId || this.ended) {
      return;
    }

    this.messageSubmitCount++;

    const event: TuiMessageSubmitEvent = {
      ...createCommonBaseEvent(this.anonymousId),
      eventType: "tui_message_submit",
      source: "tui",
      sessionId: this.sessionId,
      agentType: this.agentType,
      messageLength: options.messageLength,
      queued: options.queued,
      fromInitialPrompt: options.fromInitialPrompt,
      hasFileMentions: options.hasFileMentions,
      hasAgentMentions: options.hasAgentMentions,
    };

    appendEvent(event, this.agentType);
  }

  trackCommandExecution(options: TrackTuiCommandExecutionOptions): void {
    if (!this.enabled || !this.anonymousId || this.ended) {
      return;
    }

    this.commandCount++;

    const event: TuiCommandExecutionEvent = {
      ...createCommonBaseEvent(this.anonymousId),
      eventType: "tui_command_execution",
      source: "tui",
      sessionId: this.sessionId,
      agentType: this.agentType,
      commandName: options.commandName,
      commandCategory: options.commandCategory,
      argsLength: options.argsLength,
      success: options.success,
      trigger: options.trigger,
    };

    appendEvent(event, this.agentType);
  }

  trackToolStart(toolName: string): void {
    if (!this.enabled || !this.anonymousId || this.ended) {
      return;
    }

    this.toolCallCount++;

    const event: TuiToolLifecycleEvent = {
      ...createCommonBaseEvent(this.anonymousId),
      eventType: "tui_tool_lifecycle",
      source: "tui",
      sessionId: this.sessionId,
      agentType: this.agentType,
      toolName,
      phase: "start",
    };

    appendEvent(event, this.agentType);
  }

  trackToolComplete(toolName: string, success: boolean): void {
    if (!this.enabled || !this.anonymousId || this.ended) {
      return;
    }

    const event: TuiToolLifecycleEvent = {
      ...createCommonBaseEvent(this.anonymousId),
      eventType: "tui_tool_lifecycle",
      source: "tui",
      sessionId: this.sessionId,
      agentType: this.agentType,
      toolName,
      phase: "complete",
      success,
    };

    appendEvent(event, this.agentType);
  }

  trackInterrupt(sourceType: "ui" | "signal"): void {
    if (!this.enabled || !this.anonymousId || this.ended) {
      return;
    }

    this.interruptCount++;

    const event: TuiInterruptEvent = {
      ...createCommonBaseEvent(this.anonymousId),
      eventType: "tui_interrupt",
      source: "tui",
      sessionId: this.sessionId,
      agentType: this.agentType,
      sourceType,
    };

    appendEvent(event, this.agentType);
  }

  trackBackgroundTermination(action: "noop" | "warn" | "execute", activeAgentCount: number, interruptedCount?: number): void {
    if (!this.enabled || !this.anonymousId || this.ended) {
      return;
    }

    if (action === "noop") {
      this.backgroundTerminationNoopCount++;
    } else if (action === "warn") {
      this.backgroundTerminationWarnCount++;
    } else if (action === "execute") {
      this.backgroundTerminationExecuteCount++;
    }

    const event: TuiBackgroundTerminationEvent = {
      ...createCommonBaseEvent(this.anonymousId),
      eventType: "tui_background_termination",
      source: "tui",
      sessionId: this.sessionId,
      agentType: this.agentType,
      action,
      activeAgentCount,
      interruptedCount,
    };

    appendEvent(event, this.agentType);
  }

  end(summary: TuiSessionSummary): void {
    if (!this.enabled || !this.anonymousId || this.ended) {
      return;
    }

    this.ended = true;

    const event: TuiSessionEndEvent = {
      ...createCommonBaseEvent(this.anonymousId),
      eventType: "tui_session_end",
      source: "tui",
      sessionId: this.sessionId,
      agentType: this.agentType,
      durationMs: Math.max(0, Math.floor(summary.durationMs)),
      messageCount: this.messageSubmitCount || Math.max(0, Math.floor(summary.messageCount)),
      commandCount: this.commandCount,
      toolCallCount: this.toolCallCount,
      interruptCount: this.interruptCount,
      backgroundTerminationWarnCount: this.backgroundTerminationWarnCount || summary.backgroundTerminationWarnCount,
      backgroundTerminationExecuteCount: this.backgroundTerminationExecuteCount || summary.backgroundTerminationExecuteCount,
      backgroundTerminationNoopCount: this.backgroundTerminationNoopCount || summary.backgroundTerminationNoopCount,
    };

    appendEvent(event, this.agentType);
  }
}

export function createTuiTelemetrySessionTracker(
  options: CreateTuiTelemetrySessionOptions
): TuiTelemetrySessionTracker {
  return new TuiTelemetrySessionTracker(options);
}
