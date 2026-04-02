/**
 * CopilotClient - Implementation of CodingAgentClient for GitHub Copilot SDK
 */

import {
	type CopilotClientOptions as SdkClientOptions,
	CopilotClient as SdkCopilotClient,
	type CopilotSession as SdkCopilotSession,
	type PermissionHandler as SdkPermissionHandler,
	type PermissionRequest as SdkPermissionRequest,
	type SessionEvent as SdkSessionEvent,
	type SessionEventType as SdkSessionEventType,
} from "@github/copilot-sdk";
import {
	getBundledCopilotCliPath,
	resolveCopilotSdkCliLaunch,
	resolveNodePath,
} from "@/services/agents/clients/copilot/cli-path.ts";
import {
	emitCopilotEvent,
	emitCopilotProviderEvent,
	emitMappedCopilotSdkEvent,
} from "@/services/agents/clients/copilot/event-bridge.ts";
import {
	type CopilotKeepaliveHandle,
	createCopilotKeepalive,
} from "@/services/agents/clients/copilot/keepalive.ts";
import {
	listCopilotSdkModelsFresh,
	listCopilotSdkModelsFromFreshClient,
} from "@/services/agents/clients/copilot/models.ts";
import {
	createAutoApprovePermissionHandler,
	createDenyAllPermissionHandler,
	resolveCopilotUserInputSessionId,
} from "@/services/agents/clients/copilot/permissions.ts";
import {
	deleteCopilotSession,
	getCopilotModelDisplayInfoForClient,
	listCopilotAvailableModels,
	listCopilotSessions,
	startCopilotRuntime,
	stopCopilotRuntime,
} from "@/services/agents/clients/copilot/runtime-ops.ts";
import { buildCopilotSdkOptions } from "@/services/agents/clients/copilot/sdk-options.ts";
import { loadCopilotSessionArtifacts as loadCopilotSessionArtifactsImpl } from "@/services/agents/clients/copilot/session-config.ts";
import {
	createCopilotSession,
	resumeCopilotSession,
	setCopilotActiveSessionModel,
} from "@/services/agents/clients/copilot/session-operations.ts";
import {
	buildCopilotClientSessionConfigBase,
	handleCopilotClientSdkEvent,
	subscribeCopilotClientSessionEvents,
	wrapCopilotClientSession,
} from "@/services/agents/clients/copilot/session-wiring.ts";
import type {
	CopilotSessionArtifacts,
	CopilotSessionState,
} from "@/services/agents/clients/copilot/types.ts";
import type {
	CopilotProviderEventHandler,
	ProviderStreamEventDataMap,
	ProviderStreamEventType,
} from "@/services/agents/provider-events.ts";
import type {
	AgentEvent,
	CodingAgentClient,
	EventHandler,
	EventType,
	Session,
	SessionConfig,
	ToolDefinition,
} from "@/services/agents/types.ts";

export {
	getBundledCopilotCliPath,
	resolveCopilotSdkCliLaunch,
	resolveNodePath,
} from "@/services/agents/clients/copilot/cli-path.ts";
export {
	createAutoApprovePermissionHandler,
	createDenyAllPermissionHandler,
	resolveCopilotUserInputSessionId,
} from "@/services/agents/clients/copilot/permissions.ts";

export type CopilotPermissionHandler = SdkPermissionHandler;

export type CopilotConnectionMode =
	| { type: "stdio" }
	| { type: "port"; port: number }
	| { type: "cliUrl"; url: string };

export interface CopilotClientOptions {
	connectionMode?: CopilotConnectionMode;
	timeout?: number;
	cliPath?: string;
	cliArgs?: string[];
	cwd?: string;
	logLevel?: "none" | "error" | "warning" | "info" | "debug" | "all";
	autoStart?: boolean;
	githubToken?: string;
}

export class CopilotClient implements CodingAgentClient {
	readonly agentType = "copilot" as const;

	private sdkClient: SdkCopilotClient | null = null;
	private clientOptions: CopilotClientOptions;
	private eventHandlers: Map<EventType, Set<EventHandler<EventType>>> =
		new Map();
	private providerEventHandlers = new Set<CopilotProviderEventHandler>();
	private sessions: Map<string, CopilotSessionState> = new Map();
	private registeredTools: ToolDefinition[] = [];
	private permissionHandler: CopilotPermissionHandler | null = null;
	private isRunning = false;
	private isExternalServer = false;
	private probeSystemToolsBaseline: number | null = null;
	private probePromise: Promise<void> | null = null;
	private knownAgentNames: string[] = [];
	private keepalive: CopilotKeepaliveHandle | null = null;

	private createSdkClientInstance(options: SdkClientOptions): SdkCopilotClient {
		return new SdkCopilotClient(options);
	}

	private async listSdkModelsFresh(): Promise<unknown[]> {
		if (!this.sdkClient) {
			throw new Error("Client not started. Call start() first.");
		}
		return await listCopilotSdkModelsFresh(this.sdkClient);
	}

	private async listSdkModelsFromFreshClient(): Promise<unknown[]> {
		return await listCopilotSdkModelsFromFreshClient({
			buildSdkOptions: () => this.buildSdkOptions(),
			createSdkClientInstance: (options) =>
				this.createSdkClientInstance(options),
		});
	}

	constructor(options: CopilotClientOptions = {}) {
		this.clientOptions = options;
		this.isExternalServer = options.connectionMode?.type === "cliUrl";
	}

	setPermissionHandler(handler: CopilotPermissionHandler): void {
		this.permissionHandler = handler;
	}

	private async buildSdkOptions(): Promise<SdkClientOptions> {
		return await buildCopilotSdkOptions(this.clientOptions);
	}

	private getCopilotPermissionHandler(): CopilotPermissionHandler {
		return this.permissionHandler ?? createAutoApprovePermissionHandler();
	}

	private async loadCopilotSessionArtifacts(
		projectRoot: string,
	): Promise<CopilotSessionArtifacts> {
		return await loadCopilotSessionArtifactsImpl(projectRoot, {
			xdgConfigHome: process.env.XDG_CONFIG_HOME,
			setKnownAgentNames: (names) => {
				this.knownAgentNames = names;
			},
		});
	}

	private wrapSession(
		sdkSession: SdkCopilotSession,
		config: SessionConfig,
	): Session {
		return wrapCopilotClientSession({
			sdkSession,
			config,
			sessions: this.sessions,
			emitEvent: (eventType, sessionId, data) =>
				this.emitEvent(
					eventType,
					sessionId,
					data as AgentEvent<typeof eventType>["data"],
				),
			emitProviderEvent: (eventType, sessionId, data, options) =>
				this.emitProviderEvent(eventType, sessionId, data, options),
			handleSdkEvent: (resolvedSessionId, event) =>
				this.handleSdkEvent(resolvedSessionId, event),
		});
	}

	private handleSdkEvent(sessionId: string, event: SdkSessionEvent): void {
		handleCopilotClientSdkEvent({
			sessionId,
			event,
			sessions: this.sessions,
			emitMappedSdkEvent: (
				eventType,
				resolvedSessionId,
				data,
				nativeEvent,
				unifiedData,
			) =>
				this.emitMappedSdkEvent(
					eventType,
					resolvedSessionId,
					data,
					nativeEvent,
					unifiedData,
				),
		});
	}

	onProviderEvent(handler: CopilotProviderEventHandler): () => void {
		this.providerEventHandlers.add(handler);
		return () => void this.providerEventHandlers.delete(handler);
	}

	private emitProviderEvent<T extends ProviderStreamEventType>(
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
	): void {
		emitCopilotProviderEvent({
			providerEventHandlers: this.providerEventHandlers,
			eventType,
			sessionId,
			data,
			options,
		});
	}

	private emitMappedSdkEvent<T extends ProviderStreamEventType>(
		eventType: T,
		sessionId: string,
		data: ProviderStreamEventDataMap[T],
		nativeEvent: SdkSessionEvent,
		unifiedData?: Record<string, unknown>,
	): void {
		emitMappedCopilotSdkEvent({
			eventType,
			sessionId,
			data,
			nativeEvent,
			unifiedData,
			emitEvent: (resolvedEventType, resolvedSessionId, resolvedData) =>
				this.emitEvent(
					resolvedEventType,
					resolvedSessionId,
					resolvedData as AgentEvent<typeof resolvedEventType>["data"],
				),
			emitProviderEvent: (
				resolvedEventType,
				resolvedSessionId,
				resolvedData,
				emitOptions,
			) =>
				this.emitProviderEvent(
					resolvedEventType,
					resolvedSessionId,
					resolvedData,
					emitOptions,
				),
		});
	}

	private emitEvent<T extends EventType>(
		eventType: T,
		sessionId: string,
		data: AgentEvent<T>["data"],
	): void {
		emitCopilotEvent({
			eventHandlers: this.eventHandlers,
			eventType,
			sessionId,
			data,
		});
	}

	async createSession(config: SessionConfig = {}): Promise<Session> {
		return await createCopilotSession({
			sdkClient: this.sdkClient,
			isRunning: this.isRunning,
			clientCwd: this.clientOptions.cwd,
			config,
			sessions: this.sessions,
			loadCopilotSessionArtifacts: (projectRoot) =>
				this.loadCopilotSessionArtifacts(projectRoot),
			listSdkModelsFresh: () => this.listSdkModelsFresh(),
			buildSdkSessionConfigBase: (sessionConfig, options) =>
				buildCopilotClientSessionConfigBase({
					config: sessionConfig,
					options,
					registeredTools: this.registeredTools,
					sessions: this.sessions,
					clientCwd: this.clientOptions.cwd,
					getCopilotPermissionHandler: () => this.getCopilotPermissionHandler(),
					emitEvent: (eventType, sessionId, data) =>
						this.emitEvent(
							eventType,
							sessionId,
							data as AgentEvent<typeof eventType>["data"],
						),
					emitProviderEvent: (eventType, sessionId, data, emitOptions) =>
						this.emitProviderEvent(eventType, sessionId, data, emitOptions),
				}),
			wrapSession: (sdkSession, sessionConfig) =>
				this.wrapSession(sdkSession, sessionConfig),
		});
	}

	async resumeSession(sessionId: string): Promise<Session | null> {
		return await resumeCopilotSession({
			sdkClient: this.sdkClient,
			isRunning: this.isRunning,
			sessionId,
			clientCwd: this.clientOptions.cwd,
			sessions: this.sessions,
			loadCopilotSessionArtifacts: (projectRoot) =>
				this.loadCopilotSessionArtifacts(projectRoot),
			buildSdkSessionConfigBase: (sessionConfig, options) =>
				buildCopilotClientSessionConfigBase({
					config: sessionConfig,
					options,
					registeredTools: this.registeredTools,
					sessions: this.sessions,
					clientCwd: this.clientOptions.cwd,
					getCopilotPermissionHandler: () => this.getCopilotPermissionHandler(),
					emitEvent: (eventType, resolvedSessionId, data) =>
						this.emitEvent(
							eventType,
							resolvedSessionId,
							data as AgentEvent<typeof eventType>["data"],
						),
					emitProviderEvent: (
						eventType,
						resolvedSessionId,
						data,
						emitOptions,
					) =>
						this.emitProviderEvent(
							eventType,
							resolvedSessionId,
							data,
							emitOptions,
						),
				}),
			wrapSession: (sdkSession, sessionConfig) =>
				this.wrapSession(sdkSession, sessionConfig),
		});
	}

	async setActiveSessionModel(
		model: string,
		options?: { reasoningEffort?: string },
	): Promise<void> {
		await setCopilotActiveSessionModel({
			sdkClient: this.sdkClient,
			isRunning: this.isRunning,
			model,
			options,
			clientCwd: this.clientOptions.cwd,
			sessions: this.sessions,
			loadCopilotSessionArtifacts: (projectRoot) =>
				this.loadCopilotSessionArtifacts(projectRoot),
			listSdkModelsFresh: () => this.listSdkModelsFresh(),
			buildSdkSessionConfigBase: (sessionConfig, configOptions) =>
				buildCopilotClientSessionConfigBase({
					config: sessionConfig,
					options: configOptions,
					registeredTools: this.registeredTools,
					sessions: this.sessions,
					clientCwd: this.clientOptions.cwd,
					getCopilotPermissionHandler: () => this.getCopilotPermissionHandler(),
					emitEvent: (eventType, resolvedSessionId, data) =>
						this.emitEvent(
							eventType,
							resolvedSessionId,
							data as AgentEvent<typeof eventType>["data"],
						),
					emitProviderEvent: (
						eventType,
						resolvedSessionId,
						data,
						emitOptions,
					) =>
						this.emitProviderEvent(
							eventType,
							resolvedSessionId,
							data,
							emitOptions,
						),
				}),
			subscribeSessionEvents: (sessionId, sdkSession) =>
				subscribeCopilotClientSessionEvents({
					sessionId,
					sdkSession,
					sessions: this.sessions,
					handleSdkEvent: (resolvedSessionId, event) =>
						this.handleSdkEvent(resolvedSessionId, event),
				}),
		});
	}

	on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
		let handlers = this.eventHandlers.get(eventType);
		if (!handlers) {
			handlers = new Set();
			this.eventHandlers.set(eventType, handlers);
		}

		handlers.add(handler as EventHandler<EventType>);

		return () => {
			handlers?.delete(handler as EventHandler<EventType>);
		};
	}

	registerTool(tool: ToolDefinition): void {
		this.registeredTools.push(tool);
	}

	private isReconnecting = false;

	async start(): Promise<void> {
		await startCopilotRuntime({
			isRunning: this.isRunning,
			buildSdkOptions: () => this.buildSdkOptions(),
			createSdkClientInstance: (options) =>
				this.createSdkClientInstance(options),
			setSdkClient: (client) => {
				this.sdkClient = client;
			},
			setIsRunning: (running) => {
				this.isRunning = running;
			},
			getCopilotPermissionHandler: () => this.getCopilotPermissionHandler(),
			setProbeSystemToolsBaseline: (baseline) => {
				this.probeSystemToolsBaseline = baseline;
			},
			setProbePromise: (promise) => {
				this.probePromise = promise;
			},
		});

		this.keepalive = createCopilotKeepalive({
			getSdkClient: () => this.sdkClient,
			isRunning: () => this.isRunning,
			onConnectionLost: () => void this.reconnect(),
		});
		this.keepalive.start();
	}

	/**
	 * Tears down the current SDK client and starts a fresh one.
	 *
	 * All existing sessions are marked closed — the next user interaction
	 * will trigger the TUI's session-recovery flow which calls
	 * `resumeSession()` to re-attach to persisted conversation history.
	 */
	private async reconnect(): Promise<void> {
		if (this.isReconnecting || !this.isRunning) {
			return;
		}
		this.isReconnecting = true;

		try {
			// Stop keepalive first to prevent re-entrant reconnect calls.
			this.keepalive?.stop();
			this.keepalive = null;

			// Mark every tracked session as closed so the next send()
			// surfaces a "session is closed" error which the controller
			// handles via its existing recovery path.
			for (const state of this.sessions.values()) {
				if (!state.isClosed) {
					state.isClosed = true;
					state.unsubscribe();
				}
			}
			this.sessions.clear();

			// Tear down the old SDK client.
			if (this.sdkClient) {
				try {
					await this.sdkClient.stop();
				} catch {
					// The connection is already dead — ignore cleanup errors.
				}
				this.sdkClient = null;
			}
			this.isRunning = false;

			// Start a fresh client + keepalive.
			await this.start();
		} finally {
			this.isReconnecting = false;
		}
	}

	async stop(): Promise<void> {
		this.keepalive?.stop();
		this.keepalive = null;

		await stopCopilotRuntime({
			isRunning: this.isRunning,
			probePromise: this.probePromise,
			setProbePromise: (promise) => {
				this.probePromise = promise;
			},
			sessions: this.sessions,
			sdkClient: this.sdkClient,
			setSdkClient: (client) => {
				this.sdkClient = client;
			},
			eventHandlers: this.eventHandlers,
			setIsRunning: (running) => {
				this.isRunning = running;
			},
		});
	}

	getState(): "disconnected" | "connecting" | "connected" | "error" {
		return this.sdkClient ? this.sdkClient.getState() : "disconnected";
	}

	async listSessions(): Promise<
		Array<{ sessionId: string; summary?: string }>
	> {
		return await listCopilotSessions({
			isRunning: this.isRunning,
			sdkClient: this.sdkClient,
		});
	}

	async deleteSession(sessionId: string): Promise<void> {
		await deleteCopilotSession({
			isRunning: this.isRunning,
			sdkClient: this.sdkClient,
			sessionId,
			sessions: this.sessions,
		});
	}

	async listAvailableModels(): Promise<unknown[]> {
		return await listCopilotAvailableModels({
			isRunning: this.isRunning,
			sdkClient: this.sdkClient,
			isExternalServer: this.isExternalServer,
			listSdkModelsFresh: () => this.listSdkModelsFresh(),
			listSdkModelsFromFreshClient: () => this.listSdkModelsFromFreshClient(),
		});
	}

	async getModelDisplayInfo(modelHint?: string): Promise<{
		model: string;
		tier: string;
		supportsReasoning?: boolean;
		defaultReasoningEffort?: string;
		contextWindow?: number;
	}> {
		return await getCopilotModelDisplayInfoForClient({
			isRunning: this.isRunning,
			sdkClient: this.sdkClient,
			modelHint,
			listSdkModelsFresh: () => this.listSdkModelsFresh(),
		});
	}

	getSystemToolsTokens(): number | null {
		return this.probeSystemToolsBaseline;
	}

	getKnownAgentNames(): string[] {
		return this.knownAgentNames;
	}
}

export function createCopilotClient(
	options?: CopilotClientOptions,
): CopilotClient {
	return new CopilotClient(options);
}

export type {
	SdkPermissionRequest as CopilotSdkPermissionRequest,
	SdkSessionEvent as CopilotSdkEvent,
	SdkSessionEventType as CopilotSdkEventType,
};
