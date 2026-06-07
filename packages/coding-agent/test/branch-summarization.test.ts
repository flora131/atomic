import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { prepareBranchEntries } from "../src/core/compaction/branch-summarization.ts";
import { serializeConversation } from "../src/core/compaction/utils.ts";
import { convertToLlm } from "../src/core/messages.ts";
import type { ContextCompactionEntry, SessionEntry, SessionMessageEntry } from "../src/core/session-manager.ts";

let counter = 0;
let lastId: string | null = null;

function resetIds(): void {
	counter = 0;
	lastId = null;
}

function user(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistantBlocks(blocks: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content: blocks,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function entry(message: AgentMessage): SessionMessageEntry {
	const id = `entry-${counter++}`;
	const result: SessionMessageEntry = {
		type: "message",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		message,
	};
	lastId = id;
	return result;
}

function contextEntry(targets: ContextCompactionEntry["deletedTargets"]): ContextCompactionEntry {
	const id = `entry-${counter++}`;
	const result: ContextCompactionEntry = {
		type: "context_compaction",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		promptVersion: 1,
		deletedTargets: targets,
		protectedEntryIds: [],
		stats: {
			objectsBefore: 0,
			objectsAfter: 0,
			objectsDeleted: targets.length,
			tokensBefore: 0,
			tokensAfter: 0,
			percentReduction: 0,
		},
	};
	lastId = id;
	return result;
}

describe("branch summarization context deletion filtering", () => {
	it("omits whole-entry and content-block logical deletions from prepared prompt input", () => {
		resetIds();
		const deletedEntrySentinel = "ITER7_BRANCH_DELETED_ENTRY_SENTINEL";
		const deletedBlockSentinel = "ITER7_BRANCH_DELETED_BLOCK_SENTINEL";
		const retainedBlockSentinel = "ITER7_BRANCH_RETAINED_BLOCK_SENTINEL";
		const task = entry(user("branch task context"));
		const deletedEntry = entry(assistantBlocks([{ type: "text", text: deletedEntrySentinel }]));
		const partiallyDeletedEntry = entry(
			assistantBlocks([
				{ type: "text", text: deletedBlockSentinel },
				{ type: "text", text: retainedBlockSentinel },
			]),
		);
		const deletionRecord = contextEntry([
			{ kind: "entry", entryId: deletedEntry.id },
			{ kind: "content_block", entryId: partiallyDeletedEntry.id, blockIndex: 0 },
		]);
		const entries: SessionEntry[] = [task, deletedEntry, partiallyDeletedEntry, deletionRecord];

		const prepared = prepareBranchEntries(entries);
		const preparedJson = JSON.stringify(prepared.messages);
		const promptInput = serializeConversation(convertToLlm(prepared.messages));

		expect(preparedJson).not.toContain(deletedEntrySentinel);
		expect(preparedJson).not.toContain(deletedBlockSentinel);
		expect(preparedJson).toContain(retainedBlockSentinel);
		expect(promptInput).not.toContain(deletedEntrySentinel);
		expect(promptInput).not.toContain(deletedBlockSentinel);
		expect(promptInput).toContain(retainedBlockSentinel);
	});
});
