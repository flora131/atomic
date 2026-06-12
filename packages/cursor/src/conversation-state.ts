import type { CursorRunStream, CursorServerMessage, CursorToolResultMessage, CursorTransportLifecycleSnapshot } from "./transport.js";

export interface CursorConversationSnapshot extends CursorTransportLifecycleSnapshot {
	readonly activeTurns: number;
}

export interface PendingCursorToolCall {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly execId?: string;
	readonly execNumericId?: number;
}

interface ActiveTurn {
	readonly conversationId: string;
	readonly stream: CursorRunStream;
	readonly pendingTools: ReadonlyMap<string, PendingCursorToolCall>;
	readonly abortCleanup?: () => void;
	readonly idleTimer?: ReturnType<typeof setTimeout>;
}

export interface CursorPauseTurnOptions {
	readonly signal?: AbortSignal;
	readonly idleTimeoutMs?: number;
}

export class CursorConversationStateStore {
	readonly #activeTurns = new Map<string, ActiveTurn>();

	registerTurn(conversationId: string, stream: CursorRunStream): void {
		this.#activeTurns.set(conversationId, { conversationId, stream, pendingTools: new Map() });
	}

	pauseTurnForTools(conversationId: string, stream: CursorRunStream, toolCalls: readonly Extract<CursorServerMessage, { readonly type: "toolCall" }>[], options: CursorPauseTurnOptions = {}): void {
		const existing = this.#activeTurns.get(conversationId);
		if (existing && existing.stream !== stream) void this.cancelTurn(conversationId);
		else if (existing) this.cleanupTurn(existing);
		const pendingTools = new Map<string, PendingCursorToolCall>();
		for (const toolCall of toolCalls) {
			pendingTools.set(toolCall.id, {
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				...(toolCall.execId ? { execId: toolCall.execId } : {}),
				...(toolCall.execNumericId !== undefined ? { execNumericId: toolCall.execNumericId } : {}),
			});
		}
		let abortCleanup: (() => void) | undefined;
		if (options.signal) {
			const onAbort = (): void => { void this.cancelTurn(conversationId); };
			options.signal.addEventListener("abort", onAbort, { once: true });
			abortCleanup = () => options.signal?.removeEventListener("abort", onAbort);
		}
		const idleTimer = options.idleTimeoutMs && options.idleTimeoutMs > 0 ? setTimeout(() => { void this.cancelTurn(conversationId); }, options.idleTimeoutMs) : undefined;
		idleTimer?.unref?.();
		this.#activeTurns.set(conversationId, { conversationId, stream, pendingTools, ...(abortCleanup ? { abortCleanup } : {}), ...(idleTimer ? { idleTimer } : {}) });
		if (options.signal?.aborted) void this.cancelTurn(conversationId);
	}

	async resumeTurnWithToolResults(conversationId: string, results: readonly CursorToolResultMessage[]): Promise<CursorRunStream> {
		const turn = this.#activeTurns.get(conversationId);
		if (!turn) throw new Error(`Cursor has no paused tool turn for conversation ${conversationId}.`);
		this.cleanupTurn(turn);
		this.#activeTurns.set(conversationId, { conversationId, stream: turn.stream, pendingTools: turn.pendingTools });
		try {
			for (const result of results) {
				const pending = turn.pendingTools.get(result.toolCallId);
				if (!pending) throw new Error(`Cursor tool result ${result.toolCallId} does not match a paused tool call.`);
				await turn.stream.writeToolResult({ ...result, execId: pending.execId, execNumericId: pending.execNumericId });
			}
			return turn.stream;
		} catch (error) {
			this.#activeTurns.delete(conversationId);
			await turn.stream.cancel();
			throw error;
		}
	}

	completeTurn(conversationId: string): void {
		const turn = this.#activeTurns.get(conversationId);
		if (turn) this.cleanupTurn(turn);
		this.#activeTurns.delete(conversationId);
	}

	async cancelTurn(conversationId: string): Promise<void> {
		const turn = this.#activeTurns.get(conversationId);
		if (!turn) return;
		this.cleanupTurn(turn);
		this.#activeTurns.delete(conversationId);
		await turn.stream.cancel();
	}

	async dispose(): Promise<void> {
		const turns = [...this.#activeTurns.values()];
		this.#activeTurns.clear();
		await Promise.allSettled(turns.map(async (turn) => {
			this.cleanupTurn(turn);
			await turn.stream.cancel();
		}));
	}

	private cleanupTurn(turn: ActiveTurn): void {
		turn.abortCleanup?.();
		if (turn.idleTimer) clearTimeout(turn.idleTimer);
	}

	get activeTurns(): number {
		return this.#activeTurns.size;
	}

	snapshot(transport: CursorTransportLifecycleSnapshot): CursorConversationSnapshot {
		return { ...transport, activeTurns: this.#activeTurns.size };
	}
}
