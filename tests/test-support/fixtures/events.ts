/**
 * Test fixture factories for BusEvent types.
 *
 * Each factory returns a fully-typed BusEvent with sensible defaults.
 * An optional `overrides.data` parameter lets tests customise the
 * event payload while keeping the envelope fields stable.
 */

import type {
  BusEvent,
  BusEventType,
  BusEventDataMap,
} from "@/services/events/bus-events/types.ts";

// ---------------------------------------------------------------------------
// Run-ID counter — deterministic, incrementing per-test.
// ---------------------------------------------------------------------------

let runIdCounter = 0;

export function nextRunId(): number {
  return ++runIdCounter;
}

export function resetRunIdCounter(): void {
  runIdCounter = 0;
}

// ---------------------------------------------------------------------------
// Generic event builder
// ---------------------------------------------------------------------------

interface EventOverrides<T extends BusEventType> {
  sessionId?: string;
  runId?: number;
  timestamp?: number;
  data?: Partial<BusEventDataMap[T]>;
}

/**
 * Low-level builder: creates any BusEvent from a type key,
 * a complete default data object, and optional overrides.
 */
function buildEvent<T extends BusEventType>(
  type: T,
  defaultData: BusEventDataMap[T],
  overrides?: EventOverrides<T>,
): BusEvent<T> {
  return {
    type,
    sessionId: overrides?.sessionId ?? "session_test",
    runId: overrides?.runId ?? nextRunId(),
    timestamp: overrides?.timestamp ?? Date.now(),
    data: { ...defaultData, ...overrides?.data } as BusEventDataMap[T],
  };
}

// ---------------------------------------------------------------------------
// stream.text.*
// ---------------------------------------------------------------------------

export function createTextDeltaEvent(
  overrides?: EventOverrides<"stream.text.delta">,
): BusEvent<"stream.text.delta"> {
  return buildEvent(
    "stream.text.delta",
    { delta: "Hello", messageId: "msg_001" },
    overrides,
  );
}

export function createTextCompleteEvent(
  overrides?: EventOverrides<"stream.text.complete">,
): BusEvent<"stream.text.complete"> {
  return buildEvent(
    "stream.text.complete",
    { messageId: "msg_001", fullText: "Hello, world!" },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// stream.thinking.*
// ---------------------------------------------------------------------------

export function createThinkingDeltaEvent(
  overrides?: EventOverrides<"stream.thinking.delta">,
): BusEvent<"stream.thinking.delta"> {
  return buildEvent(
    "stream.thinking.delta",
    { delta: "Hmm...", sourceKey: "thinking_0", messageId: "msg_001" },
    overrides,
  );
}

export function createThinkingCompleteEvent(
  overrides?: EventOverrides<"stream.thinking.complete">,
): BusEvent<"stream.thinking.complete"> {
  return buildEvent(
    "stream.thinking.complete",
    { sourceKey: "thinking_0", durationMs: 200 },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// stream.tool.*
// ---------------------------------------------------------------------------

export function createToolStartEvent(
  overrides?: EventOverrides<"stream.tool.start">,
): BusEvent<"stream.tool.start"> {
  return buildEvent(
    "stream.tool.start",
    {
      toolId: "tool_001",
      toolName: "Read",
      toolInput: { file_path: "/tmp/test.ts" },
    },
    overrides,
  );
}

export function createToolCompleteEvent(
  overrides?: EventOverrides<"stream.tool.complete">,
): BusEvent<"stream.tool.complete"> {
  return buildEvent(
    "stream.tool.complete",
    {
      toolId: "tool_001",
      toolName: "Read",
      toolResult: "file contents",
      success: true,
    },
    overrides,
  );
}

export function createToolPartialResultEvent(
  overrides?: EventOverrides<"stream.tool.partial_result">,
): BusEvent<"stream.tool.partial_result"> {
  return buildEvent(
    "stream.tool.partial_result",
    { toolCallId: "tool_001", partialOutput: "partial..." },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// stream.agent.*
// ---------------------------------------------------------------------------

export function createAgentStartEvent(
  overrides?: EventOverrides<"stream.agent.start">,
): BusEvent<"stream.agent.start"> {
  return buildEvent(
    "stream.agent.start",
    {
      agentId: "agent_001",
      toolCallId: "call_001",
      agentType: "task",
      task: "Implement feature",
      isBackground: false,
    },
    overrides,
  );
}

export function createAgentUpdateEvent(
  overrides?: EventOverrides<"stream.agent.update">,
): BusEvent<"stream.agent.update"> {
  return buildEvent(
    "stream.agent.update",
    { agentId: "agent_001" },
    overrides,
  );
}

export function createAgentCompleteEvent(
  overrides?: EventOverrides<"stream.agent.complete">,
): BusEvent<"stream.agent.complete"> {
  return buildEvent(
    "stream.agent.complete",
    { agentId: "agent_001", success: true },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// stream.session.*
// ---------------------------------------------------------------------------

export function createSessionStartEvent(
  overrides?: EventOverrides<"stream.session.start">,
): BusEvent<"stream.session.start"> {
  return buildEvent("stream.session.start", {}, overrides);
}

export function createSessionIdleEvent(
  overrides?: EventOverrides<"stream.session.idle">,
): BusEvent<"stream.session.idle"> {
  return buildEvent("stream.session.idle", {}, overrides);
}

export function createSessionPartialIdleEvent(
  overrides?: EventOverrides<"stream.session.partial-idle">,
): BusEvent<"stream.session.partial-idle"> {
  return buildEvent(
    "stream.session.partial-idle",
    { completionReason: "stop", activeBackgroundAgentCount: 1 },
    overrides,
  );
}

export function createSessionErrorEvent(
  overrides?: EventOverrides<"stream.session.error">,
): BusEvent<"stream.session.error"> {
  return buildEvent(
    "stream.session.error",
    { error: "Something went wrong" },
    overrides,
  );
}

export function createSessionRetryEvent(
  overrides?: EventOverrides<"stream.session.retry">,
): BusEvent<"stream.session.retry"> {
  return buildEvent(
    "stream.session.retry",
    { attempt: 1, delay: 1000, message: "Retrying...", nextRetryAt: Date.now() + 1000 },
    overrides,
  );
}

export function createSessionInfoEvent(
  overrides?: EventOverrides<"stream.session.info">,
): BusEvent<"stream.session.info"> {
  return buildEvent(
    "stream.session.info",
    { infoType: "general", message: "Info message" },
    overrides,
  );
}

export function createSessionWarningEvent(
  overrides?: EventOverrides<"stream.session.warning">,
): BusEvent<"stream.session.warning"> {
  return buildEvent(
    "stream.session.warning",
    { warningType: "context_limit", message: "Context limit approaching" },
    overrides,
  );
}

export function createSessionTitleChangedEvent(
  overrides?: EventOverrides<"stream.session.title_changed">,
): BusEvent<"stream.session.title_changed"> {
  return buildEvent(
    "stream.session.title_changed",
    { title: "New conversation title" },
    overrides,
  );
}

export function createSessionTruncationEvent(
  overrides?: EventOverrides<"stream.session.truncation">,
): BusEvent<"stream.session.truncation"> {
  return buildEvent(
    "stream.session.truncation",
    { tokenLimit: 128000, tokensRemoved: 5000, messagesRemoved: 2 },
    overrides,
  );
}

export function createSessionCompactionEvent(
  overrides?: EventOverrides<"stream.session.compaction">,
): BusEvent<"stream.session.compaction"> {
  return buildEvent(
    "stream.session.compaction",
    { phase: "complete", success: true },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// stream.turn.*
// ---------------------------------------------------------------------------

export function createTurnStartEvent(
  overrides?: EventOverrides<"stream.turn.start">,
): BusEvent<"stream.turn.start"> {
  return buildEvent(
    "stream.turn.start",
    { turnId: "turn_001" },
    overrides,
  );
}

export function createTurnEndEvent(
  overrides?: EventOverrides<"stream.turn.end">,
): BusEvent<"stream.turn.end"> {
  return buildEvent(
    "stream.turn.end",
    { turnId: "turn_001" },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// stream.permission.requested
// ---------------------------------------------------------------------------

export function createPermissionRequestedEvent(
  overrides?: EventOverrides<"stream.permission.requested">,
): BusEvent<"stream.permission.requested"> {
  return buildEvent(
    "stream.permission.requested",
    {
      requestId: "perm_001",
      toolName: "Bash",
      question: "Allow this command?",
      options: [
        { label: "Allow", value: "allow" },
        { label: "Deny", value: "deny" },
      ],
    },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// stream.human_input_required
// ---------------------------------------------------------------------------

export function createHumanInputRequiredEvent(
  overrides?: EventOverrides<"stream.human_input_required">,
): BusEvent<"stream.human_input_required"> {
  return buildEvent(
    "stream.human_input_required",
    {
      requestId: "hitl_001",
      question: "What should we do next?",
      nodeId: "node_plan",
    },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// stream.skill.invoked
// ---------------------------------------------------------------------------

export function createSkillInvokedEvent(
  overrides?: EventOverrides<"stream.skill.invoked">,
): BusEvent<"stream.skill.invoked"> {
  return buildEvent(
    "stream.skill.invoked",
    { skillName: "commit" },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// stream.usage
// ---------------------------------------------------------------------------

export function createUsageEvent(
  overrides?: EventOverrides<"stream.usage">,
): BusEvent<"stream.usage"> {
  return buildEvent(
    "stream.usage",
    { inputTokens: 1000, outputTokens: 500 },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// workflow.*
// ---------------------------------------------------------------------------

export function createWorkflowStepStartEvent(
  overrides?: EventOverrides<"workflow.step.start">,
): BusEvent<"workflow.step.start"> {
  return buildEvent(
    "workflow.step.start",
    {
      workflowId: "wf_test",
      nodeId: "node_research",
      indicator: "Stage 1/3: research",
    },
    overrides,
  );
}

export function createWorkflowStepCompleteEvent(
  overrides?: EventOverrides<"workflow.step.complete">,
): BusEvent<"workflow.step.complete"> {
  return buildEvent(
    "workflow.step.complete",
    {
      workflowId: "wf_test",
      nodeId: "node_research",
      status: "completed",
      durationMs: 5000,
    },
    overrides,
  );
}

export function createWorkflowTaskUpdateEvent(
  overrides?: EventOverrides<"workflow.task.update">,
): BusEvent<"workflow.task.update"> {
  return buildEvent(
    "workflow.task.update",
    {
      tasks: [
        {
          description: "Research the problem",
          status: "completed",
          summary: "Research complete",
        },
      ],
    },
    overrides,
  );
}
