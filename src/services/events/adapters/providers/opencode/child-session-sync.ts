import type { BusEvent } from "@/services/events/bus-events/index.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type { CodingAgentClient } from "@/services/agents/types.ts";
import type { OpenCodeTaskToolMetadata } from "@/services/events/adapters/providers/opencode/tool-state.ts";

const TASK_CHILD_SESSION_SYNC_POLL_MS = 500;
const TASK_CHILD_SESSION_FINAL_POLL_MS = 200;
const TASK_CHILD_SESSION_FINAL_STABLE_POLLS = 2;

type SessionMessages = Awaited<ReturnType<NonNullable<CodingAgentClient["getSessionMessagesWithParts"]>>>;

type OpenCodeChildSessionSyncState = {
  childSessionId: string;
  taskCorrelationId: string;
  runId: number;
  taskCompleted: boolean;
  stablePollsAfterCompletion: number;
  lastSnapshotSignature: string;
  pollHandle: ReturnType<typeof setTimeout> | null;
};

type OpenCodeChildSessionSyncDependencies = {
  bus: EventBus;
  sessionId: string;
  getClient: () => CodingAgentClient | undefined;
  taskToolMetadata: Map<string, OpenCodeTaskToolMetadata>;
  toolUseIdToSubagentId: Map<string, string>;
  toolStartSignatureByToolId: Map<string, string>;
  completedToolIds: Set<string>;
  resolveToolCorrelationId: (correlationId: string | undefined) => string | undefined;
  normalizeToolName: (value: unknown) => string;
  asRecord: (value: unknown) => Record<string, unknown> | undefined;
  asString: (value: unknown) => string | undefined;
  buildToolStartSignature: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolMetadata: Record<string, unknown> | undefined,
    parentAgentId: string | undefined,
  ) => string;
  registerToolCorrelationAliases: (
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  recordActiveSubagentToolContext: (
    toolId: string,
    toolName: string,
    parentAgentId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  removeActiveSubagentToolContext: (
    toolId: string,
    ...correlationIds: Array<string | undefined>
  ) => void;
  registerTaskSubagentSessionCorrelation: (
    taskCorrelationId: string,
    subagentSessionId: string | undefined,
  ) => void;
};

export class OpenCodeChildSessionSync {
  private hydratedChildSessions = new Set<string>();
  private syncStates = new Map<string, OpenCodeChildSessionSyncState>();

  constructor(private readonly deps: OpenCodeChildSessionSyncDependencies) {}

  reset(): void {
    for (const childSessionId of this.syncStates.keys()) {
      this.stopSync(childSessionId);
    }
    this.hydratedChildSessions.clear();
  }

  maybeHydrateTaskChildSession(
    runId: number,
    taskCorrelationId: string,
    childSessionId: string | undefined,
  ): void {
    if (!childSessionId) {
      return;
    }
    this.ensureTaskChildSessionSync(runId, taskCorrelationId, childSessionId);
  }

  async hydrateCompletedTaskDispatch(
    runId: number,
    parentSessionId: string,
    taskCorrelationId: string,
    toolId: string,
    attributedParentAgentId: string | undefined,
  ): Promise<void> {
    const childSessionId = await this.resolveCompletedTaskChildSessionId(
      parentSessionId,
      taskCorrelationId,
      toolId,
    );
    if (!childSessionId) {
      return;
    }

    const existingTaskMetadata = this.deps.taskToolMetadata.get(taskCorrelationId);
    this.deps.taskToolMetadata.set(taskCorrelationId, {
      description: existingTaskMetadata?.description ?? "",
      isBackground: existingTaskMetadata?.isBackground ?? false,
      agentType: existingTaskMetadata?.agentType,
      subagentSessionId: childSessionId,
    });
    this.deps.registerTaskSubagentSessionCorrelation(taskCorrelationId, childSessionId);

    const parentAgentId = this.deps.toolUseIdToSubagentId.get(taskCorrelationId)
      ?? attributedParentAgentId
      ?? taskCorrelationId;
    this.ensureTaskChildSessionSync(runId, taskCorrelationId, childSessionId);
    await this.pollTaskChildSession(childSessionId, parentAgentId);
    this.markTaskChildSessionSyncComplete(childSessionId);
  }

  private async resolveCompletedTaskChildSessionId(
    parentSessionId: string,
    taskCorrelationId: string,
    toolId: string,
  ): Promise<string | undefined> {
    const knownTaskMetadata = this.deps.taskToolMetadata.get(taskCorrelationId);
    if (knownTaskMetadata?.subagentSessionId) {
      return knownTaskMetadata.subagentSessionId;
    }

    const messageFetcher = this.deps.getClient();
    if (!messageFetcher?.getSessionMessagesWithParts) {
      return undefined;
    }

    try {
      const parentMessages = await messageFetcher.getSessionMessagesWithParts(parentSessionId);
      for (let messageIndex = parentMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = parentMessages[messageIndex];
        if (!message) {
          continue;
        }
        for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
          const rawPart = message.parts[partIndex];
          if (!rawPart || this.deps.asString(rawPart.type)?.toLowerCase() !== "tool") {
            continue;
          }

          const toolName = this.deps.normalizeToolName(this.deps.asString(rawPart.tool));
          if (toolName.toLowerCase() !== "task") {
            continue;
          }

          const partId = this.deps.asString(rawPart.id);
          const callId = this.deps.asString(rawPart.callID);
          const correlationId = this.deps.resolveToolCorrelationId(partId ?? callId) ?? partId ?? callId;
          if (
            correlationId !== taskCorrelationId
            && correlationId !== toolId
            && partId !== toolId
            && callId !== toolId
          ) {
            continue;
          }

          const toolState = this.deps.asRecord(rawPart.state);
          const toolMetadata = this.deps.asRecord(toolState?.metadata);
          const childSessionId = this.deps.asString(toolMetadata?.sessionId)
            ?? this.deps.asString(toolMetadata?.sessionID);
          if (childSessionId) {
            return childSessionId;
          }
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private ensureTaskChildSessionSync(
    runId: number,
    taskCorrelationId: string,
    childSessionId: string,
  ): void {
    const existing = this.syncStates.get(childSessionId);
    if (existing) {
      existing.runId = runId;
      existing.taskCorrelationId = taskCorrelationId;
      if (existing.pollHandle === null) {
        this.scheduleTaskChildSessionSyncPoll(childSessionId, 0);
      }
      return;
    }

    this.syncStates.set(childSessionId, {
      childSessionId,
      taskCorrelationId,
      runId,
      taskCompleted: false,
      stablePollsAfterCompletion: 0,
      lastSnapshotSignature: "",
      pollHandle: null,
    });
    this.scheduleTaskChildSessionSyncPoll(childSessionId, 0);
  }

  private markTaskChildSessionSyncComplete(childSessionId: string): void {
    const state = this.syncStates.get(childSessionId);
    if (!state) {
      return;
    }
    state.taskCompleted = true;
    state.stablePollsAfterCompletion = 0;
    this.scheduleTaskChildSessionSyncPoll(childSessionId, 0);
  }

  private scheduleTaskChildSessionSyncPoll(childSessionId: string, delayMs: number): void {
    const state = this.syncStates.get(childSessionId);
    if (!state || state.pollHandle !== null) {
      return;
    }

    state.pollHandle = setTimeout(() => {
      const current = this.syncStates.get(childSessionId);
      if (!current) {
        return;
      }
      current.pollHandle = null;
      void this.pollTaskChildSession(childSessionId);
    }, delayMs);
  }

  private stopSync(childSessionId: string): void {
    const state = this.syncStates.get(childSessionId);
    if (!state) {
      return;
    }
    if (state.pollHandle !== null) {
      clearTimeout(state.pollHandle);
    }
    this.syncStates.delete(childSessionId);
  }

  private buildTaskChildSessionSnapshotSignature(messages: SessionMessages): string {
    const parts: string[] = [];
    for (const message of messages) {
      const messageId = this.deps.asString(message.info.id) ?? "message";
      for (let index = 0; index < message.parts.length; index += 1) {
        const rawPart = message.parts[index];
        if (!rawPart) {
          continue;
        }
        const partType = this.deps.asString(rawPart.type)?.toLowerCase();
        if (partType !== "tool") {
          continue;
        }
        const toolState = this.deps.asRecord(rawPart.state);
        const toolName = this.deps.normalizeToolName(this.deps.asString(rawPart.tool));
        const status = this.deps.asString(toolState?.status)?.toLowerCase() ?? "unknown";
        const partId = this.deps.asString(rawPart.id) ?? `${messageId}:${index}:${toolName}`;
        parts.push(`${partId}:${status}`);
      }
    }
    return parts.join("|");
  }

  private async pollTaskChildSession(
    childSessionId: string,
    explicitParentAgentId?: string,
  ): Promise<void> {
    const state = this.syncStates.get(childSessionId);
    if (!state) {
      return;
    }

    const messageFetcher = this.deps.getClient();
    if (!messageFetcher?.getSessionMessagesWithParts) {
      this.stopSync(childSessionId);
      return;
    }

    try {
      const messages = await messageFetcher.getSessionMessagesWithParts(childSessionId);
      const snapshotSignature = this.buildTaskChildSessionSnapshotSignature(messages);
      if (messages.length > 0) {
        this.hydratedChildSessions.add(childSessionId);
      }
      this.publishTaskChildSessionTools(state.runId, state, messages, explicitParentAgentId);

      if (state.taskCompleted) {
        state.stablePollsAfterCompletion = snapshotSignature === state.lastSnapshotSignature
          ? state.stablePollsAfterCompletion + 1
          : 0;
      }
      state.lastSnapshotSignature = snapshotSignature;

      if (state.taskCompleted && state.stablePollsAfterCompletion >= TASK_CHILD_SESSION_FINAL_STABLE_POLLS) {
        this.stopSync(childSessionId);
        return;
      }
    } catch {
      if (state.taskCompleted) {
        state.stablePollsAfterCompletion += 1;
        if (state.stablePollsAfterCompletion >= TASK_CHILD_SESSION_FINAL_STABLE_POLLS) {
          this.stopSync(childSessionId);
          return;
        }
      }
    }

    this.scheduleTaskChildSessionSyncPoll(
      childSessionId,
      state.taskCompleted ? TASK_CHILD_SESSION_FINAL_POLL_MS : TASK_CHILD_SESSION_SYNC_POLL_MS,
    );
  }

  private buildHydratedChildToolId(
    childSessionId: string,
    messageId: string | undefined,
    toolName: string,
    partId: string | undefined,
    callId: string | undefined,
    partIndex: number,
  ): string {
    const explicitId = this.deps.resolveToolCorrelationId(partId ?? callId) ?? partId ?? callId;
    if (explicitId) {
      return explicitId;
    }
    return `${childSessionId}:${messageId ?? "message"}:${toolName}:${partIndex}`;
  }

  private publishTaskChildSessionTools(
    runId: number,
    state: OpenCodeChildSessionSyncState,
    messages: SessionMessages,
    explicitParentAgentId?: string,
  ): void {
    const parentAgentId = explicitParentAgentId
      ?? this.deps.toolUseIdToSubagentId.get(state.taskCorrelationId)
      ?? state.taskCorrelationId;

    for (const message of messages) {
      const messageId = this.deps.asString(message.info.id);
      for (let partIndex = 0; partIndex < message.parts.length; partIndex += 1) {
        const rawPart = message.parts[partIndex];
        if (!rawPart) {
          continue;
        }
        const partType = this.deps.asString(rawPart.type)?.toLowerCase();
        if (partType !== "tool") {
          continue;
        }

        const toolName = this.deps.normalizeToolName(this.deps.asString(rawPart.tool));
        const partId = this.deps.asString(rawPart.id);
        const callId = this.deps.asString(rawPart.callID);
        const toolState = this.deps.asRecord(rawPart.state);
        const toolMetadata = this.deps.asRecord(toolState?.metadata);
        const toolInput = this.deps.asRecord(toolState?.input) ?? {};
        const toolId = this.buildHydratedChildToolId(
          state.childSessionId,
          messageId,
          toolName,
          partId,
          callId,
          partIndex,
        );
        const sdkCorrelationId = this.deps.resolveToolCorrelationId(partId ?? callId) ?? partId ?? callId ?? toolId;
        const status = this.deps.asString(toolState?.status)?.toLowerCase();
        const startSignature = this.deps.buildToolStartSignature(
          toolName,
          toolInput,
          toolMetadata,
          parentAgentId,
        );

        this.deps.registerToolCorrelationAliases(toolId, partId, callId);

        if (
          this.deps.toolStartSignatureByToolId.get(toolId) !== startSignature
          && !this.deps.completedToolIds.has(toolId)
        ) {
          this.deps.toolStartSignatureByToolId.set(toolId, startSignature);
          this.deps.recordActiveSubagentToolContext(
            toolId,
            toolName,
            parentAgentId,
            partId,
            callId,
            state.taskCorrelationId,
          );
          const startEvent: BusEvent<"stream.tool.start"> = {
            type: "stream.tool.start",
            sessionId: this.deps.sessionId,
            runId,
            timestamp: Date.now(),
            data: {
              toolId,
              toolName,
              toolInput,
              sdkCorrelationId,
              ...(toolMetadata ? { toolMetadata } : {}),
              parentAgentId,
            },
          };
          this.deps.bus.publish(startEvent);
        }

        if (status !== "completed" && status !== "error") {
          continue;
        }
        if (this.deps.completedToolIds.has(toolId)) {
          continue;
        }

        this.deps.toolStartSignatureByToolId.delete(toolId);
        this.deps.completedToolIds.add(toolId);
        this.deps.removeActiveSubagentToolContext(toolId, partId, callId);
        const completeEvent: BusEvent<"stream.tool.complete"> = {
          type: "stream.tool.complete",
          sessionId: this.deps.sessionId,
          runId,
          timestamp: Date.now(),
          data: {
            toolId,
            toolName,
            toolInput,
            toolResult: status === "completed"
              ? toolState?.output
              : (toolState?.error ?? "Tool execution failed"),
            success: status === "completed",
            ...(status === "error"
              ? { error: this.deps.asString(toolState?.error) ?? "Tool execution failed" }
              : {}),
            sdkCorrelationId,
            ...(toolMetadata ? { toolMetadata } : {}),
            parentAgentId,
          },
        };
        this.deps.bus.publish(completeEvent);
      }
    }
  }
}
