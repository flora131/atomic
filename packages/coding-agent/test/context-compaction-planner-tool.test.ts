import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	createContextDeletionPlannerTool,
	DEFAULT_COMPACTION_SETTINGS,
	type CompactableTranscript,
	planContextDeletions,
} from "../src/core/compaction/index.ts";

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function assistantMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "faux",
		provider: "faux",
		model: "faux-1",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createTranscript(): CompactableTranscript {
	const task = userMessage("Keep the user's task protected.");
	const oldOne = assistantMessage("Old search output that can be deleted.");
	const oldTwo = assistantMessage("Old file read that can be deleted.");
	return {
		entries: [
			{
				entryId: "entry-user",
				entryType: "message",
				role: "user",
				text: "Keep the user's task protected.",
				tokenEstimate: 8,
				protected: true,
				contentBlocks: [],
				message: task,
				toolCallIds: [],
			},
			{
				entryId: "entry-old-1",
				entryType: "message",
				role: "assistant",
				text: "Old search output that can be deleted.",
				tokenEstimate: 8,
				protected: false,
				contentBlocks: [],
				message: oldOne,
				toolCallIds: [],
			},
			{
				entryId: "entry-old-2",
				entryType: "message",
				role: "assistant",
				text: "Old file read that can be deleted.",
				tokenEstimate: 8,
				protected: false,
				contentBlocks: [],
				message: oldTwo,
				toolCallIds: [],
			},
		],
		protectedEntryIds: ["entry-user"],
		tokensBefore: 24,
		settings: DEFAULT_COMPACTION_SETTINGS,
	};
}

describe("context compaction planner structured tool", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			cleanups.pop()?.();
		}
	});

	it("records deletion targets through an executable context_deletion_plan tool", async () => {
		let capturedContext: Context | undefined;
		let continuationContext: Context | undefined;
		const faux = registerFauxProvider();
		cleanups.push(() => faux.unregister());
		faux.setResponses([
			(context) => {
				capturedContext = context;
				return fauxAssistantMessage(
					[
						fauxToolCall(
							"context_deletion_plan",
							{ deletions: [{ kind: "entry", entryId: "entry-old-1" }] },
							{ id: "toolu_plan_1" },
						),
						fauxToolCall(
							"context_deletion_plan",
							{ deletions: [{ kind: "entry", entryId: "entry-old-2" }] },
							{ id: "toolu_plan_2" },
						),
					],
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				continuationContext = context;
				return fauxAssistantMessage("Done recording deletion targets.");
			},
		]);

		const plan = await planContextDeletions(createTranscript(), faux.getModel(), "test-key");

		expect(plan.deletions).toEqual([
			{ kind: "entry", entryId: "entry-old-1" },
			{ kind: "entry", entryId: "entry-old-2" },
		]);
		expect(faux.state.callCount).toBe(2);
		expect(capturedContext).toMatchObject({
			systemPrompt: expect.stringContaining("context_deletion_plan"),
			tools: expect.arrayContaining([
				expect.objectContaining({ name: "context_deletion_plan" }),
				expect.objectContaining({ name: "context_grep_delete" }),
			]),
		});
		expect(continuationContext?.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: "toolResult", toolCallId: "toolu_plan_1" }),
				expect.objectContaining({ role: "toolResult", toolCallId: "toolu_plan_2" }),
			]),
		);
	});

	it("sets the transcript-bound planner tool result to terminate false explicitly", async () => {
		const controller = createContextDeletionPlannerTool(createTranscript());

		const result = await controller.tool.execute("toolu_plan", {
			deletions: [{ kind: "entry", entryId: "entry-old-1" }],
		});

		expect(result.terminate).toBe(false);
		expect(controller.getPlan().deletions).toEqual([{ kind: "entry", entryId: "entry-old-1" }]);
		expect(controller.getCallCount()).toBe(1);
	});

	it("bulk deletes grep-matched entries with embedded guardrails", async () => {
		const controller = createContextDeletionPlannerTool(createTranscript());

		const result = await controller.grepTool.execute("toolu_grep", {
			pattern: "Old",
			target: "entry",
			maxMatches: 10,
		});

		expect(result.terminate).toBe(false);
		expect(controller.getPlan().deletions).toEqual([
			{ kind: "entry", entryId: "entry-old-1" },
			{ kind: "entry", entryId: "entry-old-2" },
		]);
		expect(result.details.matches.map((match) => match.entryId)).toEqual(["entry-old-1", "entry-old-2"]);
		expect(result.details.skipped).toEqual([]);
	});

	it("grep bulk deletion skips protected matches inside the tool", async () => {
		const controller = createContextDeletionPlannerTool(createTranscript());

		const result = await controller.grepTool.execute("toolu_grep", {
			pattern: "Keep",
			target: "entry",
			maxMatches: 10,
		});

		expect(result.terminate).toBe(false);
		expect(controller.getPlan().deletions).toEqual([]);
		expect(result.details.matches).toEqual([]);
		expect(result.details.skipped).toEqual([
			expect.objectContaining({ entryId: "entry-user", reason: "protected_entry" }),
		]);
	});

	it("records grep bulk deletions through the planner agent", async () => {
		let continuationContext: Context | undefined;
		const faux = registerFauxProvider();
		cleanups.push(() => faux.unregister());
		faux.setResponses([
			() =>
				fauxAssistantMessage(
					fauxToolCall(
						"context_grep_delete",
						{ pattern: "Old", target: "entry", maxMatches: 10 },
						{ id: "toolu_grep" },
					),
					{ stopReason: "toolUse" },
				),
			(context) => {
				continuationContext = context;
				return fauxAssistantMessage("Done recording deletion targets.");
			},
		]);

		const plan = await planContextDeletions(createTranscript(), faux.getModel(), "test-key");

		expect(plan.deletions).toEqual([
			{ kind: "entry", entryId: "entry-old-1" },
			{ kind: "entry", entryId: "entry-old-2" },
		]);
		expect(faux.state.callCount).toBe(2);
		expect(continuationContext?.messages).toEqual(
			expect.arrayContaining([expect.objectContaining({ role: "toolResult", toolCallId: "toolu_grep" })]),
		);
	});
});
