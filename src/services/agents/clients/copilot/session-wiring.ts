import type {
	CopilotSession as SdkCopilotSession,
	SessionConfig as SdkSessionConfig,
	SessionEvent as SdkSessionEvent,
} from "@github/copilot-sdk";
import {
	dispatchCopilotSdkEvent,
	extractCopilotErrorMessage,
} from "@/services/agents/clients/copilot/event-mapper.ts";
import {
	createAutoApprovePermissionHandler,
	createCopilotUserInputHandler,
} from "@/services/agents/clients/copilot/permissions.ts";
import {
	buildCopilotSdkSessionConfigBase,
	convertCopilotTool,
} from "@/services/agents/clients/copilot/session-config.ts";
import {
	createWrappedCopilotSession,
	isDuplicateCopilotSdkEvent,
	subscribeCopilotSessionEvents,
} from "@/services/agents/clients/copilot/session-runtime.ts";
import type {
	CopilotSessionArtifacts,
	CopilotSessionState,
} from "@/services/agents/clients/copilot/types.ts";
import type {
	ProviderStreamEventDataMap,
	ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import type {
	EventType,
	Session,
	SessionConfig,
	ToolDefinition,
} from "@/services/agents/types.ts";

type EmitEventFn = <T extends EventType>(
	eventType: T,
	sessionId: string,
	data: Record<string, unknown>,
) => void;

type EmitProviderEventFn = <T extends ProviderStreamEventType>(
	eventType: T,
	sessionId: string,
	data: ProviderStreamEventDataMap[T],
	options?: {
		native?: SdkSessionEvent;
		nativeEventId?: string;
		nativeSessionId?: string;
		nativeParentEventId?: string;
		timestamp?: number;
	},
) => void;

export function buildCopilotClientSessionConfigBase(args: {
	config: SessionConfig;
	options: {
		sessionIdForUserInput: string;
		model?: string;
		reasoningEffort?: SdkSessionConfig["reasoningEffort"];
		artifacts?: CopilotSessionArtifacts;
	};
	registeredTools: ToolDefinition[];
	sessions: Map<string, CopilotSessionState>;
	clientCwd?: string;
	getCopilotPermissionHandler: () => SdkSessionConfig["onPermissionRequest"];
	emitEvent: EmitEventFn;
	emitProviderEvent: EmitProviderEventFn;
}): Omit<SdkSessionConfig, "sessionId"> {
	const defaultPermissionHandler = args.getCopilotPermissionHandler();

	return buildCopilotSdkSessionConfigBase({
		config: args.config,
		sessionIdForUserInput: args.options.sessionIdForUserInput,
		model: args.options.model,
		reasoningEffort: args.options.reasoningEffort,
		artifacts: args.options.artifacts,
		tools: args.registeredTools.map((tool) =>
			convertCopilotTool(tool, {
				getActiveSessionId: () => args.sessions.keys().next().value ?? "",
				cwd: args.clientCwd,
			}),
		),
		availableTools: args.config.tools,
		onPermissionRequest: createAutoApprovePermissionHandler({
			sessions: args.sessions,
			agentToolPolicies: args.options.artifacts?.agentToolPolicies,
			fallbackHandler: defaultPermissionHandler,
		}),
		onUserInputRequest: createCopilotUserInputHandler({
			preferredSessionId: args.options.sessionIdForUserInput,
			getActiveSessionIds: () =>
				Array.from(args.sessions.values())
					.filter((session) => !session.isClosed)
					.map((session) => session.sessionId),
			emitHumanInputRequired: (resolvedSessionId, data) => {
				args.emitEvent(
					"human_input_required",
					resolvedSessionId,
					data as unknown as Record<string, unknown>,
				);
			},
			emitProviderHumanInputRequired: (resolvedSessionId, data, options) => {
				args.emitProviderEvent(
					"human_input_required",
					resolvedSessionId,
					data,
					options,
				);
			},
		}),
	});
}

export function subscribeCopilotClientSessionEvents(args: {
	sessionId: string;
	sdkSession: SdkCopilotSession;
	sessions: Map<string, CopilotSessionState>;
	handleSdkEvent: (sessionId: string, event: SdkSessionEvent) => void;
}): () => void {
	return subscribeCopilotSessionEvents({
		sessionId: args.sessionId,
		sdkSession: args.sdkSession,
		sessions: args.sessions,
		handleSdkEvent: args.handleSdkEvent,
	});
}

export function wrapCopilotClientSession(args: {
	sdkSession: SdkCopilotSession;
	config: SessionConfig;
	sessions: Map<string, CopilotSessionState>;
	emitEvent: EmitEventFn;
	emitProviderEvent: EmitProviderEventFn;
	handleSdkEvent: (sessionId: string, event: SdkSessionEvent) => void;
}): Session {
	return createWrappedCopilotSession({
		sdkSession: args.sdkSession,
		config: args.config,
		sessions: args.sessions,
		subscribeSessionEvents: (sessionId, activeSdkSession) =>
			subscribeCopilotClientSessionEvents({
				sessionId,
				sdkSession: activeSdkSession,
				sessions: args.sessions,
				handleSdkEvent: args.handleSdkEvent,
			}),
		emitEvent: args.emitEvent,
		emitProviderEvent: args.emitProviderEvent,
		extractErrorMessage: (error) => extractCopilotErrorMessage(error),
	});
}

export function handleCopilotClientSdkEvent(args: {
	sessionId: string;
	event: SdkSessionEvent;
	sessions: Map<string, CopilotSessionState>;
	emitMappedSdkEvent: <T extends ProviderStreamEventType>(
		eventType: T,
		sessionId: string,
		data: ProviderStreamEventDataMap[T],
		nativeEvent: SdkSessionEvent,
		unifiedData?: Record<string, unknown>,
	) => void;
}): void {
	dispatchCopilotSdkEvent({
		sessionId: args.sessionId,
		event: args.event,
		state: args.sessions.get(args.sessionId),
		isDuplicateEvent: (state, sdkEvent) =>
			isDuplicateCopilotSdkEvent(state, sdkEvent),
		emitMappedSdkEvent: args.emitMappedSdkEvent,
	});
}
