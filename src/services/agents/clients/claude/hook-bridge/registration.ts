import type {
    HookCallback,
    HookInput,
    HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import {
    extractSkillInvocationFromToolInput,
    isSkillToolName,
} from "@/services/agents/clients/skill-invocation.ts";
import type {
    AgentEvent,
    EventHandler,
    EventType,
} from "@/services/agents/types.ts";
import type { ClaudeSessionState } from "@/services/agents/clients/claude/internal-types.ts";
import {
    mapEventTypeToHookEvent,
} from "@/services/agents/clients/claude/internal-types.ts";
import {
    resolveClaudeFallbackHookSessionId,
    resolveClaudeHookParentToolUseId,
    resolveClaudeHookSessionId,
    resolveClaudeHookToolUseId,
} from "@/services/agents/clients/claude/hook-bridge/session-resolution.ts";
import {
    resolveClaudeSubagentParentId,
    shouldPreferRecordedSubagentTask,
} from "@/services/agents/clients/claude/hook-bridge/subagent-resolution.ts";

export function registerClaudeHookHandler<T extends EventType>(args: {
    eventType: T;
    handler: EventHandler<T>;
    eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
    registeredHooks: Record<string, HookCallback[]>;
    sessions: Map<string, ClaudeSessionState>;
    pendingHookSessionBindings: string[];
    toolUseIdToAgentId: Map<string, string>;
    toolUseIdToSessionId: Map<string, string>;
    taskDescriptionByToolUseId: Map<string, string>;
    subagentSdkSessionIdToAgentId: Map<string, string>;
    unmappedSubagentIds: string[];
}): () => void {
    let handlers = args.eventHandlers.get(args.eventType);
    if (!handlers) {
        handlers = new Set();
        args.eventHandlers.set(args.eventType, handlers);
    }

    handlers.add(args.handler as EventHandler<EventType>);
    const addedHooks: Array<{ event: string; callback: HookCallback }> = [];
    const hookEvent = mapEventTypeToHookEvent(args.eventType);

    if (hookEvent) {
        const createHookCallback = (targetHookEvent: string): HookCallback => {
            return async (
                input: HookInput,
                toolUseID: string | undefined,
                _options: { signal: AbortSignal },
            ): Promise<HookJSONOutput> => {
                const hookInput = input as Record<string, unknown>;
                const resolvedToolUseId = resolveClaudeHookToolUseId(
                    toolUseID,
                    hookInput,
                );
                const resolvedParentToolUseId =
                    resolveClaudeHookParentToolUseId(hookInput);
                const eventData: Record<string, unknown> = {
                    hookInput: input,
                    toolUseID: resolvedToolUseId,
                };

                if (hookInput.tool_name) {
                    eventData.toolName = hookInput.tool_name;
                }
                if (hookInput.tool_input !== undefined) {
                    eventData.toolInput = hookInput.tool_input;
                }
                if (hookInput.tool_response !== undefined) {
                    eventData.toolResult = hookInput.tool_response;
                }
                eventData.success = targetHookEvent !== "PostToolUseFailure";
                if (hookInput.error) {
                    eventData.error = hookInput.error;
                }

                if (hookInput.agent_id) {
                    eventData.subagentId = hookInput.agent_id;
                }
                if (hookInput.agent_type) {
                    eventData.subagentType = hookInput.agent_type;
                }
                if (resolvedParentToolUseId) {
                    eventData.parentToolUseId = resolvedParentToolUseId;
                }

                const taskFromHook =
                    typeof hookInput.description === "string"
                        ? hookInput.description.trim()
                        : typeof hookInput.prompt === "string"
                          ? hookInput.prompt.trim()
                          : typeof hookInput.task === "string"
                            ? hookInput.task.trim()
                            : undefined;
                if (targetHookEvent === "SubagentStart") {
                    const agentTypeFromHook =
                        typeof hookInput.agent_type === "string"
                            ? hookInput.agent_type.trim()
                            : undefined;
                    const taskFromStartedMessage = resolvedToolUseId
                        ? args.taskDescriptionByToolUseId.get(resolvedToolUseId)
                        : undefined;
                    const taskFromParentToolUse = resolvedParentToolUseId
                        ? args.taskDescriptionByToolUseId.get(resolvedParentToolUseId)
                        : undefined;
                    const taskFromRecordedMetadata =
                        taskFromStartedMessage ?? taskFromParentToolUse;
                    const resolvedTask =
                        taskFromRecordedMetadata &&
                        shouldPreferRecordedSubagentTask({
                            taskFromHook,
                            agentType: agentTypeFromHook,
                        })
                            ? taskFromRecordedMetadata
                            : taskFromHook && taskFromHook.length > 0
                              ? taskFromHook
                              : taskFromRecordedMetadata;
                    if (resolvedTask) {
                        eventData.task = resolvedTask;
                    }
                }

                if (targetHookEvent === "SubagentStop") {
                    eventData.success = true;
                    const mappedAgentId = resolvedToolUseId
                        ? args.toolUseIdToAgentId.get(resolvedToolUseId)
                        : undefined;
                    if (!eventData.subagentId && mappedAgentId) {
                        eventData.subagentId = mappedAgentId;
                    }
                }

                if (
                    targetHookEvent === "SubagentStart" &&
                    hookInput.agent_id
                ) {
                    const startedAgentId = hookInput.agent_id as string;
                    if (resolvedToolUseId) {
                        args.toolUseIdToAgentId.set(
                            resolvedToolUseId,
                            startedAgentId,
                        );
                        if (
                            resolvedParentToolUseId &&
                            resolvedParentToolUseId !== resolvedToolUseId
                        ) {
                            args.toolUseIdToAgentId.set(
                                resolvedParentToolUseId,
                                startedAgentId,
                            );
                        }
                    }

                    const isAlreadySessionMapped = Array.from(
                        args.subagentSdkSessionIdToAgentId.values(),
                    ).includes(startedAgentId);
                    if (
                        !isAlreadySessionMapped &&
                        !args.unmappedSubagentIds.includes(startedAgentId)
                    ) {
                        args.unmappedSubagentIds.push(startedAgentId);
                    }
                }

                const hookSessionId =
                    typeof input.session_id === "string"
                        ? input.session_id
                        : "";
                const sessionId = hookSessionId
                    ? resolveClaudeHookSessionId({
                          sdkSessionId: hookSessionId,
                          sessions: args.sessions,
                          pendingHookSessionBindings: args.pendingHookSessionBindings,
                      })
                    : resolveClaudeFallbackHookSessionId({
                          toolUseId: resolvedToolUseId,
                          toolUseIdToSessionId: args.toolUseIdToSessionId,
                          sessions: args.sessions,
                      });
                if (hookSessionId) {
                    eventData.nativeSessionId = hookSessionId;
                }

                if (args.eventType === "skill.invoked") {
                    if (!isSkillToolName(hookInput.tool_name)) {
                        return { continue: true };
                    }

                    const skillInvocation =
                        extractSkillInvocationFromToolInput(
                            hookInput.tool_input,
                        );
                    if (!skillInvocation) {
                        return { continue: true };
                    }

                    const skillEvent: AgentEvent<T> = {
                        type: args.eventType,
                        sessionId,
                        timestamp: new Date().toISOString(),
                        data: {
                            ...skillInvocation,
                            ...(resolvedParentToolUseId
                                ? {
                                      parentToolCallId: resolvedParentToolUseId,
                                  }
                                : {}),
                        } as AgentEvent<T>["data"],
                    };

                    try {
                        await args.handler(skillEvent);
                    } catch (error) {
                        console.error(
                            `Error in hook handler for ${args.eventType}:`,
                            error,
                        );
                    }

                    return { continue: true };
                }

                if (
                    targetHookEvent === "SubagentStart" &&
                    resolvedToolUseId &&
                    sessionId
                ) {
                    args.toolUseIdToSessionId.set(
                        resolvedToolUseId,
                        sessionId,
                    );
                }

                if (targetHookEvent === "SubagentStop") {
                    if (resolvedToolUseId) {
                        args.toolUseIdToAgentId.delete(resolvedToolUseId);
                        args.toolUseIdToSessionId.delete(resolvedToolUseId);
                        args.taskDescriptionByToolUseId.delete(resolvedToolUseId);
                        if (resolvedParentToolUseId) {
                            args.toolUseIdToAgentId.delete(resolvedParentToolUseId);
                            args.toolUseIdToSessionId.delete(resolvedParentToolUseId);
                            args.taskDescriptionByToolUseId.delete(resolvedParentToolUseId);
                        }
                    }

                    const stoppedAgentId = (eventData.subagentId ??
                        hookInput.agent_id) as string | undefined;
                    if (stoppedAgentId) {
                        const index = args.unmappedSubagentIds.indexOf(stoppedAgentId);
                        if (index >= 0) {
                            args.unmappedSubagentIds.splice(index, 1);
                        }
                        for (const [sid, aid] of args.subagentSdkSessionIdToAgentId) {
                            if (aid === stoppedAgentId) {
                                args.subagentSdkSessionIdToAgentId.delete(sid);
                                break;
                            }
                        }
                    }
                }

                const mappedParentAgentId =
                    (resolvedParentToolUseId
                        ? args.toolUseIdToAgentId.get(resolvedParentToolUseId)
                        : undefined) ??
                    (resolvedToolUseId
                        ? args.toolUseIdToAgentId.get(resolvedToolUseId)
                        : undefined);
                if (mappedParentAgentId) {
                    eventData.parentAgentId = mappedParentAgentId;
                }
                if (
                    !eventData.parentAgentId &&
                    targetHookEvent !== "SubagentStart" &&
                    targetHookEvent !== "SubagentStop" &&
                    hookSessionId &&
                    sessionId
                ) {
                    const parentAgentId = resolveClaudeSubagentParentId({
                        hookSdkSessionId: hookSessionId,
                        wrappedSessionId: sessionId,
                        sessions: args.sessions,
                        subagentSdkSessionIdToAgentId: args.subagentSdkSessionIdToAgentId,
                        unmappedSubagentIds: args.unmappedSubagentIds,
                    });
                    if (parentAgentId) {
                        eventData.parentAgentId = parentAgentId;
                    }
                }

                const event: AgentEvent<T> = {
                    type: args.eventType,
                    sessionId,
                    timestamp: new Date().toISOString(),
                    data: eventData as AgentEvent<T>["data"],
                };

                try {
                    await args.handler(event);
                } catch (error) {
                    console.error(
                        `Error in hook handler for ${args.eventType}:`,
                        error,
                    );
                }

                return { continue: true };
            };
        };

        const hookCallback = createHookCallback(hookEvent);
        if (!args.registeredHooks[hookEvent]) {
            args.registeredHooks[hookEvent] = [];
        }
        args.registeredHooks[hookEvent]!.push(hookCallback);
        addedHooks.push({ event: hookEvent, callback: hookCallback });

        if (hookEvent === "PostToolUse") {
            const failureCallback = createHookCallback("PostToolUseFailure");
            if (!args.registeredHooks["PostToolUseFailure"]) {
                args.registeredHooks["PostToolUseFailure"] = [];
            }
            args.registeredHooks["PostToolUseFailure"]!.push(
                failureCallback,
            );
            addedHooks.push({
                event: "PostToolUseFailure",
                callback: failureCallback,
            });
        }
    }

    return () => {
        handlers?.delete(args.handler as EventHandler<EventType>);
        for (const { event, callback } of addedHooks) {
            const hooks = args.registeredHooks[event];
            if (hooks) {
                const index = hooks.indexOf(callback);
                if (index !== -1) {
                    hooks.splice(index, 1);
                }
            }
        }
    };
}
