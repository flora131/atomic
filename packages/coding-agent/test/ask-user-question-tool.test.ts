import { describe, expect, it } from "vitest";
import { createAskUserQuestionToolDefinition } from "../src/core/tools/ask-user-question/index.ts";
import type { ExtensionUIContext } from "../src/core/extensions/types.ts";

const QUESTION_PARAMS = {
	questions: [
		{
			question: "Continue?",
			header: "Continue",
			options: [
				{ label: "Yes", description: "Continue now." },
				{ label: "No", description: "Stop here." },
			],
		},
	],
};

async function waitFor(condition: () => boolean, timeoutMs = 200): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

describe("ask_user_question tool", () => {
	it("passes the tool abort signal to its custom UI", async () => {
		const tool = createAskUserQuestionToolDefinition();
		const controller = new AbortController();
		const abortReason = new Error("interrupting stale question");
		let capturedSignal: AbortSignal | undefined;

		const ui = {
			custom: <T>(_factory: Parameters<ExtensionUIContext["custom"]>[0], options?: { signal?: AbortSignal }) => {
				capturedSignal = options?.signal;
				if (capturedSignal === undefined) {
					return Promise.resolve({ answers: [], cancelled: true } as T);
				}
				return new Promise<T>((_resolve, reject) => {
					capturedSignal?.addEventListener(
						"abort",
						() => reject(capturedSignal?.reason ?? new Error("aborted")),
						{ once: true },
					);
				});
			},
		} as Pick<ExtensionUIContext, "custom">;

		const execution = tool.execute(
			"ask-1",
			QUESTION_PARAMS,
			controller.signal,
			() => undefined,
			{ hasUI: true, ui } as Parameters<typeof tool.execute>[4],
		);

		await waitFor(() => capturedSignal !== undefined);
		expect(capturedSignal).toBe(controller.signal);

		controller.abort(abortReason);
		await expect(execution).rejects.toBe(abortReason);
	});
});
