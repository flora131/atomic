import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_COMPACTION_SETTINGS,
	type CompactableTranscript,
	planContextDeletions,
} from "../src/core/compaction/index.ts";

function createTranscript(): CompactableTranscript {
	const message: AgentMessage = {
		role: "user",
		content: [{ type: "text", text: "Keep the user's task protected." }],
		timestamp: Date.now(),
	};
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
				message,
				toolCallIds: [],
			},
		],
		protectedEntryIds: ["entry-user"],
		tokensBefore: 8,
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

	it("asks the model for a structured context_deletion_plan tool call", async () => {
		let capturedContext: Context | undefined;
		const faux = registerFauxProvider();
		cleanups.push(() => faux.unregister());
		faux.setResponses([
			(context) => {
				capturedContext = context;
				return fauxAssistantMessage(
					fauxToolCall("context_deletion_plan", { deletions: [{ kind: "entry", entryId: "entry-old" }] }, { id: "toolu_plan" }),
					{ stopReason: "toolUse" },
				);
			},
		]);

		const plan = await planContextDeletions(createTranscript(), faux.getModel(), "test-key");

		expect(plan.deletions).toEqual([{ kind: "entry", entryId: "entry-old" }]);
		expect(capturedContext).toMatchObject({
			systemPrompt: expect.stringContaining("context_deletion_plan"),
			tools: [expect.objectContaining({ name: "context_deletion_plan" })],
		});
	});
});
