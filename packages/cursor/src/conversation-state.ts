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
}

export class CursorConversationStateStore {
	readonly #activeTurns = new Map<string, ActiveTurn>();

	registerTurn(conversationId: string, stream: CursorRunStream): void {
		this.#activeTurns.set(conversationId, { conversationId, stream, pendingTools: new Map() });
	}

	pauseTurnForTools(conversationId: string, stream: CursorRunStream, toolCalls: readonly Extract<CursorServerMessage, { readonly type: "toolCall" }>[]): void {
		const pendingTools = new Map<string, PendingCursorToolCall>();
		for (const toolCall of toolCalls) {
			pendingTools.set(toolCall.id, {
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				...(toolCall.execId ? { execId: toolCall.execId } : {}),
				...(toolCall.execNumericId !== undefined ? { execNumericId: toolCall.execNumericId } : {}),
			});
		}
		this.#activeTurns.set(conversationId, { conversationId, stream, pendingTools });
	}

	async resumeTurnWithToolResults(conversationId: string, results: readonly CursorToolResultMessage[]): Promise<CursorRunStream> {
		const turn = this.#activeTurns.get(conversationId);
		if (!turn) throw new Error(`Cursor has no paused tool turn for conversation ${conversationId}.`);
		for (const result of results) {
			const pending = turn.pendingTools.get(result.toolCallId);
			if (!pending) throw new Error(`Cursor tool result ${result.toolCallId} does not match a paused tool call.`);
			await turn.stream.writeToolResult({ ...result, execId: pending.execId, execNumericId: pending.execNumericId });
		}
		return turn.stream;
	}

	completeTurn(conversationId: string): void {
		this.#activeTurns.delete(conversationId);
	}

	async cancelTurn(conversationId: string): Promise<void> {
		const turn = this.#activeTurns.get(conversationId);
		if (!turn) return;
		await turn.stream.cancel();
		this.#activeTurns.delete(conversationId);
	}

	async dispose(): Promise<void> {
		const turns = [...this.#activeTurns.values()];
		this.#activeTurns.clear();
		await Promise.allSettled(turns.map(async (turn) => {
			await turn.stream.cancel();
		}));
	}

	get activeTurns(): number {
		return this.#activeTurns.size;
	}

	snapshot(transport: CursorTransportLifecycleSnapshot): CursorConversationSnapshot {
		return { ...transport, activeTurns: this.#activeTurns.size };
	}
}
