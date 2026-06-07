import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { BashResult } from "../../src/core/bash-executor.js";
import { CheckpointEngine } from "../../src/core/rewind/checkpoint-engine.js";
import { RewindCoordinator, type RewindCoordinatorStatus } from "../../src/core/rewind/rewind-coordinator.js";
import type { CheckpointMetadata, Result, RewindSettings } from "../../src/core/rewind/types.js";

const defaultSettings: RewindSettings = {
	enabled: true,
	maxCheckpoints: 50,
	checkpointOnSessionStart: true,
	checkpointOnMutatingTurn: true,
	promptOnTree: true,
	promptOnFork: true,
	maxUntrackedFileBytes: 10 * 1024 * 1024,
	maxUntrackedDirFiles: 200,
	ignoredDirNames: ["node_modules"],
};

function tempRepo(): string {
	const dir = join(tmpdir(), `atomic-rewind-coordinator-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	git(dir, ["init"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test User"]);
	writeFileSync(join(dir, "file.txt"), "v1\n");
	git(dir, ["add", "file.txt"]);
	git(dir, ["commit", "-m", "init"]);
	return dir;
}

function tempDir(): string {
	const dir = join(tmpdir(), `atomic-rewind-nongit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	return result.stdout;
}

function checkpointRefCount(repo: string, sessionId: string): number {
	return git(repo, ["for-each-ref", `refs/atomic-checkpoints/${sessionId}`, "--format=%(refname)"])
		.trim()
		.split("\n")
		.filter(Boolean).length;
}

function settingsWithoutSessionStart(overrides: Partial<RewindSettings> = {}): RewindSettings {
	return { ...defaultSettings, checkpointOnSessionStart: false, ...overrides };
}

function expectCreatedCheckpoint(result: Result<CheckpointMetadata | null>): CheckpointMetadata {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.error);
	expect(result.value).not.toBeNull();
	if (!result.value) throw new Error("checkpoint not created");
	return result.value;
}

function bashResult(output = ""): BashResult {
	return { output, exitCode: 0, cancelled: false, truncated: false };
}

function waitPastTimestamp(): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
}

describe("RewindCoordinator", () => {
	const cleanup: string[] = [];
	afterEach(() => {
		for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("does not report enabled rewind as disabled before initialization", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });

		expect(coordinator.getStatus()).toMatchObject({ state: "unavailable", checkpointCount: 0 });
	});

	it("initializes as unavailable outside Git without throwing", () => {
		const dir = tempDir();
		cleanup.push(dir);
		const statuses: RewindCoordinatorStatus[] = [];
		const coordinator = new RewindCoordinator({
			cwd: dir,
			sessionId: "session-1",
			settings: defaultSettings,
			onStatusChange: (status) => statuses.push(status),
		});

		const initialized = coordinator.initialize();

		expect(initialized).toMatchObject({ ok: false, error: "NotGitRepository" });
		expect(coordinator.getStatus()).toMatchObject({ state: "unavailable", checkpointCount: 0 });
		expect(statuses.at(-1)).toMatchObject({ state: "unavailable", checkpointCount: 0 });
	});

	it("lists existing checkpoints without creating a session-start checkpoint", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "unlisted\n");
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });

		const listed = coordinator.listCheckpoints();

		expect(listed).toMatchObject({ ok: true, value: [] });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 0 });
	});

	it("creates a resume checkpoint when enabled", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "resume\n");
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });

		const initialized = coordinator.initialize({ turnIndex: 0, leafEntryId: "leaf-1" });

		expect(initialized.ok).toBe(true);
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
		expect(coordinator.getFooterStatusText()).toBe("◆ 1 checkpoint");
		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value[0]).toMatchObject({ trigger: "resume", leafEntryId: "leaf-1" });
	});

	it("ignores read-only and unknown tools", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "read" });
		coordinator.observeToolExecutionEnd({ toolName: "grep" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-2" });

		expect(finalized).toMatchObject({ ok: true, value: null });
		expect(coordinator.getStatus()).toMatchObject({ state: "unavailable", checkpointCount: 0 });
	});

	it("creates a checkpoint for failed bash when files changed", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});
		writeFileSync(join(repo, "file.txt"), "failed bash mutation\n");

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "bash" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-2" });

		const checkpoint = expectCreatedCheckpoint(finalized);
		expect(checkpoint).toMatchObject({ trigger: "turn", leafEntryId: "leaf-2", toolNames: ["bash"] });
	});

	it("dedupes failed bash when files did not change", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });
		expect(coordinator.initialize().ok).toBe(true);

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "bash" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-2" });

		expect(finalized).toMatchObject({ ok: true, value: null });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
	});

	it("creates a checkpoint for failed write when files changed", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});
		writeFileSync(join(repo, "file.txt"), "failed write mutation\n");

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-2" });

		const checkpoint = expectCreatedCheckpoint(finalized);
		expect(checkpoint).toMatchObject({ trigger: "turn", leafEntryId: "leaf-2", toolNames: ["write"] });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
	});

	it("creates a checkpoint for failed edit when files changed", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});
		writeFileSync(join(repo, "file.txt"), "failed edit mutation\n");

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "edit" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-2" });

		const checkpoint = expectCreatedCheckpoint(finalized);
		expect(checkpoint).toMatchObject({ trigger: "turn", leafEntryId: "leaf-2", toolNames: ["edit"] });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
	});

	it("dedupes failed write and edit when files did not change after a matching checkpoint", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });
		expect(coordinator.initialize().ok).toBe(true);

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const finalizedWrite = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-2" });

		expect(finalizedWrite).toMatchObject({ ok: true, value: null });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "edit" });
		const finalizedEdit = coordinator.finalizeTurnCheckpoint({ turnIndex: 2, leafEntryId: "leaf-3" });

		expect(finalizedEdit).toMatchObject({ ok: true, value: null });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
	});

	it("creates one deduped checkpoint for multiple successful mutating tools in one turn", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});
		writeFileSync(join(repo, "file.txt"), "turn\n");
		writeFileSync(join(repo, "new.txt"), "new\n");

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		coordinator.observeToolExecutionEnd({ toolName: "edit" });
		coordinator.observeToolExecutionEnd({ toolName: "bash" });
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 2, leafEntryId: "leaf-3" });

		const checkpoint = expectCreatedCheckpoint(finalized);
		expect(checkpoint).toMatchObject({
			trigger: "turn",
			turnIndex: 2,
			leafEntryId: "leaf-3",
			toolNames: ["bash", "edit", "write"],
		});
		expect(coordinator.getFooterStatusText()).toBe("◆ 1 checkpoint");
	});

	it("dedupes a mutating turn with no file delta", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });
		expect(coordinator.initialize().ok).toBe(true);

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "bash" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-2" });

		expect(finalized).toMatchObject({ ok: true, value: null });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
	});

	it("creates a checkpoint for an interactive bash result only after a prepared mutation", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});
		expect(
			coordinator.prepareInteractiveBashCheckpoint({
				command: "printf changed > file.txt",
				turnIndex: 3,
				leafEntryId: "leaf-bash",
			}),
		).toMatchObject({ ok: true, value: expect.objectContaining({ tokenId: expect.any(String) }) });
		writeFileSync(join(repo, "file.txt"), "interactive bash mutation\n");

		const checkpointed = coordinator.checkpointInteractiveBashResult({
			command: "printf changed > file.txt",
			result: bashResult(),
			turnIndex: 3,
			leafEntryId: "leaf-bash",
		});
		const deduped = coordinator.checkpointInteractiveBashResult({
			command: "pwd",
			result: bashResult(repo),
			turnIndex: 3,
			leafEntryId: "leaf-bash",
		});

		const checkpoint = expectCreatedCheckpoint(checkpointed);
		expect(checkpoint).toMatchObject({
			trigger: "turn",
			turnIndex: 3,
			leafEntryId: "leaf-bash",
			description: "Interactive bash: printf changed > file.txt",
			toolNames: ["bash"],
		});
		expect(deduped).toMatchObject({ ok: true, value: null });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
	});

	it("does not create a first interactive bash checkpoint for clean read-only state", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });
		expect(
			coordinator.prepareInteractiveBashCheckpoint({
				command: "pwd",
				turnIndex: 1,
				leafEntryId: "leaf-clean-bash",
			}),
		).toMatchObject({ ok: true, value: expect.objectContaining({ tokenId: expect.any(String) }) });

		const checkpointed = coordinator.checkpointInteractiveBashResult({
			command: "pwd",
			result: bashResult(repo),
			turnIndex: 1,
			leafEntryId: "leaf-clean-bash",
		});

		expect(checkpointed).toMatchObject({ ok: true, value: null });
		expect(coordinator.listCheckpoints()).toMatchObject({ ok: true, value: [] });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 0 });
	});

	it("does not create a first interactive bash checkpoint for dirty read-only state", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "dirty before bash\n");
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });
		expect(
			coordinator.prepareInteractiveBashCheckpoint({
				command: "git status --short",
				turnIndex: 1,
				leafEntryId: "leaf-dirty-readonly",
			}),
		).toMatchObject({ ok: true, value: expect.objectContaining({ tokenId: expect.any(String) }) });

		const checkpointed = coordinator.checkpointInteractiveBashResult({
			command: "git status --short",
			result: bashResult(" M file.txt\n"),
			turnIndex: 1,
			leafEntryId: "leaf-dirty-readonly",
		});

		expect(checkpointed).toMatchObject({ ok: true, value: null });
		expect(coordinator.listCheckpoints()).toMatchObject({ ok: true, value: [] });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 0 });
	});

	it("creates a first interactive bash checkpoint for a dirty mutating command", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "dirty before bash\n");
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });
		expect(
			coordinator.prepareInteractiveBashCheckpoint({
				command: "printf mutation > created-by-bash.txt",
				turnIndex: 1,
				leafEntryId: "leaf-dirty-mutating",
			}),
		).toMatchObject({ ok: true, value: expect.objectContaining({ tokenId: expect.any(String) }) });
		writeFileSync(join(repo, "created-by-bash.txt"), "mutation\n");

		const checkpointed = coordinator.checkpointInteractiveBashResult({
			command: "printf mutation > created-by-bash.txt",
			result: bashResult(),
			turnIndex: 1,
			leafEntryId: "leaf-dirty-mutating",
		});

		const checkpoint = expectCreatedCheckpoint(checkpointed);
		expect(checkpoint).toMatchObject({ trigger: "turn", toolNames: ["bash"], leafEntryId: "leaf-dirty-mutating" });
		expect(coordinator.listCheckpoints()).toMatchObject({ ok: true, value: [expect.objectContaining({ id: checkpoint.id })] });
	});

	it("does not create interactive bash checkpoints when mutating-turn checkpointing is disabled", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ checkpointOnMutatingTurn: false }),
		});
		writeFileSync(join(repo, "file.txt"), "disabled bash mutation\n");

		const checkpointed = coordinator.checkpointInteractiveBashResult({
			command: "printf changed > file.txt",
			result: bashResult(),
			turnIndex: 1,
			leafEntryId: "leaf-disabled",
		});

		expect(checkpointed).toMatchObject({ ok: true, value: null });
		expect(coordinator.listCheckpoints()).toMatchObject({ ok: true, value: [] });
	});

	it("creates an interactive bash checkpoint instead of a lazy session-start checkpoint", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });
		expect(
			coordinator.prepareInteractiveBashCheckpoint({
				command: "printf changed > file.txt",
				turnIndex: 1,
				leafEntryId: "leaf-first-bash",
			}),
		).toMatchObject({ ok: true, value: expect.objectContaining({ tokenId: expect.any(String) }) });
		writeFileSync(join(repo, "file.txt"), "first bash mutation\n");

		const checkpointed = coordinator.checkpointInteractiveBashResult({
			command: "printf changed > file.txt",
			result: bashResult(),
			turnIndex: 1,
			leafEntryId: "leaf-first-bash",
		});

		const checkpoint = expectCreatedCheckpoint(checkpointed);
		expect(checkpoint).toMatchObject({ trigger: "turn", toolNames: ["bash"], leafEntryId: "leaf-first-bash" });
		expect(coordinator.listCheckpoints()).toMatchObject({ ok: true, value: [expect.objectContaining({ id: checkpoint.id })] });
	});

	it("does not use dirty fallback for direct interactive bash checkpointing without a baseline", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "dirty before direct record\n");
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });

		const checkpointed = coordinator.checkpointInteractiveBashResult({
			command: "git status --short",
			result: bashResult(" M file.txt\n"),
			turnIndex: 1,
			leafEntryId: "leaf-direct",
		});

		expect(checkpointed).toMatchObject({ ok: true, value: null });
		expect(coordinator.listCheckpoints()).toMatchObject({ ok: true, value: [] });
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 0 });
	});

	it("clears a pending interactive bash baseline after a no-op result", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });
		expect(
			coordinator.prepareInteractiveBashCheckpoint({
				command: "pwd",
				turnIndex: 1,
				leafEntryId: "leaf-noop",
			}),
		).toMatchObject({ ok: true, value: expect.objectContaining({ tokenId: expect.any(String) }) });
		expect(
			coordinator.checkpointInteractiveBashResult({
				command: "pwd",
				result: bashResult(repo),
				turnIndex: 1,
				leafEntryId: "leaf-noop",
			}),
		).toMatchObject({ ok: true, value: null });
		writeFileSync(join(repo, "file.txt"), "mutation after noop\n");

		const directAfterNoop = coordinator.checkpointInteractiveBashResult({
			command: "pwd",
			result: bashResult(repo),
			turnIndex: 2,
			leafEntryId: "leaf-after-noop",
		});

		expect(directAfterNoop).toMatchObject({ ok: true, value: null });
		expect(coordinator.listCheckpoints()).toMatchObject({ ok: true, value: [] });
	});

	it("clears a pending interactive bash baseline after checkpoint creation", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({ cwd: repo, sessionId: "session-1", settings: defaultSettings });
		expect(
			coordinator.prepareInteractiveBashCheckpoint({
				command: "printf changed > file.txt",
				turnIndex: 1,
				leafEntryId: "leaf-create",
			}),
		).toMatchObject({ ok: true, value: expect.objectContaining({ tokenId: expect.any(String) }) });
		writeFileSync(join(repo, "file.txt"), "mutation after prepare\n");
		expectCreatedCheckpoint(
			coordinator.checkpointInteractiveBashResult({
				command: "printf changed > file.txt",
				result: bashResult(),
				turnIndex: 1,
				leafEntryId: "leaf-create",
			}),
		);
		writeFileSync(join(repo, "after-create.txt"), "second mutation\n");

		const directAfterCreate = coordinator.checkpointInteractiveBashResult({
			command: "printf second > after-create.txt",
			result: bashResult(),
			turnIndex: 2,
			leafEntryId: "leaf-after-create",
		});

		expect(directAfterCreate).toMatchObject({ ok: true, value: null });
		expect(coordinator.listCheckpoints()).toMatchObject({ ok: true, value: [expect.objectContaining({ leafEntryId: "leaf-create" })] });
	});

	it("re-enables initialization and checkpointing after settings change from disabled to enabled", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ enabled: false }),
		});
		expect(coordinator.getStatus()).toMatchObject({ state: "disabled", checkpointCount: 0 });

		coordinator.updateSettings(settingsWithoutSessionStart({ enabled: true }));
		writeFileSync(join(repo, "file.txt"), "enabled\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-1" });

		expectCreatedCheckpoint(finalized);
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
	});

	it("passes snapshot policy through when creating turn checkpoints", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "large.bin"), "x".repeat(16));
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxUntrackedFileBytes: 8 }),
		});

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-1" });

		const checkpoint = expectCreatedCheckpoint(finalized);
		expect(checkpoint.skippedLargeFiles).toEqual(["large.bin"]);
		expect(checkpoint.snapshotPolicy).toMatchObject({ maxUntrackedFileBytes: 8 });
	});

	it("prunes oldest non-safety checkpoints beyond maxCheckpoints", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 2 }),
		});

		for (let index = 0; index < 3; index++) {
			writeFileSync(join(repo, "file.txt"), `turn-${index}\n`);
			coordinator.startTurn();
			coordinator.observeToolExecutionEnd({ toolName: "write" });
			expect(coordinator.finalizeTurnCheckpoint({ turnIndex: index, leafEntryId: `leaf-${index}` }).ok).toBe(true);
		}

		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toHaveLength(2);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("turn-2\n");
	});

	it("prunes immediately when maxCheckpoints is lowered after initialization", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 5 }),
		});

		for (let index = 0; index < 3; index++) {
			writeFileSync(join(repo, "file.txt"), `turn-${index}\n`);
			coordinator.startTurn();
			coordinator.observeToolExecutionEnd({ toolName: "write" });
			expect(coordinator.finalizeTurnCheckpoint({ turnIndex: index, leafEntryId: `leaf-${index}` }).ok).toBe(true);
		}

		coordinator.updateSettings(settingsWithoutSessionStart({ maxCheckpoints: 1 }));

		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toHaveLength(1);
		expect(checkpointRefCount(repo, "session-1")).toBe(1);
	});

	it("prunes stale before-restore checkpoints immediately when maxCheckpoints is lowered", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 5 }),
		});
		writeFileSync(join(repo, "file.txt"), "target\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		waitPastTimestamp();
		writeFileSync(join(repo, "file.txt"), "before restore\n");
		const restored = coordinator.restoreFilesToCheckpoint(target.id, { turnIndex: 2, leafEntryId: "leaf-restore" });
		expect(restored.ok).toBe(true);
		let listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		const safety = listed.value.find((checkpoint) => checkpoint.trigger === "before-restore");
		expect(safety).toBeDefined();
		waitPastTimestamp();
		writeFileSync(join(repo, "file.txt"), "newest turn\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		expect(coordinator.finalizeTurnCheckpoint({ turnIndex: 3, leafEntryId: "leaf-newest" }).ok).toBe(true);

		coordinator.updateSettings(settingsWithoutSessionStart({ maxCheckpoints: 1 }));

		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
		listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toHaveLength(1);
		expect(listed.value[0]?.id).not.toBe(safety?.id);
		expect(checkpointRefCount(repo, "session-1")).toBe(1);
	});

	it("normal pruning counts stale before-restore checkpoints against maxCheckpoints", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		writeFileSync(join(repo, "file.txt"), "safety\n");
		const safety = engine.createCheckpoint({ trigger: "before-restore" });
		expect(safety.ok).toBe(true);
		if (!safety.ok) throw new Error(safety.error);
		waitPastTimestamp();
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 1 }),
		});

		for (let index = 0; index < 2; index++) {
			writeFileSync(join(repo, "file.txt"), `turn-${index}\n`);
			coordinator.startTurn();
			coordinator.observeToolExecutionEnd({ toolName: "write" });
			expect(coordinator.finalizeTurnCheckpoint({ turnIndex: index, leafEntryId: `leaf-${index}` }).ok).toBe(true);
		}

		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toHaveLength(1);
		expect(listed.value.some((checkpoint) => checkpoint.id === safety.value.id)).toBe(false);
	});

	it("retains restored target with before-restore safety when capacity allows", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 2 }),
		});
		writeFileSync(join(repo, "file.txt"), "target checkpoint\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		waitPastTimestamp();
		writeFileSync(join(repo, "file.txt"), "newer checkpoint\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 2, leafEntryId: "leaf-newer" }));
		waitPastTimestamp();
		writeFileSync(join(repo, "file.txt"), "before restore\n");

		const restored = coordinator.restoreFilesToCheckpoint(target.id, { turnIndex: 3, leafEntryId: "leaf-restore" });

		expect(restored.ok).toBe(true);
		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toHaveLength(2);
		expect(listed.value).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: target.id, trigger: "turn", leafEntryId: "leaf-target" }),
				expect.objectContaining({ trigger: "before-restore", leafEntryId: "leaf-restore", description: `Before rewind to ${target.id}` }),
			]),
		);
	});

	it("restores with maxCheckpoints 1 and leaves a before-restore undo checkpoint", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 1 }),
		});
		writeFileSync(join(repo, "file.txt"), "target checkpoint\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		writeFileSync(join(repo, "file.txt"), "undo checkpoint\n");

		const restored = coordinator.restoreFilesToCheckpoint(target.id, { turnIndex: 2, leafEntryId: "leaf-restore" });

		expect(restored.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("target checkpoint\n");
		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toEqual([
			expect.objectContaining({ trigger: "before-restore", leafEntryId: "leaf-restore", description: `Before rewind to ${target.id}` }),
		]);

		const undoSafetyId = listed.value[0]!.id;
		const undo = coordinator.restoreFilesToCheckpoint(undoSafetyId, { turnIndex: 3, leafEntryId: "leaf-undo" });
		expect(undo.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("undo checkpoint\n");
		const afterUndo = coordinator.listCheckpoints();
		expect(afterUndo.ok).toBe(true);
		if (!afterUndo.ok) throw new Error(afterUndo.error);
		expect(afterUndo.value).toEqual([
			expect.objectContaining({ trigger: "before-restore", leafEntryId: "leaf-undo", description: `Before rewind to ${undoSafetyId}` }),
		]);
	});

	it("does not create or retain a safety checkpoint for a missing restore target", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 1 }),
		});
		writeFileSync(join(repo, "file.txt"), "target\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		waitPastTimestamp();
		writeFileSync(join(repo, "file.txt"), "before failed restore\n");

		const restored = coordinator.restoreFilesToCheckpoint("missing-checkpoint", { turnIndex: 2, leafEntryId: "leaf-failed-restore" });

		expect(restored).toMatchObject({ ok: false, error: "CheckpointNotFound" });
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("before failed restore\n");
		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toEqual([expect.objectContaining({ id: target.id, trigger: "turn", leafEntryId: "leaf-target" })]);
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
	});

	it("preserves the requested target and prunes transient safety after restore refusal", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 1 }),
		});
		writeFileSync(join(repo, "file.txt"), "target\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		waitPastTimestamp();
		writeFileSync(join(repo, "file.txt"), "moved head\n");
		git(repo, ["add", "file.txt"]);
		git(repo, ["commit", "-m", "move head"]);
		writeFileSync(join(repo, "file.txt"), "before refused restore\n");

		const restored = coordinator.restoreFilesToCheckpoint(target.id, { turnIndex: 2, leafEntryId: "leaf-failed-restore" });

		expect(restored).toMatchObject({ ok: false, error: "HeadMoved" });
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("before refused restore\n");
		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toEqual([expect.objectContaining({ id: target.id, trigger: "turn", leafEntryId: "leaf-target" })]);
		expect(listed.value.some((checkpoint) => checkpoint.trigger === "before-restore")).toBe(false);
		expect(coordinator.getStatus()).toMatchObject({ state: "ready", checkpointCount: 1 });
	});

	it("dedupes no-op mutating turns against the restored target after restore", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 5 }),
		});
		writeFileSync(join(repo, "file.txt"), "target\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		waitPastTimestamp();
		writeFileSync(join(repo, "file.txt"), "newer\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 2, leafEntryId: "leaf-newer" }));
		waitPastTimestamp();
		writeFileSync(join(repo, "file.txt"), "before restore\n");
		expect(coordinator.restoreFilesToCheckpoint(target.id, { turnIndex: 3, leafEntryId: "leaf-restore" }).ok).toBe(true);
		const beforeNoop = coordinator.listCheckpoints();
		expect(beforeNoop.ok).toBe(true);
		if (!beforeNoop.ok) throw new Error(beforeNoop.error);

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 4, leafEntryId: "leaf-noop" });

		expect(finalized).toMatchObject({ ok: true, value: null });
		const afterNoop = coordinator.listCheckpoints();
		expect(afterNoop.ok).toBe(true);
		if (!afterNoop.ok) throw new Error(afterNoop.error);
		expect(afterNoop.value.map((checkpoint) => checkpoint.id).sort()).toEqual(beforeNoop.value.map((checkpoint) => checkpoint.id).sort());
	});

	it("clears the restored baseline after a real checkpoint", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxCheckpoints: 5 }),
		});
		writeFileSync(join(repo, "file.txt"), "target\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		writeFileSync(join(repo, "file.txt"), "before restore\n");
		expect(coordinator.restoreFilesToCheckpoint(target.id, { turnIndex: 2, leafEntryId: "leaf-restore" }).ok).toBe(true);
		writeFileSync(join(repo, "file.txt"), "after restore mutation\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const created = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 3, leafEntryId: "leaf-after-restore" }));

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const noop = coordinator.finalizeTurnCheckpoint({ turnIndex: 4, leafEntryId: "leaf-after-restore-noop" });

		expect(created).toMatchObject({ leafEntryId: "leaf-after-restore" });
		expect(noop).toMatchObject({ ok: true, value: null });
		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value.filter((checkpoint) => checkpoint.leafEntryId === "leaf-after-restore")).toHaveLength(1);
		expect(listed.value.some((checkpoint) => checkpoint.leafEntryId === "leaf-after-restore-noop")).toBe(false);
	});

	it("dedupes the first mutating turn against the initialization baseline instead of stale refs", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		writeFileSync(join(repo, "file.txt"), "stale checkpoint\n");
		const stale = engine.createCheckpoint({ trigger: "turn", leafEntryId: "leaf-stale" });
		expect(stale.ok).toBe(true);
		if (!stale.ok) throw new Error(stale.error);
		writeFileSync(join(repo, "file.txt"), "session start dirty\n");
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});
		expect(coordinator.initialize({ turnIndex: 0, leafEntryId: "leaf-start" })).toMatchObject({ ok: true, value: null });

		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const finalized = coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-noop" });

		expect(finalized).toMatchObject({ ok: true, value: null });
		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toEqual([expect.objectContaining({ id: stale.value.id, leafEntryId: "leaf-stale" })]);
	});

	it("previews and restores files through a before-restore safety checkpoint", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});
		writeFileSync(join(repo, "file.txt"), "checkpoint\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		writeFileSync(join(repo, "file.txt"), "local before restore\n");

		const previewed = coordinator.previewCheckpoint(target.id);
		expect(previewed.ok).toBe(true);
		if (!previewed.ok) throw new Error(previewed.error);
		expect(previewed.value.text).toContain("local before restore");

		const restored = coordinator.restoreFilesToCheckpoint(target.id, { turnIndex: 2, leafEntryId: "leaf-restore" });

		expect(restored.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("checkpoint\n");
		const listed = coordinator.listCheckpoints();
		expect(listed.ok).toBe(true);
		if (!listed.ok) throw new Error(listed.error);
		expect(listed.value).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ trigger: "before-restore", leafEntryId: "leaf-restore", description: `Before rewind to ${target.id}` }),
			]),
		);
	});

	it("uses current snapshot settings when previewing cleanup candidates", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart({ maxUntrackedFileBytes: 4 }),
		});
		writeFileSync(join(repo, "file.txt"), "checkpoint\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		writeFileSync(join(repo, "large-later.txt"), "x".repeat(16));

		const previewed = coordinator.previewCheckpoint(target.id);

		expect(previewed.ok).toBe(true);
		if (!previewed.ok) throw new Error(previewed.error);
		expect(previewed.value.removedUntrackedFiles).toEqual([]);
		expect(previewed.value.text).not.toContain("large-later.txt");
	});

	it("continues restore when the current state already has an unchanged checkpoint", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});
		writeFileSync(join(repo, "file.txt"), "target\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		writeFileSync(join(repo, "file.txt"), "already checkpointed safety\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 2, leafEntryId: "leaf-safety" }));

		const restored = coordinator.restoreFilesToCheckpoint(target.id, { turnIndex: 3, leafEntryId: "leaf-restore" });

		expect(restored.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("target\n");
	});

	it("refuses restore when creating the safety checkpoint fails for a real reason", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const coordinator = new RewindCoordinator({
			cwd: repo,
			sessionId: "session-1",
			settings: settingsWithoutSessionStart(),
		});
		writeFileSync(join(repo, "file.txt"), "target\n");
		coordinator.startTurn();
		coordinator.observeToolExecutionEnd({ toolName: "write" });
		const target = expectCreatedCheckpoint(coordinator.finalizeTurnCheckpoint({ turnIndex: 1, leafEntryId: "leaf-target" }));
		writeFileSync(join(repo, "file.txt"), "must stay local\n");
		writeFileSync(join(repo, "bad\\name.txt"), "unsafe path\n");

		const restored = coordinator.restoreFilesToCheckpoint(target.id, { turnIndex: 2, leafEntryId: "leaf-restore" });

		expect(restored).toMatchObject({ ok: false, error: "UnsafePath" });
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("must stay local\n");
	});
});
