import { describe, expect, it } from "vitest";
import { createHarness } from "../suite/harness.ts";


describe("AgentSession rewind restore guard", () => {
	it("refuses restore while streaming before delegating to the coordinator", async () => {
		const harness = await createHarness();
		try {
			Object.defineProperty(harness.session, "isStreaming", { configurable: true, get: () => true });
			let delegated = false;
			(harness.session as unknown as { _rewindCoordinator: { restoreFilesToCheckpoint: () => never } })._rewindCoordinator.restoreFilesToCheckpoint = () => {
				delegated = true;
				throw new Error("restore should not be delegated while streaming");
			};

			const restored = harness.session.restoreRewindFiles("checkpoint-id");

			expect(restored).toMatchObject({ ok: false, error: "RestoreWhileStreaming" });
			expect(restored.message).toContain("current turn finishes");
			expect(delegated).toBe(false);
		} finally {
			harness.cleanup();
		}
	});

	it("refuses restore while bash is running before delegating to the coordinator", async () => {
		const harness = await createHarness();
		try {
			Object.defineProperty(harness.session, "isStreaming", { configurable: true, get: () => false });
			Object.defineProperty(harness.session, "isBashRunning", { configurable: true, get: () => true });
			let delegated = false;
			(harness.session as unknown as { _rewindCoordinator: { restoreFilesToCheckpoint: () => never } })._rewindCoordinator.restoreFilesToCheckpoint = () => {
				delegated = true;
				throw new Error("restore should not be delegated while bash is running");
			};

			const restored = harness.session.restoreRewindFiles("checkpoint-id");

			expect(restored).toMatchObject({ ok: false, error: "RestoreWhileStreaming" });
			expect(restored.message).toContain("bash command finishes");
			expect(delegated).toBe(false);
		} finally {
			harness.cleanup();
		}
	});
});
