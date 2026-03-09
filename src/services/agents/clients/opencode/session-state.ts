const SESSION_LIFECYCLE_EVENT_TYPES = new Set<string>([
  "session.created",
  "session.updated",
  "session.status",
  "session.idle",
  "session.error",
  "session.deleted",
]);

export interface OpenCodeSubagentSessionState {
  pendingAgentParts: Array<{ partId: string; agentName: string }>;
  childSessionToAgentPart: Map<string, string>;
  startedSubagentIds: Set<string>;
  subagentToolCounts: Map<string, number>;
  pendingTaskToolPartIds: string[];
  queuedTaskToolPartIds: Set<string>;
}

type OpenCodeSessionStateSupportDependencies = {
  activeSessions: Set<string>;
  sessionStateById: Map<string, unknown>;
  sessionTitlesById: Map<string, string>;
  messageRolesBySession: Map<string, Map<string, "user" | "assistant">>;
  skillInvocationsBySession: Map<string, Set<string>>;
  subagentStateByParentSession: Map<string, OpenCodeSubagentSessionState>;
  childSessionToParentSession: Map<string, string>;
  reasoningPartIds: Set<string>;
  getCurrentSessionId: () => string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
};

export class OpenCodeSessionStateSupport {
  constructor(private readonly deps: OpenCodeSessionStateSupportDependencies) {}

  registerActiveSession(sessionId: string): void {
    if (!sessionId) return;
    this.deps.activeSessions.add(sessionId);
  }

  setSessionParentMapping(
    sessionId: string,
    parentSessionId: string | undefined,
  ): void {
    if (!sessionId) return;
    if (parentSessionId && parentSessionId !== sessionId) {
      this.deps.childSessionToParentSession.set(sessionId, parentSessionId);
      return;
    }
    this.deps.childSessionToParentSession.delete(sessionId);
  }

  unregisterActiveSession(sessionId: string): void {
    if (!sessionId) return;
    this.deps.activeSessions.delete(sessionId);
    this.deps.sessionStateById.delete(sessionId);
    this.deps.sessionTitlesById.delete(sessionId);
    this.deps.messageRolesBySession.delete(sessionId);
    this.deps.skillInvocationsBySession.delete(sessionId);
    this.clearSubagentSessionState(sessionId);
    if (this.deps.getCurrentSessionId() === sessionId) {
      this.deps.setCurrentSessionId(null);
    }
  }

  shouldProcessSseEvent(event: Record<string, unknown>): boolean {
    const eventType = event.type as string | undefined;
    if (!eventType || SESSION_LIFECYCLE_EVENT_TYPES.has(eventType)) {
      return true;
    }

    const sessionCandidates = this.extractEventSessionCandidates(event);
    if (sessionCandidates.length === 0) {
      return true;
    }

    for (const sessionId of sessionCandidates) {
      if (this.deps.activeSessions.has(sessionId)) {
        return true;
      }
      const parentSessionId = this.deps.childSessionToParentSession.get(sessionId);
      if (parentSessionId && this.deps.activeSessions.has(parentSessionId)) {
        return true;
      }
    }

    const currentSessionId = this.deps.getCurrentSessionId();
    if (currentSessionId) {
      const properties = event.properties as Record<string, unknown> | undefined;
      if (eventType === "message.part.updated") {
        const part = properties?.part as { sessionID?: unknown } | undefined;
        if (typeof part?.sessionID === "string" && part.sessionID.length > 0) {
          return true;
        }
      }
      if (eventType === "message.part.delta") {
        const deltaSessionId = properties?.sessionID;
        if (typeof deltaSessionId === "string" && deltaSessionId.length > 0) {
          return true;
        }
      }
      if (eventType === "message.updated") {
        const info = properties?.info as { sessionID?: unknown } | undefined;
        if (typeof info?.sessionID === "string" && info.sessionID.length > 0) {
          return true;
        }
      }
    }

    return false;
  }

  createSubagentSessionState(): OpenCodeSubagentSessionState {
    return {
      pendingAgentParts: [],
      childSessionToAgentPart: new Map(),
      startedSubagentIds: new Set(),
      subagentToolCounts: new Map(),
      pendingTaskToolPartIds: [],
      queuedTaskToolPartIds: new Set(),
    };
  }

  getSubagentSessionState(parentSessionId: string): OpenCodeSubagentSessionState {
    let state = this.deps.subagentStateByParentSession.get(parentSessionId);
    if (!state) {
      state = this.createSubagentSessionState();
      this.deps.subagentStateByParentSession.set(parentSessionId, state);
    }
    return state;
  }

  findParentSessionForPart(
    properties: Record<string, unknown> | undefined,
    partSessionId: string,
  ): string {
    const envelopeSessionId = (properties?.sessionID as string | undefined) ?? "";
    if (envelopeSessionId) {
      return envelopeSessionId;
    }

    const mappedParent = this.deps.childSessionToParentSession.get(partSessionId);
    if (mappedParent) {
      return mappedParent;
    }

    if (partSessionId) {
      const pendingParentCandidates: string[] = [];
      for (const [candidateSessionId, state] of this.deps.subagentStateByParentSession.entries()) {
        if (candidateSessionId === partSessionId) continue;
        if (state.pendingAgentParts.length === 0) continue;
        pendingParentCandidates.push(candidateSessionId);
        if (pendingParentCandidates.length > 1) break;
      }
      if (pendingParentCandidates.length === 1) {
        return pendingParentCandidates[0]!;
      }
    }

    if (partSessionId) {
      if (this.deps.activeSessions.has(partSessionId)) {
        return partSessionId;
      }

      const currentSessionId = this.deps.getCurrentSessionId();
      if (currentSessionId && currentSessionId !== partSessionId) {
        return currentSessionId;
      }

      return partSessionId;
    }

    return this.deps.getCurrentSessionId() ?? "";
  }

  enqueuePendingTaskToolPartId(
    state: OpenCodeSubagentSessionState,
    taskPartId: string,
  ): void {
    if (state.queuedTaskToolPartIds.has(taskPartId)) return;
    state.pendingTaskToolPartIds.push(taskPartId);
    state.queuedTaskToolPartIds.add(taskPartId);
  }

  dequeuePendingTaskToolPartId(
    state: OpenCodeSubagentSessionState,
  ): string | undefined {
    const taskPartId = state.pendingTaskToolPartIds.shift();
    if (taskPartId) {
      state.queuedTaskToolPartIds.delete(taskPartId);
    }
    return taskPartId;
  }

  removePendingTaskToolPartId(
    state: OpenCodeSubagentSessionState,
    taskPartId: string,
  ): void {
    const idx = state.pendingTaskToolPartIds.indexOf(taskPartId);
    if (idx !== -1) {
      state.pendingTaskToolPartIds.splice(idx, 1);
    }
    state.queuedTaskToolPartIds.delete(taskPartId);
  }

  setMessageRole(
    sessionId: string,
    messageId: string,
    role: "user" | "assistant",
  ): void {
    if (!sessionId || !messageId) return;
    let roles = this.deps.messageRolesBySession.get(sessionId);
    if (!roles) {
      roles = new Map<string, "user" | "assistant">();
      this.deps.messageRolesBySession.set(sessionId, roles);
    }
    roles.set(messageId, role);
  }

  getMessageRole(
    sessionId: string,
    messageId: string,
  ): "user" | "assistant" | undefined {
    if (!sessionId || !messageId) return undefined;
    return this.deps.messageRolesBySession.get(sessionId)?.get(messageId);
  }

  deleteMessageRole(sessionId: string, messageId: string): void {
    if (!sessionId || !messageId) return;
    const roles = this.deps.messageRolesBySession.get(sessionId);
    if (!roles) return;
    roles.delete(messageId);
    if (roles.size === 0) {
      this.deps.messageRolesBySession.delete(sessionId);
    }
  }

  clearPartTracking(sessionId: string, messageId: string, partId?: string): void {
    if (!sessionId || !messageId) return;
    if (partId) {
      this.deps.reasoningPartIds.delete(partId);
      for (const state of this.deps.subagentStateByParentSession.values()) {
        state.pendingAgentParts = state.pendingAgentParts.filter((pending) => pending.partId !== partId);
        state.startedSubagentIds.delete(partId);
        state.subagentToolCounts.delete(partId);
        state.pendingTaskToolPartIds = state.pendingTaskToolPartIds.filter((id) => id !== partId);
        state.queuedTaskToolPartIds.delete(partId);
        for (const [childSessionId, agentPartId] of state.childSessionToAgentPart.entries()) {
          if (agentPartId === partId) {
            state.childSessionToAgentPart.delete(childSessionId);
            this.deps.childSessionToParentSession.delete(childSessionId);
          }
        }
      }
    }
    this.deleteMessageRole(sessionId, messageId);
  }

  mapOpenCodePermissionReply(answer: string | string[]): "once" | "always" | "reject" {
    const selected = Array.isArray(answer) ? answer[0] ?? "" : answer;
    const normalized = selected.trim().toLowerCase();
    if (normalized === "always" || normalized === "allow-always") {
      return "always";
    }
    if (normalized === "reject" || normalized === "deny" || normalized === "no") {
      return "reject";
    }
    return "once";
  }

  shouldEmitSkillInvocation(
    sessionId: string,
    dedupeKey: string,
  ): boolean {
    let seen = this.deps.skillInvocationsBySession.get(sessionId);
    if (!seen) {
      seen = new Set<string>();
      this.deps.skillInvocationsBySession.set(sessionId, seen);
    }
    if (seen.has(dedupeKey)) {
      return false;
    }
    seen.add(dedupeKey);
    return true;
  }

  private extractEventSessionCandidates(event: Record<string, unknown>): string[] {
    const properties = event.properties as Record<string, unknown> | undefined;
    const info = properties?.info as { id?: string; sessionID?: string } | undefined;
    const part = properties?.part as { sessionID?: string } | undefined;
    const candidates = [
      properties?.sessionID,
      info?.id,
      info?.sessionID,
      part?.sessionID,
    ];
    return Array.from(
      new Set(
        candidates
          .filter((value): value is string => typeof value === "string")
          .filter((value) => value.length > 0),
      ),
    );
  }

  private clearSubagentSessionState(parentSessionId: string): void {
    const state = this.deps.subagentStateByParentSession.get(parentSessionId);
    if (state) {
      for (const childSessionId of state.childSessionToAgentPart.keys()) {
        this.deps.childSessionToParentSession.delete(childSessionId);
      }
      this.deps.subagentStateByParentSession.delete(parentSessionId);
    }

    const ownerParent = this.deps.childSessionToParentSession.get(parentSessionId);
    if (!ownerParent) return;

    const ownerState = this.deps.subagentStateByParentSession.get(ownerParent);
    if (ownerState) {
      const agentPartId = ownerState.childSessionToAgentPart.get(parentSessionId);
      ownerState.childSessionToAgentPart.delete(parentSessionId);
      if (agentPartId) {
        ownerState.startedSubagentIds.delete(agentPartId);
        ownerState.subagentToolCounts.delete(agentPartId);
      }
    }
    this.deps.childSessionToParentSession.delete(parentSessionId);
  }
}
