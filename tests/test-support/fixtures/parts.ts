/**
 * Test fixture factories for Part types.
 *
 * Provides reusable builders that return valid Part instances with
 * sensible defaults. Every factory accepts an optional overrides
 * object so tests can customise only the fields they care about.
 */

import type { PartId } from "@/state/parts/id.ts";
import type {
  TextPart,
  ReasoningPart,
  ToolPart,
  ToolState,
  AgentPart,
  TaskListPart,
  SkillLoadPart,
  McpSnapshotPart,
  AgentListPart,
  TruncationPart,
  TaskResultPart,
  WorkflowStepPart,
} from "@/state/parts/types.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { TaskItem } from "@/components/task-list-indicator.tsx";
import type { MessageSkillLoad } from "@/state/chat/shared/types/message.ts";
import type { McpSnapshotView } from "@/lib/ui/mcp-output.ts";
import type { AgentListView } from "@/lib/ui/agent-list-output.ts";

// ---------------------------------------------------------------------------
// ID counter — produces deterministic, lexicographically-ordered PartIds
// without touching the production `createPartId()` singleton.
// ---------------------------------------------------------------------------

let partIdCounter = 0;

/**
 * Generate a deterministic PartId for test fixtures.
 * The counter increments on every call so ids sort in creation order.
 */
export function nextPartId(): PartId {
  const id = `part_${String(++partIdCounter).padStart(12, "0")}` as PartId;
  return id;
}

/** Reset the fixture part-id counter (call in `beforeEach` if needed). */
export function resetPartIdCounter(): void {
  partIdCounter = 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// TextPart
// ---------------------------------------------------------------------------

export function createTextPart(overrides?: Partial<TextPart>): TextPart {
  return {
    id: nextPartId(),
    type: "text",
    createdAt: isoNow(),
    content: "Hello, world!",
    isStreaming: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ReasoningPart
// ---------------------------------------------------------------------------

export function createReasoningPart(
  overrides?: Partial<ReasoningPart>,
): ReasoningPart {
  return {
    id: nextPartId(),
    type: "reasoning",
    createdAt: isoNow(),
    content: "Let me think about this...",
    durationMs: 150,
    isStreaming: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ToolState helpers
// ---------------------------------------------------------------------------

export function createPendingToolState(): ToolState {
  return { status: "pending" };
}

export function createRunningToolState(
  overrides?: Partial<Extract<ToolState, { status: "running" }>>,
): ToolState {
  return { status: "running", startedAt: isoNow(), ...overrides };
}

export function createCompletedToolState(
  overrides?: Partial<Extract<ToolState, { status: "completed" }>>,
): ToolState {
  return {
    status: "completed",
    output: "tool output",
    durationMs: 42,
    ...overrides,
  };
}

export function createErrorToolState(
  overrides?: Partial<Extract<ToolState, { status: "error" }>>,
): ToolState {
  return { status: "error", error: "something went wrong", ...overrides };
}

export function createInterruptedToolState(
  overrides?: Partial<Extract<ToolState, { status: "interrupted" }>>,
): ToolState {
  return { status: "interrupted", ...overrides };
}

// ---------------------------------------------------------------------------
// ToolPart
// ---------------------------------------------------------------------------

export function createToolPart(overrides?: Partial<ToolPart>): ToolPart {
  return {
    id: nextPartId(),
    type: "tool",
    createdAt: isoNow(),
    toolCallId: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolName: "Read",
    input: { file_path: "/tmp/test.ts" },
    state: createPendingToolState(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AgentPart
// ---------------------------------------------------------------------------

export function createParallelAgent(
  overrides?: Partial<ParallelAgent>,
): ParallelAgent {
  return {
    id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: "test-agent",
    task: "Implement feature",
    status: "running",
    startedAt: isoNow(),
    ...overrides,
  };
}

export function createAgentPart(overrides?: Partial<AgentPart>): AgentPart {
  return {
    id: nextPartId(),
    type: "agent",
    createdAt: isoNow(),
    agents: [createParallelAgent()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TaskListPart
// ---------------------------------------------------------------------------

export function createTaskItem(overrides?: Partial<TaskItem>): TaskItem {
  return {
    description: "Complete the implementation",
    status: "pending",
    ...overrides,
  };
}

export function createTaskListPart(
  overrides?: Partial<TaskListPart>,
): TaskListPart {
  return {
    id: nextPartId(),
    type: "task-list",
    createdAt: isoNow(),
    items: [createTaskItem()],
    expanded: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SkillLoadPart
// ---------------------------------------------------------------------------

export function createSkillLoad(
  overrides?: Partial<MessageSkillLoad>,
): MessageSkillLoad {
  return {
    skillName: "test-skill",
    status: "loaded",
    ...overrides,
  };
}

export function createSkillLoadPart(
  overrides?: Partial<SkillLoadPart>,
): SkillLoadPart {
  return {
    id: nextPartId(),
    type: "skill-load",
    createdAt: isoNow(),
    skills: [createSkillLoad()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// McpSnapshotPart
// ---------------------------------------------------------------------------

export function createMcpSnapshotView(
  overrides?: Partial<McpSnapshotView>,
): McpSnapshotView {
  return {
    commandLabel: "/mcp",
    heading: "MCP Servers",
    docsHint: "See docs for more info",
    hasConfiguredServers: false,
    noToolsAvailable: true,
    servers: [],
    ...overrides,
  };
}

export function createMcpSnapshotPart(
  overrides?: Partial<McpSnapshotPart>,
): McpSnapshotPart {
  return {
    id: nextPartId(),
    type: "mcp-snapshot",
    createdAt: isoNow(),
    snapshot: createMcpSnapshotView(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AgentListPart
// ---------------------------------------------------------------------------

export function createAgentListView(
  overrides?: Partial<AgentListView>,
): AgentListView {
  return {
    heading: "Available Agents",
    totalCount: 0,
    projectAgents: [],
    globalAgents: [],
    ...overrides,
  };
}

export function createAgentListPart(
  overrides?: Partial<AgentListPart>,
): AgentListPart {
  return {
    id: nextPartId(),
    type: "agent-list",
    createdAt: isoNow(),
    view: createAgentListView(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TruncationPart
// ---------------------------------------------------------------------------

export function createTruncationPart(
  overrides?: Partial<TruncationPart>,
): TruncationPart {
  return {
    id: nextPartId(),
    type: "truncation",
    createdAt: isoNow(),
    summary: "Context was truncated to fit within the model window.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TaskResultPart
// ---------------------------------------------------------------------------

export function createTaskResultPart(
  overrides?: Partial<TaskResultPart>,
): TaskResultPart {
  return {
    id: nextPartId(),
    type: "task-result",
    createdAt: isoNow(),
    taskId: `task_${Date.now()}`,
    toolName: "Task",
    title: "Implement feature X",
    status: "completed",
    outputText: "Feature implemented successfully.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WorkflowStepPart
// ---------------------------------------------------------------------------

export function createWorkflowStepPart(
  overrides?: Partial<WorkflowStepPart>,
): WorkflowStepPart {
  return {
    id: nextPartId(),
    type: "workflow-step",
    createdAt: isoNow(),
    workflowId: "wf_test",
    nodeId: "node_research",
    status: "running",
    startedAt: isoNow(),
    ...overrides,
  };
}
