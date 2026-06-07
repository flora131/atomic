import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckpointEngine } from "../../src/core/rewind/checkpoint-engine.js";

const CHECKPOINT_SIGNATURE = "Atomic Checkpoint <atomic-checkpoint@bastani.invalid>";

function checkpointIdentity(cwd: string, ref: string): string {
	return git(cwd, ["show", "-s", "--format=%an <%ae>%n%cn <%ce>", ref]);
}

function tempRepo(): string {
	const dir = join(tmpdir(), `atomic-checkpoint-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	git(dir, ["init"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test User"]);
	writeFileSync(join(dir, "file.txt"), "v1\n");
	writeFileSync(join(dir, "delete-me.txt"), "delete me\n");
	git(dir, ["add", "file.txt", "delete-me.txt"]);
	git(dir, ["commit", "-m", "init"]);
	return dir;
}

function git(cwd: string, args: string[], input?: string): string {
	const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", input });
	if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	return result.stdout;
}

type TestGitOptions = { readonly cwd?: string; readonly input?: string; readonly literalPathspecs?: boolean };
type TestGitResult = { readonly ok: boolean; readonly stdout: string; readonly stderr: string; readonly gitMissing?: boolean };
type TestGit = (args: string[], options?: TestGitOptions) => TestGitResult;
type CheckpointEngineWithTestGit = CheckpointEngine & { git: TestGit };

function replaceEngineGitForTest(engine: CheckpointEngine, replacement: (args: string[], options: TestGitOptions | undefined, realGit: TestGit) => TestGitResult): void {
	const mutableEngine = engine as CheckpointEngineWithTestGit;
	const realGit = mutableEngine.git.bind(engine);
	mutableEngine.git = (args, options) => replacement(args, options, realGit);
}

function treeFiles(cwd: string, treeSha: string): string[] {
	return git(cwd, ["ls-tree", "-r", "--name-only", treeSha]).split("\n").filter(Boolean).sort();
}

function treeEntryMode(cwd: string, treeSha: string, path: string): string {
	const entry = git(cwd, ["ls-tree", treeSha, "--", path]).trim();
	return entry.split(/\s+/)[0] ?? "";
}

function checkpointRef(sessionId: string, checkpointId: string): string {
	return `refs/atomic-checkpoints/${sessionId}/${checkpointId}`;
}

function trySymlink(target: string, path: string): boolean {
	try {
		symlinkSync(target, path);
		return true;
	} catch {
		return false;
	}
}

describe("CheckpointEngine", () => {
	const cleanup: string[] = [];
	afterEach(() => {
		for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("creates, lists, diffs, and restores a git-ref-backed checkpoint", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "v2\n");
		writeFileSync(join(repo, "new.txt"), "new\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn", leafEntryId: "leaf-1", description: "changed file", toolNames: ["write"] });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.worktreeTreeSha).toMatch(/^[a-f0-9]{40}$/);

		const refs = git(repo, ["for-each-ref", "refs/atomic-checkpoints/session-1", "--format=%(refname)"]);
		expect(refs).toContain(created.value.id);
		expect(engine.listCheckpoints()).toMatchObject({ ok: true, value: [expect.objectContaining({ id: created.value.id, leafEntryId: "leaf-1" })] });

		rmSync(join(repo, "new.txt"));
		writeFileSync(join(repo, "file.txt"), "v3\n");
		const diff = engine.previewDiff(created.value.id);
		expect(diff.ok).toBe(true);
		if (!diff.ok) throw new Error(diff.error);
		expect(diff.value.text).toContain("v3");

		const restored = engine.restoreCheckpoint(created.value.id);
		expect(restored.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("v2\n");
		expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe("new\n");
	});

	it("sanitizes hyphen-padded session ids for checkpoint refs", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "session id sanitized\n");
		const padding = "-".repeat(2048);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: `${padding}session-1${padding}` });

		const created = engine.createCheckpoint({ trigger: "turn" });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		const refs = git(repo, ["for-each-ref", "refs/atomic-checkpoints/session-1", "--format=%(refname)"]);
		expect(refs).toContain(created.value.id);
	});

	it("roots the worktree tree at the checkpoint ref and the index tree at the parent commit", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "staged content\n");
		git(repo, ["add", "file.txt"]);
		writeFileSync(join(repo, "file.txt"), "worktree content\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		const ref = checkpointRef("session-1", created.value.id);
		expect(git(repo, ["rev-parse", `${ref}^{tree}`]).trim()).toBe(created.value.worktreeTreeSha);
		expect(git(repo, ["rev-parse", `${ref}^1^{tree}`]).trim()).toBe(created.value.indexTreeSha);
		expect(checkpointIdentity(repo, ref)).toBe(`${CHECKPOINT_SIGNATURE}\n${CHECKPOINT_SIGNATURE}\n`);
	});

	it("keeps the saved index tree reachable after reflog expiry and git gc", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "staged content\n");
		git(repo, ["add", "file.txt"]);
		writeFileSync(join(repo, "file.txt"), "worktree content\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		const ref = checkpointRef("session-1", created.value.id);
		expect(created.value.indexTreeSha).not.toBe(created.value.worktreeTreeSha);
		expect(git(repo, ["rev-parse", `${ref}^{tree}`]).trim()).toBe(created.value.worktreeTreeSha);
		expect(git(repo, ["rev-parse", `${ref}^1^{tree}`]).trim()).toBe(created.value.indexTreeSha);

		git(repo, ["reset", "--hard", "HEAD"]);
		git(repo, ["reflog", "expire", "--expire=now", "--expire-unreachable=now", "--all"]);
		git(repo, ["gc", "--prune=now"]);

		expect(git(repo, ["cat-file", "-e", `${created.value.indexTreeSha}^{tree}`])).toBe("");
		expect(git(repo, ["rev-parse", `${ref}^1^{tree}`]).trim()).toBe(created.value.indexTreeSha);
	});

	it("creates checkpoints when user.useConfigOnly is true and no user identity is configured", () => {
		const repo = join(tmpdir(), `atomic-checkpoint-no-identity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(repo, { recursive: true });
		cleanup.push(repo);
		git(repo, ["init"]);
		writeFileSync(join(repo, "file.txt"), "v1\n");
		git(repo, ["add", "file.txt"]);
		git(repo, ["-c", "user.name=Initial User", "-c", "user.email=initial@example.com", "commit", "-m", "init"]);
		git(repo, ["config", "user.useConfigOnly", "true"]);
		writeFileSync(join(repo, "file.txt"), "checkpoint without configured identity\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(checkpointIdentity(repo, checkpointRef("session-1", created.value.id))).toBe(`${CHECKPOINT_SIGNATURE}\n${CHECKPOINT_SIGNATURE}\n`);
	});

	it("fails restore before mutating the worktree when the saved index tree is missing", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const branch = git(repo, ["branch", "--show-current"]).trim();
		const headSha = git(repo, ["rev-parse", "HEAD"]).trim();
		const tree = git(repo, ["rev-parse", "HEAD^{tree}"]).trim();
		const metadata = {
			version: 1,
			id: "missing-index-tree",
			sessionId: "session-1",
			leafEntryId: null,
			trigger: "turn",
			turnIndex: 0,
			description: "missing index tree",
			toolNames: [],
			branch,
			headSha,
			indexTreeSha: "1111111111111111111111111111111111111111",
			worktreeTreeSha: tree,
			timestamp: Date.now(),
			preexistingUntrackedFiles: [],
			skippedLargeFiles: [],
			skippedLargeDirs: [],
			skippedIgnoredDirs: [],
		};
		const commit = git(repo, ["commit-tree", tree], JSON.stringify(metadata)).trim();
		git(repo, ["update-ref", checkpointRef("session-1", metadata.id), commit]);
		writeFileSync(join(repo, "file.txt"), "local sentinel\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const restored = engine.restoreCheckpoint(metadata.id);

		expect(restored).toMatchObject({ ok: false, error: "CheckpointObjectMissing" });
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local sentinel\n");
	});

	it("rolls back worktree and index when final index restore fails", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "target staged\n");
		git(repo, ["add", "file.txt"]);
		writeFileSync(join(repo, "file.txt"), "target worktree\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const target = engine.createCheckpoint({ trigger: "turn" });
		expect(target.ok).toBe(true);
		if (!target.ok) throw new Error(target.error);
		writeFileSync(join(repo, "file.txt"), "before staged\n");
		git(repo, ["add", "file.txt"]);
		writeFileSync(join(repo, "file.txt"), "before worktree\n");
		const statusBefore = git(repo, ["status", "--porcelain=v1"]);
		const stagedDiffBefore = git(repo, ["diff", "--cached", "--", "file.txt"]);
		const unstagedDiffBefore = git(repo, ["diff", "--", "file.txt"]);
		let failedIndexRestore = false;
		replaceEngineGitForTest(engine, (args, options, realGit) => {
			if (!failedIndexRestore && args.length === 3 && args[0] === "read-tree" && args[1] === "--reset" && args[2] === target.value.indexTreeSha) {
				failedIndexRestore = true;
				return { ok: false, stdout: "", stderr: "injected index restore failure", gitMissing: false };
			}
			return realGit(args, options);
		});

		const restored = engine.restoreCheckpoint(target.value.id);

		expect(restored).toMatchObject({ ok: false, error: "RestoreFailed" });
		expect(failedIndexRestore).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("before worktree\n");
		expect(git(repo, ["status", "--porcelain=v1"])).toBe(statusBefore);
		expect(git(repo, ["diff", "--cached", "--", "file.txt"])).toBe(stagedDiffBefore);
		expect(git(repo, ["diff", "--", "file.txt"])).toBe(unstagedDiffBefore);
	});

	it("rolls back worktree and index when first worktree restore fails after partial mutation", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "target staged\n");
		git(repo, ["add", "file.txt"]);
		writeFileSync(join(repo, "file.txt"), "target worktree\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const target = engine.createCheckpoint({ trigger: "turn" });
		expect(target.ok).toBe(true);
		if (!target.ok) throw new Error(target.error);
		writeFileSync(join(repo, "file.txt"), "before staged\n");
		git(repo, ["add", "file.txt"]);
		writeFileSync(join(repo, "file.txt"), "before worktree\n");
		const statusBefore = git(repo, ["status", "--porcelain=v1"]);
		const stagedDiffBefore = git(repo, ["diff", "--cached", "--", "file.txt"]);
		const unstagedDiffBefore = git(repo, ["diff", "--", "file.txt"]);
		let failedWorktreeRestore = false;
		replaceEngineGitForTest(engine, (args, options, realGit) => {
			if (!failedWorktreeRestore && args.length === 4 && args[0] === "read-tree" && args[1] === "--reset" && args[2] === "-u" && args[3] === target.value.worktreeTreeSha) {
				failedWorktreeRestore = true;
				realGit(["checkout", target.value.worktreeTreeSha, "--", "file.txt"], options);
				return { ok: false, stdout: "", stderr: "injected worktree restore failure", gitMissing: false };
			}
			return realGit(args, options);
		});

		const restored = engine.restoreCheckpoint(target.value.id);

		expect(restored).toMatchObject({ ok: false, error: "RestoreFailed" });
		expect(failedWorktreeRestore).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("before worktree\n");
		expect(git(repo, ["status", "--porcelain=v1"])).toBe(statusBefore);
		expect(git(repo, ["diff", "--cached", "--", "file.txt"])).toBe(stagedDiffBefore);
		expect(git(repo, ["diff", "--", "file.txt"])).toBe(unstagedDiffBefore);
	});

	it("does not mutate the real index when checkpointing staged and unstaged changes", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "staged\n");
		git(repo, ["add", "file.txt"]);
		writeFileSync(join(repo, "file.txt"), "unstaged\n");
		writeFileSync(join(repo, "new.txt"), "new\n");
		const statusBefore = git(repo, ["status", "--porcelain=v1"]);
		const stagedDiffBefore = git(repo, ["diff", "--cached", "--", "file.txt"]);
		const unstagedDiffBefore = git(repo, ["diff", "--", "file.txt"]);
		expect(statusBefore.split("\n").filter(Boolean)).toEqual(["MM file.txt", "?? new.txt"]);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" });

		expect(created.ok).toBe(true);
		expect(git(repo, ["status", "--porcelain=v1"])).toBe(statusBefore);
		expect(git(repo, ["diff", "--cached", "--", "file.txt"])).toBe(stagedDiffBefore);
		expect(git(repo, ["diff", "--", "file.txt"])).toBe(unstagedDiffBefore);
	});

	it("includes a staged addition in the worktree tree", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "staged-new.txt"), "staged new\n");
		git(repo, ["add", "staged-new.txt"]);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(treeFiles(repo, created.value.worktreeTreeSha)).toContain("staged-new.txt");
		expect(git(repo, ["show", `${created.value.worktreeTreeSha}:staged-new.txt`])).toBe("staged new\n");
	});

	it("keeps staged content in the index tree and worktree content in the worktree tree for staged additions", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "staged-new.txt"), "staged content\n");
		git(repo, ["add", "staged-new.txt"]);
		writeFileSync(join(repo, "staged-new.txt"), "worktree content\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(git(repo, ["show", `${created.value.indexTreeSha}:staged-new.txt`])).toBe("staged content\n");
		expect(git(repo, ["show", `${created.value.worktreeTreeSha}:staged-new.txt`])).toBe("worktree content\n");
	});

	it("includes staged renames in the worktree tree", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		git(repo, ["mv", "file.txt", "renamed.txt"]);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(treeFiles(repo, created.value.worktreeTreeSha)).toContain("renamed.txt");
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain("file.txt");
		expect(git(repo, ["show", `${created.value.worktreeTreeSha}:renamed.txt`])).toBe("v1\n");
	});

	it("skips untracked files larger than the snapshot policy", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "large.bin"), "x".repeat(16));
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" }, { maxUntrackedFileBytes: 8, maxUntrackedDirFiles: 200, ignoredDirNames: [] });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.skippedLargeFiles).toEqual(["large.bin"]);
		expect(created.value.preexistingUntrackedFiles).toContain("large.bin");
		expect(created.value.snapshotPolicy).toMatchObject({ maxUntrackedFileBytes: 8 });
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain("large.bin");
	});

	it("snapshots a broken symlink as a symlink entry when the platform permits symlinks", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		if (!trySymlink("missing-target", join(repo, "broken-link"))) return;
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" }, { maxUntrackedFileBytes: 1, maxUntrackedDirFiles: 200, ignoredDirNames: [] });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.skippedLargeFiles).not.toContain("broken-link");
		expect(treeEntryMode(repo, created.value.worktreeTreeSha, "broken-link")).toBe("120000");
		expect(git(repo, ["show", `${created.value.worktreeTreeSha}:broken-link`])).toBe("missing-target");
	});

	it("includes a symlink to a large external file without sizing the target when the platform permits symlinks", () => {
		const repo = tempRepo();
		const externalDir = join(tmpdir(), `atomic-checkpoint-external-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		cleanup.push(repo, externalDir);
		mkdirSync(externalDir, { recursive: true });
		const externalFile = join(externalDir, "large-target.bin");
		writeFileSync(externalFile, "x".repeat(16));
		if (!trySymlink(externalFile, join(repo, "external-link"))) return;
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" }, { maxUntrackedFileBytes: 1, maxUntrackedDirFiles: 200, ignoredDirNames: [] });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.skippedLargeFiles).not.toContain("external-link");
		expect(treeEntryMode(repo, created.value.worktreeTreeSha, "external-link")).toBe("120000");
		expect(git(repo, ["show", `${created.value.worktreeTreeSha}:external-link`])).toBe(externalFile);
	});

	it("skips configured ignored directory names before writing the checkpoint tree", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		mkdirSync(join(repo, ".venv"), { recursive: true });
		writeFileSync(join(repo, ".venv", "python"), "binary\n");
		writeFileSync(join(repo, "kept.txt"), "kept\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" }, { maxUntrackedFileBytes: 1024, maxUntrackedDirFiles: 200, ignoredDirNames: [".venv"] });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.skippedIgnoredDirs).toEqual([".venv"]);
		expect(treeFiles(repo, created.value.worktreeTreeSha)).toContain("kept.txt");
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain(".venv/python");
	});

	it("skips untracked directory groups over the snapshot policy file count", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		mkdirSync(join(repo, "generated"), { recursive: true });
		writeFileSync(join(repo, "generated", "one.txt"), "1\n");
		writeFileSync(join(repo, "generated", "two.txt"), "2\n");
		writeFileSync(join(repo, "outside.txt"), "outside\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" }, { maxUntrackedFileBytes: 1024, maxUntrackedDirFiles: 1, ignoredDirNames: [] });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.skippedLargeDirs).toEqual(["generated"]);
		expect(treeFiles(repo, created.value.worktreeTreeSha)).toContain("outside.txt");
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain("generated/one.txt");
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain("generated/two.txt");
	});

	it("snapshots tracked modifications and deletions while filtering untracked files", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "tracked edit\n");
		rmSync(join(repo, "delete-me.txt"));
		writeFileSync(join(repo, "large.bin"), "x".repeat(16));
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" }, { maxUntrackedFileBytes: 8, maxUntrackedDirFiles: 200, ignoredDirNames: [] });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(git(repo, ["show", `${created.value.worktreeTreeSha}:file.txt`])).toBe("tracked edit\n");
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain("delete-me.txt");
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain("large.bin");
	});

	it("creates distinct checkpoint refs in the same millisecond", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const now = Date.now();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			writeFileSync(join(repo, "file.txt"), "same-ms-one\n");
			const first = engine.createCheckpoint({ trigger: "turn", turnIndex: 1 });
			expect(first.ok).toBe(true);
			if (!first.ok) throw new Error(first.error);

			writeFileSync(join(repo, "file.txt"), "same-ms-two\n");
			const second = engine.createCheckpoint({ trigger: "turn", turnIndex: 2 });
			expect(second.ok).toBe(true);
			if (!second.ok) throw new Error(second.error);

			expect(second.value.id).not.toBe(first.value.id);
			expect(first.value.timestamp).toBe(now);
			expect(second.value.timestamp).toBe(now);
			const refs = git(repo, ["for-each-ref", "refs/atomic-checkpoints/session-1", "--format=%(refname)"])
				.split("\n")
				.filter(Boolean);
			expect(refs).toHaveLength(2);
			expect(refs.some((ref) => ref.endsWith(`/${first.value.id}`))).toBe(true);
			expect(refs.some((ref) => ref.endsWith(`/${second.value.id}`))).toBe(true);
		} finally {
			nowSpy.mockRestore();
		}
	});

	it("records subdirectory session paths as repo-root-relative POSIX paths", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		mkdirSync(join(repo, "sub"), { recursive: true });
		writeFileSync(join(repo, "sub", "new.txt"), "subdir new\n");
		const engine = new CheckpointEngine({ cwd: join(repo, "sub"), sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.preexistingUntrackedFiles).toEqual(["sub/new.txt"]);
		expect(treeFiles(repo, created.value.worktreeTreeSha)).toContain("sub/new.txt");
	});

	it("restores when a checkpoint-owned untracked exact path is unchanged", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "new.txt"), "checkpointed\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), "local tracked\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored.ok).toBe(true);
		expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe("checkpointed\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("v1\n");
		expect(git(repo, ["status", "--porcelain=v1", "--", "new.txt"]).trim()).toBe("?? new.txt");
	});

	it("does not preview an unchanged checkpoint-owned untracked file as deleted", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "owned.txt"), "checkpointed\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), "local tracked\n");

		const preview = engine.previewDiff(created.value.id);

		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.worktreeText).not.toContain("owned.txt");
		expect(preview.value.text).toContain("local tracked");
	});

	it("previews restore diffs in current-to-checkpoint direction", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "checkpoint tracked\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), "current tracked\n");

		const preview = engine.previewDiff(created.value.id);

		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.worktreeText).toContain("-current tracked");
		expect(preview.value.worktreeText).toContain("+checkpoint tracked");
	});

	it("previews and removes safe post-checkpoint untracked files during restore", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "checkpoint tracked\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), "local tracked\n");
		writeFileSync(join(repo, "later.txt"), "post checkpoint\n");

		const preview = engine.previewDiff(created.value.id);
		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.text).toContain("Untracked files that would be removed:\nlater.txt");
		expect(preview.value.removedUntrackedFiles).toEqual(["later.txt"]);

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored.ok).toBe(true);
		if (!restored.ok) throw new Error(restored.error);
		expect(restored.value.removedUntrackedFiles).toEqual(["later.txt"]);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("checkpoint tracked\n");
		expect(existsSync(join(repo, "later.txt"))).toBe(false);
	});

	it("preserves ignored, skipped, and nested Git untracked material during cleanup", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "checkpoint tracked\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const policy = { maxUntrackedFileBytes: 8, maxUntrackedDirFiles: 1, ignoredDirNames: ["node_modules"] };
		const created = engine.createCheckpoint({ trigger: "turn" }, policy);
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), "local tracked\n");
		writeFileSync(join(repo, "later.txt"), "safe\n");
		writeFileSync(join(repo, "large.bin"), "x".repeat(16));
		mkdirSync(join(repo, "generated"), { recursive: true });
		writeFileSync(join(repo, "generated", "one.txt"), "1\n");
		writeFileSync(join(repo, "generated", "two.txt"), "2\n");
		mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
		writeFileSync(join(repo, "node_modules", "pkg", "cache.txt"), "cache\n");
		mkdirSync(join(repo, "nested"), { recursive: true });
		git(join(repo, "nested"), ["init"]);
		writeFileSync(join(repo, "nested", "inside.txt"), "nested\n");

		const preview = engine.previewDiff(created.value.id, policy);
		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.removedUntrackedFiles).toEqual(["later.txt"]);

		const restored = engine.restoreCheckpoint(created.value.id, policy);

		expect(restored.ok).toBe(true);
		if (!restored.ok) throw new Error(restored.error);
		expect(existsSync(join(repo, "later.txt"))).toBe(false);
		expect(readFileSync(join(repo, "large.bin"), "utf8")).toBe("x".repeat(16));
		expect(readFileSync(join(repo, "generated", "one.txt"), "utf8")).toBe("1\n");
		expect(readFileSync(join(repo, "generated", "two.txt"), "utf8")).toBe("2\n");
		expect(readFileSync(join(repo, "node_modules", "pkg", "cache.txt"), "utf8")).toBe("cache\n");
		expect(readFileSync(join(repo, "nested", "inside.txt"), "utf8")).toBe("nested\n");
	});

	it("returns a truncated restore preview for large diffs instead of failing", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), `${"current line\n".repeat(40_000)}`);

		const preview = engine.previewDiff(created.value.id);

		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.truncated).toBe(true);
		expect(preview.value.text).toContain("[diff truncated after");
	});

	it("refuses restore when a checkpoint-owned untracked exact path was modified locally", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "new.txt"), "checkpointed\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "new.txt"), "local change\n");
		writeFileSync(join(repo, "file.txt"), "local tracked\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe("local change\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local tracked\n");
	});

	it("refuses restore when a checkpoint-owned untracked path has staged divergence", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "new.txt"), "checkpointed\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "new.txt"), "staged local\n");
		git(repo, ["add", "new.txt"]);
		writeFileSync(join(repo, "new.txt"), "checkpointed\n");
		writeFileSync(join(repo, "file.txt"), "local tracked\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe("checkpointed\n");
		expect(git(repo, ["show", ":new.txt"])).toBe("staged local\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local tracked\n");
	});

	it("refuses restore before mutating when a checkpoint-owned untracked path is edited and staged", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "new.txt"), "checkpointed\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "new.txt"), "local staged and worktree\n");
		git(repo, ["add", "new.txt"]);
		writeFileSync(join(repo, "file.txt"), "local tracked sentinel\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "new.txt"), "utf8")).toBe("local staged and worktree\n");
		expect(git(repo, ["show", ":new.txt"])).toBe("local staged and worktree\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local tracked sentinel\n");
	});

	it("refuses restore when a current untracked child conflicts with a checkpoint target file", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "new.txt"), "checkpointed\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		rmSync(join(repo, "new.txt"));
		mkdirSync(join(repo, "new.txt"), { recursive: true });
		writeFileSync(join(repo, "new.txt", "child.txt"), "local child\n");
		writeFileSync(join(repo, "file.txt"), "local tracked\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "new.txt", "child.txt"), "utf8")).toBe("local child\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local tracked\n");
	});

	it("refuses a real directory at a tracked checkpoint target path before read-tree can delete descendants", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "foo"), "checkpoint tracked file\n");
		git(repo, ["add", "foo"]);
		git(repo, ["commit", "-m", "add foo target"]);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		rmSync(join(repo, "foo"));
		mkdirSync(join(repo, "foo", "node_modules", "pkg"), { recursive: true });
		writeFileSync(join(repo, "foo", "node_modules", "pkg", "cache.txt"), "local dependency cache\n");
		writeFileSync(join(repo, "file.txt"), "local sentinel\n");
		expect(git(repo, ["ls-files", "--", "foo"]).trim()).toBe("foo");

		const preview = engine.previewDiff(created.value.id);
		const restored = engine.restoreCheckpoint(created.value.id);

		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.unsafeRestorePaths).toEqual(["foo"]);
		expect(preview.value.text).toContain("Unsafe restore paths that must be resolved before restore:\nfoo");
		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "foo", "node_modules", "pkg", "cache.txt"), "utf8")).toBe("local dependency cache\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local sentinel\n");
	});

	it("refuses restore when a current untracked parent conflicts with a checkpoint target child", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		mkdirSync(join(repo, "notes"), { recursive: true });
		writeFileSync(join(repo, "notes", "new.txt"), "checkpointed child\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		rmSync(join(repo, "notes"), { recursive: true, force: true });
		writeFileSync(join(repo, "notes"), "local parent\n");
		writeFileSync(join(repo, "file.txt"), "local tracked\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "notes"), "utf8")).toBe("local parent\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local tracked\n");
	});

	it("refuses restore when a staged parent file conflicts with a checkpoint-owned untracked child", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		mkdirSync(join(repo, "dir"), { recursive: true });
		writeFileSync(join(repo, "dir", "file.txt"), "checkpointed child\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		rmSync(join(repo, "dir"), { recursive: true, force: true });
		writeFileSync(join(repo, "dir"), "staged parent\n");
		git(repo, ["add", "dir"]);

		const preview = engine.previewDiff(created.value.id);
		const restored = engine.restoreCheckpoint(created.value.id);

		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.unsafeRestorePaths).toEqual(["dir"]);
		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "dir"), "utf8")).toBe("staged parent\n");
		expect(git(repo, ["show", ":dir"])).toBe("staged parent\n");
	});

	it("restores without scanning ignored non-overlapping paths", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
		git(repo, ["add", ".gitignore"]);
		git(repo, ["commit", "-m", "ignore dependencies"]);
		writeFileSync(join(repo, "file.txt"), "checkpoint tracked\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), "local tracked\n");
		mkdirSync(join(repo, "node_modules"), { recursive: true });
		writeFileSync(join(repo, "node_modules", "bad\\name.txt"), "ignored unsafe non-overlap\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("checkpoint tracked\n");
		expect(readFileSync(join(repo, "node_modules", "bad\\name.txt"), "utf8")).toBe("ignored unsafe non-overlap\n");
	});

	it("refuses restore when an ignored untracked path would be overwritten", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
		writeFileSync(join(repo, "ignored.txt"), "checkpoint ignored content\n");
		git(repo, ["add", ".gitignore"]);
		git(repo, ["add", "-f", "ignored.txt"]);
		git(repo, ["commit", "-m", "add force-tracked ignored file"]);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		git(repo, ["rm", "--cached", "-f", "ignored.txt"]);
		writeFileSync(join(repo, "ignored.txt"), "local ignored content\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "ignored.txt"), "utf8")).toBe("local ignored content\n");
	});

	it("refuses restore when a tracked target path is currently untracked after git rm --cached", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "checkpoint tracked\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		git(repo, ["rm", "--cached", "-f", "file.txt"]);
		writeFileSync(join(repo, "file.txt"), "local untracked tracked-path\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local untracked tracked-path\n");
	});

	it("previews skipped staged paths as unsafe restore blockers", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "large.bin"), "x".repeat(16));
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" }, { maxUntrackedFileBytes: 8, maxUntrackedDirFiles: 200, ignoredDirNames: [] });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		git(repo, ["add", "large.bin"]);

		const preview = engine.previewDiff(created.value.id);

		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.unsafeRestorePaths).toContain("large.bin");
		expect(preview.value.text).toContain("Unsafe restore paths that must be resolved before restore:\nlarge.bin");
	});

	it("refuses restore when a skipped large file has since been staged", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "large.bin"), "x".repeat(16));
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" }, { maxUntrackedFileBytes: 8, maxUntrackedDirFiles: 200, ignoredDirNames: [] });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.skippedLargeFiles).toEqual(["large.bin"]);
		git(repo, ["add", "large.bin"]);
		writeFileSync(join(repo, "file.txt"), "local sentinel\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "large.bin"), "utf8")).toBe("x".repeat(16));
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local sentinel\n");
	});

	it("records gitignored configured directories and refuses restore when one is later staged", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
		git(repo, ["add", ".gitignore"]);
		git(repo, ["commit", "-m", "ignore dependencies"]);
		mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
		writeFileSync(join(repo, "node_modules", "pkg", "cache.txt"), "ignored cache\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" }, { maxUntrackedFileBytes: 1024, maxUntrackedDirFiles: 200, ignoredDirNames: ["node_modules"] });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.skippedIgnoredDirs).toEqual(["node_modules"]);
		git(repo, ["add", "-f", "node_modules/pkg/cache.txt"]);
		writeFileSync(join(repo, "file.txt"), "local sentinel\n");

		const preview = engine.previewDiff(created.value.id);
		const restored = engine.restoreCheckpoint(created.value.id);

		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.unsafeRestorePaths).toEqual(["node_modules/pkg/cache.txt"]);
		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "node_modules", "pkg", "cache.txt"), "utf8")).toBe("ignored cache\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local sentinel\n");
	});

	it("refuses restore when a current untracked path conflicts with an index-only checkpoint path", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "staged-only.txt"), "checkpoint staged\n");
		git(repo, ["add", "staged-only.txt"]);
		rmSync(join(repo, "staged-only.txt"));
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(treeFiles(repo, created.value.indexTreeSha)).toContain("staged-only.txt");
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain("staged-only.txt");
		git(repo, ["reset", "--", "staged-only.txt"]);
		writeFileSync(join(repo, "staged-only.txt"), "local untracked\n");
		writeFileSync(join(repo, "file.txt"), "local sentinel\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "staged-only.txt"), "utf8")).toBe("local untracked\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local sentinel\n");
	});

	it("refuses restore when a current untracked parent conflicts with an index-only checkpoint child", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		mkdirSync(join(repo, "index-only"), { recursive: true });
		writeFileSync(join(repo, "index-only", "child.txt"), "checkpoint staged child\n");
		git(repo, ["add", "index-only/child.txt"]);
		rmSync(join(repo, "index-only"), { recursive: true, force: true });
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(treeFiles(repo, created.value.indexTreeSha)).toContain("index-only/child.txt");
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain("index-only/child.txt");
		git(repo, ["reset", "--", "index-only/child.txt"]);
		writeFileSync(join(repo, "index-only"), "local parent\n");
		writeFileSync(join(repo, "file.txt"), "local sentinel\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored).toMatchObject({ ok: false, error: "UnsafeUntrackedOverwrite" });
		expect(readFileSync(join(repo, "index-only"), "utf8")).toBe("local parent\n");
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("local sentinel\n");
	});

	it("includes staged/index changes in the restore preview text", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), "staged preview\n");
		git(repo, ["add", "file.txt"]);
		writeFileSync(join(repo, "file.txt"), "v1\n");

		const preview = engine.previewDiff(created.value.id);

		expect(preview.ok).toBe(true);
		if (!preview.ok) throw new Error(preview.error);
		expect(preview.value.text).toContain("Worktree changes that would be restored:");
		expect(preview.value.text).toContain("Staged/index changes that would be reset:");
		expect(preview.value.text).toContain("staged preview");
		expect(preview.value.indexText).toContain("staged preview");
	});

	it("refuses unsafe Git paths while listing snapshot paths", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "bad\\name.txt"), "unsafe\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		expect(engine.createCheckpoint({ trigger: "turn" })).toMatchObject({ ok: false, error: "UnsafePath" });
	});

	it("skips untracked nested Git repository directory markers while checkpointing", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		mkdirSync(join(repo, "nested"), { recursive: true });
		git(join(repo, "nested"), ["init"]);
		writeFileSync(join(repo, "nested", "inside.txt"), "nested content\n");
		writeFileSync(join(repo, "file.txt"), "checkpoint with nested repo\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const created = engine.createCheckpoint({ trigger: "turn" });

		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		expect(created.value.skippedLargeDirs).toContain("nested");
		expect(treeFiles(repo, created.value.worktreeTreeSha)).not.toContain("nested/inside.txt");
	});

	it("restores with a non-overlapping untracked nested Git repository marker", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "checkpoint tracked\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), "local tracked\n");
		mkdirSync(join(repo, "nested"), { recursive: true });
		git(join(repo, "nested"), ["init"]);
		writeFileSync(join(repo, "nested", "inside.txt"), "nested content\n");

		const restored = engine.restoreCheckpoint(created.value.id);

		expect(restored.ok).toBe(true);
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("checkpoint tracked\n");
		expect(readFileSync(join(repo, "nested", "inside.txt"), "utf8")).toBe("nested content\n");
	});

	it("defaults missing array metadata from older checkpoint refs", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const tree = git(repo, ["rev-parse", "HEAD^{tree}"]).trim();
		const metadata = {
			version: 1,
			id: "oldmeta",
			sessionId: "session-1",
			leafEntryId: null,
			trigger: "turn",
			turnIndex: 0,
			description: "old metadata",
			toolNames: [],
			branch: git(repo, ["branch", "--show-current"]).trim(),
			headSha: git(repo, ["rev-parse", "HEAD"]).trim(),
			indexTreeSha: tree,
			worktreeTreeSha: tree,
			timestamp: Date.now(),
		};
		const commit = git(repo, ["commit-tree", tree], JSON.stringify(metadata)).trim();
		git(repo, ["update-ref", "refs/atomic-checkpoints/session-1/oldmeta", commit]);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });

		const loaded = engine.loadCheckpoint("oldmeta");

		expect(loaded.ok).toBe(true);
		if (!loaded.ok) throw new Error(loaded.error);
		expect(loaded.value.preexistingUntrackedFiles).toEqual([]);
		expect(loaded.value.skippedLargeFiles).toEqual([]);
		expect(loaded.value.skippedLargeDirs).toEqual([]);
		expect(loaded.value.skippedIgnoredDirs).toEqual([]);
	});

	it("dedupes unchanged worktree snapshots", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		expect(engine.createCheckpoint({ trigger: "resume" }).ok).toBe(true);
		expect(engine.createCheckpoint({ trigger: "turn" })).toMatchObject({ ok: false, error: "SnapshotUnchanged" });
	});

	it("does not dedupe when only the index tree changes", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "worktree\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const first = engine.createCheckpoint({ trigger: "turn" });
		expect(first.ok).toBe(true);
		if (!first.ok) throw new Error(first.error);

		git(repo, ["add", "file.txt"]);
		const second = engine.createCheckpoint({ trigger: "turn" });

		expect(second.ok).toBe(true);
		if (!second.ok) throw new Error(second.error);
		expect(second.value.worktreeTreeSha).toBe(first.value.worktreeTreeSha);
		expect(second.value.indexTreeSha).not.toBe(first.value.indexTreeSha);
	});

	it("does not dedupe when only HEAD changes", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const first = engine.createCheckpoint({ trigger: "resume" });
		expect(first.ok).toBe(true);
		if (!first.ok) throw new Error(first.error);

		git(repo, ["commit", "--allow-empty", "-m", "move head"]);
		const second = engine.createCheckpoint({ trigger: "turn" });

		expect(second.ok).toBe(true);
		if (!second.ok) throw new Error(second.error);
		expect(second.value.headSha).not.toBe(first.value.headSha);
		expect(second.value.indexTreeSha).toBe(first.value.indexTreeSha);
		expect(second.value.worktreeTreeSha).toBe(first.value.worktreeTreeSha);
	});

	it("does not dedupe when only the branch changes", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const first = engine.createCheckpoint({ trigger: "resume" });
		expect(first.ok).toBe(true);
		if (!first.ok) throw new Error(first.error);

		git(repo, ["checkout", "-b", "other"]);
		const second = engine.createCheckpoint({ trigger: "turn" });

		expect(second.ok).toBe(true);
		if (!second.ok) throw new Error(second.error);
		expect(second.value.branch).not.toBe(first.value.branch);
		expect(second.value.headSha).toBe(first.value.headSha);
		expect(second.value.indexTreeSha).toBe(first.value.indexTreeSha);
		expect(second.value.worktreeTreeSha).toBe(first.value.worktreeTreeSha);
	});

	it("refuses restore after HEAD moves", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "checkpoint\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		writeFileSync(join(repo, "file.txt"), "committed\n");
		git(repo, ["add", "file.txt"]);
		git(repo, ["commit", "-m", "move head"]);

		expect(engine.restoreCheckpoint(created.value.id)).toMatchObject({ ok: false, error: "HeadMoved" });
	});

	it("checks restore eligibility without mutating before confirmation", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "checkpoint\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		git(repo, ["checkout", "-b", "other"]);
		writeFileSync(join(repo, "file.txt"), "must remain\n");

		expect(engine.checkRestoreEligibility(created.value.id)).toMatchObject({ ok: false, error: "BranchMismatch" });
		expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("must remain\n");
	});

	it("refuses restore from a different branch", () => {
		const repo = tempRepo();
		cleanup.push(repo);
		writeFileSync(join(repo, "file.txt"), "checkpoint\n");
		const engine = new CheckpointEngine({ cwd: repo, sessionId: "session-1" });
		const created = engine.createCheckpoint({ trigger: "turn" });
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error(created.error);
		git(repo, ["checkout", "-b", "other"]);

		expect(engine.restoreCheckpoint(created.value.id)).toMatchObject({ ok: false, error: "BranchMismatch" });
	});
});
