import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import type { AgentType } from "@/services/models/index.ts";
import { isSubagentToolName } from "@/state/parts/index.ts";

const DEFAULT_SUBAGENT_TASK_LABEL = "sub-agent task";
const SYNTHETIC_TASK_AGENT_PREFIX = "synthetic-task-agent:";

export const CLAUDE_SYNTHETIC_FOREGROUND_AGENT_PREFIX = "agent-only-";

export function isGenericSubagentTaskLabel(task: string | undefined): boolean {
  const normalized = (task ?? "").trim().toLowerCase();
  return normalized === "" || normalized === DEFAULT_SUBAGENT_TASK_LABEL || normalized === "subagent task";
}

export function isClaudeSyntheticForegroundAgentId(agentId: string | undefined): boolean {
  return typeof agentId === "string" && agentId.startsWith(CLAUDE_SYNTHETIC_FOREGROUND_AGENT_PREFIX);
}

export function resolveIncomingSubagentTaskLabel(
  task: string | undefined,
  agentType: string | undefined,
): string {
  const normalizedTask = task?.trim();
  if (normalizedTask) return normalizedTask;
  const normalizedAgentType = agentType?.trim();
  if (normalizedAgentType) return normalizedAgentType;
  return DEFAULT_SUBAGENT_TASK_LABEL;
}

export function mergeAgentTaskLabel(
  existingTask: string | undefined,
  incomingTask: string | undefined,
  agentType: string | undefined,
): string {
  const explicitIncomingTask = asNonEmptyString(incomingTask);
  const normalizedAgentType = asNonEmptyString(agentType);
  const normalizedExistingTask = asNonEmptyString(existingTask);
  if (
    explicitIncomingTask
    && !isGenericSubagentTaskLabel(explicitIncomingTask)
    && (
      isGenericSubagentTaskLabel(existingTask)
      || (
        normalizedExistingTask !== undefined
        && normalizedAgentType !== undefined
        && normalizedExistingTask === normalizedAgentType
      )
    )
  ) {
    return explicitIncomingTask;
  }
  const nextTask = resolveIncomingSubagentTaskLabel(incomingTask, agentType);
  if (isGenericSubagentTaskLabel(existingTask)) return nextTask;
  return isGenericSubagentTaskLabel(nextTask) ? (normalizedExistingTask ?? nextTask) : (normalizedExistingTask ?? nextTask);
}

export function resolveSubagentStartCorrelationId(data: {
  sdkCorrelationId?: string;
  toolCallId?: string;
}): string | undefined {
  return data.sdkCorrelationId ?? data.toolCallId;
}

export function isBootstrapAgentCurrentToolLabel(
  currentTool: string | undefined,
  agentName: string | undefined,
): boolean {
  if (!currentTool) return false;
  const normalizedCurrentTool = currentTool.trim().toLowerCase();
  if (!normalizedCurrentTool.startsWith("running ") || !normalizedCurrentTool.endsWith("...")) {
    return false;
  }

  const normalizedAgentName = agentName?.trim().toLowerCase();
  if (!normalizedAgentName) {
    return true;
  }
  return normalizedCurrentTool === `running ${normalizedAgentName}...`;
}

export function resolveAgentCurrentToolForUpdate(args: {
  incomingCurrentTool?: string;
  existingCurrentTool?: string;
  agentName?: string;
}): string | undefined {
  if (args.incomingCurrentTool !== undefined) {
    return args.incomingCurrentTool;
  }
  if (isBootstrapAgentCurrentToolLabel(args.existingCurrentTool, args.agentName)) {
    return undefined;
  }
  return args.existingCurrentTool;
}

export function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseSyntheticTaskAgentType(input: Record<string, unknown>): string | undefined {
  return asNonEmptyString(
    input.subagent_type
    ?? input.subagentType
    ?? input.agent_type
    ?? input.agentType
    ?? input.agent
    ?? input.type,
  );
}

function parseSyntheticTaskAgentName(input: Record<string, unknown>): string {
  return parseSyntheticTaskAgentType(input) ?? "agent";
}

function parseSyntheticTaskLabel(input: Record<string, unknown>): string {
  const description = asNonEmptyString(
    input.description
    ?? input.task
    ?? input.title,
  );
  return resolveIncomingSubagentTaskLabel(description, parseSyntheticTaskAgentType(input));
}

function parseSyntheticBackgroundFlag(input: Record<string, unknown>): boolean {
  const mode = asNonEmptyString(input.mode)?.toLowerCase();
  return input.run_in_background === true || mode === "background";
}

function hasSyntheticTaskExecutionDetails(input: Record<string, unknown>): boolean {
  return Boolean(
    asNonEmptyString(input.description)
    || asNonEmptyString(input.prompt)
    || asNonEmptyString(input.task)
    || asNonEmptyString(input.title),
  );
}

function buildSyntheticTaskAgentId(toolId: string): string {
  return `${SYNTHETIC_TASK_AGENT_PREFIX}${toolId}`;
}

function buildTaskDispatchPlaceholderId(
  provider: AgentType | undefined,
  toolId: string,
): string {
  return provider === "opencode" ? toolId : buildSyntheticTaskAgentId(toolId);
}

export function isSyntheticTaskAgentId(agentId: string): boolean {
  return agentId.startsWith(SYNTHETIC_TASK_AGENT_PREFIX);
}

function isAbortLikeToolError(error: string | undefined): boolean {
  const normalized = error?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  return normalized.includes("abort")
    || normalized.includes("cancel")
    || normalized.includes("interrupt");
}

export function upsertSyntheticTaskAgentForToolStart(args: {
  agents: ParallelAgent[];
  provider: AgentType | undefined;
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
  startedAt: string;
  agentId?: string;
}): ParallelAgent[] {
  if (args.provider !== "opencode") return args.agents;
  if (args.agentId) return args.agents;
  if (!isSubagentToolName(args.toolName)) return args.agents;

  const placeholderId = buildTaskDispatchPlaceholderId(args.provider, args.toolId);

  const existingRealAgent = args.agents.find(
    (agent) => agent.taskToolCallId === args.toolId && agent.id !== placeholderId,
  );
  if (existingRealAgent) {
    return args.agents;
  }

  const agentName = parseSyntheticTaskAgentName(args.input);
  const task = parseSyntheticTaskLabel(args.input);
  const background = parseSyntheticBackgroundFlag(args.input);
  const hasExecutionDetails = hasSyntheticTaskExecutionDetails(args.input);
  if (!hasExecutionDetails) {
    const hasExistingSynthetic = args.agents.some(
      (agent) =>
        agent.id === placeholderId
        || (isSyntheticTaskAgentId(agent.id) && agent.taskToolCallId === args.toolId),
    );
    if (!hasExistingSynthetic) {
      return args.agents;
    }
  }

  const nextStatus: ParallelAgent["status"] = background
    ? "background"
    : (hasExecutionDetails ? "running" : "pending");
  const nextToolUses = 0;
  const nextCurrentTool = undefined;
  const existingSyntheticIndex = args.agents.findIndex(
    (agent) =>
      agent.id === placeholderId
      || (isSyntheticTaskAgentId(agent.id) && agent.taskToolCallId === args.toolId),
  );

  if (existingSyntheticIndex >= 0) {
    return args.agents.map((agent, index) =>
      index === existingSyntheticIndex
        ? {
          ...agent,
          id: placeholderId,
          taskToolCallId: args.toolId,
          name: agentName,
          task: mergeAgentTaskLabel(agent.task, task, agentName),
          status: nextStatus,
          background,
          startedAt: agent.startedAt || args.startedAt,
          toolUses: Math.max(agent.toolUses ?? 0, nextToolUses),
          currentTool: nextCurrentTool ?? agent.currentTool,
          error: undefined,
        }
        : agent,
    );
  }

  return [
    ...args.agents,
    {
      id: placeholderId,
      taskToolCallId: args.toolId,
      name: agentName,
      task,
      status: nextStatus,
      startedAt: args.startedAt,
      background,
      currentTool: nextCurrentTool,
      toolUses: nextToolUses,
    },
  ];
}

export function finalizeSyntheticTaskAgentForToolComplete(args: {
  agents: ParallelAgent[];
  provider: AgentType | undefined;
  toolName: string;
  toolId: string;
  success: boolean;
  output: unknown;
  error?: string;
  completedAtMs: number;
  agentId?: string;
}): ParallelAgent[] {
  if (args.provider !== "opencode") return args.agents;
  if (args.agentId) return args.agents;
  if (!isSubagentToolName(args.toolName)) return args.agents;

  const placeholderId = buildTaskDispatchPlaceholderId(args.provider, args.toolId);
  const syntheticIndex = args.agents.findIndex((agent) => agent.id === placeholderId);
  if (syntheticIndex < 0) {
    return args.agents;
  }

  return args.agents.map((agent, index) => {
    if (index !== syntheticIndex) return agent;
    const startedAtMs = new Date(agent.startedAt).getTime();
    const durationMs = Number.isFinite(startedAtMs)
      ? Math.max(0, args.completedAtMs - startedAtMs)
      : agent.durationMs;
    const status: ParallelAgent["status"] = args.success
      ? "completed"
      : (isAbortLikeToolError(args.error) ? "interrupted" : "error");
    return {
      ...agent,
      status,
      currentTool: agent.currentTool,
      result: args.success
        ? (typeof args.output === "string" ? (asNonEmptyString(args.output) ?? agent.result) : agent.result)
        : agent.result,
      error: args.success ? undefined : (args.error ?? agent.error),
      durationMs,
    };
  });
}

export function finalizeCorrelatedSubagentDispatchForToolComplete(args: {
  agents: ParallelAgent[];
  toolName: string;
  toolId: string;
  success: boolean;
  error?: string;
  completedAtMs: number;
  agentId?: string;
}): ParallelAgent[] {
  if (args.agentId) return args.agents;
  if (!isSubagentToolName(args.toolName)) return args.agents;
  const status: ParallelAgent["status"] = args.success
    ? "completed"
    : (isAbortLikeToolError(args.error) ? "interrupted" : "error");
  let changed = false;

  const nextAgents = args.agents.map((agent) => {
    if (agent.taskToolCallId !== args.toolId) return agent;
    if (agent.status === "completed" || agent.status === "error" || agent.status === "interrupted") {
      return agent;
    }

    const startedAtMs = new Date(agent.startedAt).getTime();
    const durationMs = Number.isFinite(startedAtMs)
      ? Math.max(0, args.completedAtMs - startedAtMs)
      : agent.durationMs;
    changed = true;
    return {
      ...agent,
      status,
      currentTool: undefined,
      error: status === "error" ? (args.error ?? agent.error) : undefined,
      durationMs,
    };
  });

  return changed ? nextAgents : args.agents;
}
