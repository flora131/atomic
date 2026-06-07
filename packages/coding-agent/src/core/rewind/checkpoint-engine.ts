import { closeSync, lstatSync, mkdtempSync, openSync, readSync, rmdirSync, rmSync, statSync, unlinkSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { createGitEnvironment } from "../../utils/git-env.js";
import type {
	CheckpointEngineOptions,
	CheckpointMetadata,
	CheckpointRequest,
	DeletedCheckpoint,
	DiffPreview,
	Result,
	RestoredFiles,
	RestoreStateIdentity,
	SafeSnapshotPlan,
	SafeSnapshotPolicy,
} from "./types.js";

const ZERO_SHA = "0000000000000000000000000000000000000000";
const REF_PREFIX = "refs/atomic-checkpoints";
const MAX_REF_ALLOCATION_ATTEMPTS = 16;
const MAX_PATH_LIST_BYTES = 64 * 1024 * 1024;
const MAX_PATH_LIST_ENTRIES = 500_000;
const MAX_SINGLE_PATH_BYTES = 16 * 1024;
const PATH_LIST_CHUNK_BYTES = 64 * 1024;
const PREVIEW_DIFF_MAX_BYTES = 256 * 1024;
const PREVIEW_TRUNCATION_MARKER = `[diff truncated after ${PREVIEW_DIFF_MAX_BYTES} bytes; restore preview is partial]`;
const DEFAULT_SNAPSHOT_POLICY: SafeSnapshotPolicy = {
	maxUntrackedFileBytes: 10 * 1024 * 1024,
	maxUntrackedDirFiles: 200,
	ignoredDirNames: ["node_modules", ".venv", "venv", "dist", "build", ".cache", "target"],
};
const CHECKPOINT_AUTHOR_NAME = "Atomic Checkpoint";
const CHECKPOINT_AUTHOR_EMAIL = "atomic-checkpoint@bastani.invalid";

type GitCommandOptions = {
	input?: string;
	gitIndexFile?: string;
	literalPathspecs?: boolean;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
};

type GitCommandResult = { ok: true; stdout: string; stderr: string } | { ok: false; stdout: string; stderr: string; gitMissing: boolean };
type GitPathEntry = { kind: "path" | "directory-marker"; path: string };
type RestoreConflictCandidates = {
	exactTargetConflicts: string[];
	parentConflicts: string[];
	targetDirectoryConflicts: string[];
	all: string[];
};
type RestoreTargetUniverse = {
	worktreeTreePaths: string[];
	indexTreePaths: string[];
	targetTreePaths: string[];
	skippedLargeFiles: string[];
	skippedLargeDirs: string[];
	skippedIgnoredDirs: string[];
};
type RestoreCleanupPlan = {
	removeUntrackedFiles: string[];
};
type PreviewDiffResult = {
	text: string;
	truncated: boolean;
};

function skippedRestoreDirs(universe: RestoreTargetUniverse): Set<string> {
	return new Set([...universe.skippedLargeDirs, ...universe.skippedIgnoredDirs]);
}

function skippedRestorePaths(universe: RestoreTargetUniverse): string[] {
	return sortedUniquePaths([
		...universe.skippedLargeFiles,
		...universe.skippedLargeDirs,
		...universe.skippedIgnoredDirs,
	]);
}

function sanitizeRefSegment(value: string): string | null {
	const segment = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
	if (!segment || segment.includes("..") || segment.startsWith(".") || segment.endsWith(".")) return null;
	return segment;
}

export class CheckpointEngine {
	readonly cwd: string;
	readonly sessionId: string;
	private readonly safeSessionId: string;
	private checkpointSequence = 0;

	constructor(options: CheckpointEngineOptions) {
		this.cwd = options.cwd;
		this.sessionId = options.sessionId;
		this.safeSessionId = sanitizeRefSegment(options.sessionId) ?? "session";
	}

	isGitRepo(): Result<string> {
		const result = this.git(["rev-parse", "--show-toplevel"]);
		if (!result.ok) return { ok: false, error: result.gitMissing ? "GitUnavailable" : "NotGitRepository", message: result.stderr };
		return { ok: true, value: result.stdout.trim() };
	}

	createCheckpoint(request: CheckpointRequest, policy: SafeSnapshotPolicy = DEFAULT_SNAPSHOT_POLICY): Result<CheckpointMetadata> {
		const snapshot = this.buildCurrentSnapshot(policy);
		if (!snapshot.ok) return snapshot;
		const { repoRoot, branch, headSha, indexTreeSha, worktreeTreeSha, plan } = snapshot.value;

		const latest = this.listCheckpoints();
		if (
			latest.ok &&
			isSameRestoreState(latest.value[0], {
				branch,
				headSha,
				indexTreeSha,
				worktreeTreeSha,
			})
		) {
			return { ok: false, error: "SnapshotUnchanged" };
		}

		const timestamp = Date.now();
		for (let attempt = 0; attempt < MAX_REF_ALLOCATION_ATTEMPTS; attempt++) {
			const id = this.generateCheckpointId(timestamp, request.trigger);
			const metadata: CheckpointMetadata = {
				version: 1,
				id,
				sessionId: this.sessionId,
				leafEntryId: request.leafEntryId ?? null,
				trigger: request.trigger,
				turnIndex: request.turnIndex ?? 0,
				description: (request.description ?? "").slice(0, 500),
				toolNames: request.toolNames ?? [],
				branch,
				headSha,
				indexTreeSha,
				worktreeTreeSha,
				timestamp,
				preexistingUntrackedFiles: [...plan.preexistingUntrackedFiles],
				skippedLargeFiles: [...plan.skippedLargeFiles],
				skippedLargeDirs: [...plan.skippedLargeDirs],
				skippedIgnoredDirs: [...plan.skippedIgnoredDirs],
				snapshotPolicy: {
					maxUntrackedFileBytes: policy.maxUntrackedFileBytes,
					maxUntrackedDirFiles: policy.maxUntrackedDirFiles,
					ignoredDirNames: [...policy.ignoredDirNames],
				},
			};
			const commit = this.writeReachableCheckpointCommit(metadata, repoRoot);
			if (!commit.ok) return commit;
			const update = this.git(["update-ref", this.refFor(id), commit.value, ZERO_SHA], { cwd: repoRoot });
			if (update.ok) return { ok: true, value: metadata };
			if (!this.refExists(id, repoRoot)) return { ok: false, error: "RestoreFailed", message: update.stderr };
		}
		return { ok: false, error: "RefCollisionExhausted", message: `Unable to allocate a checkpoint ref after ${MAX_REF_ALLOCATION_ATTEMPTS} attempts` };
	}

	getCurrentRestoreState(policy: SafeSnapshotPolicy = DEFAULT_SNAPSHOT_POLICY): Result<RestoreStateIdentity> {
		const snapshot = this.buildCurrentSnapshot(policy);
		if (!snapshot.ok) return snapshot;
		const { branch, headSha, indexTreeSha, worktreeTreeSha } = snapshot.value;
		return { ok: true, value: { branch, headSha, indexTreeSha, worktreeTreeSha } };
	}

	hasCurrentRestoreStateChangedFrom(baseline: RestoreStateIdentity, policy: SafeSnapshotPolicy = DEFAULT_SNAPSHOT_POLICY): Result<boolean> {
		const current = this.getCurrentRestoreState(policy);
		if (!current.ok) return current;
		return { ok: true, value: !isSameRestoreState(baseline, current.value) };
	}

	isCurrentRestoreStateDirty(policy: SafeSnapshotPolicy = DEFAULT_SNAPSHOT_POLICY): Result<boolean> {
		const snapshot = this.buildCurrentSnapshot(policy);
		if (!snapshot.ok) return snapshot;
		if (snapshot.value.plan.preexistingUntrackedFiles.length > 0 || snapshot.value.plan.skippedLargeDirs.length > 0) return { ok: true, value: true };
		const headTree = this.git(["rev-parse", "--verify", `${snapshot.value.headSha}^{tree}`], { cwd: snapshot.value.repoRoot });
		if (!headTree.ok) {
			return { ok: true, value: snapshot.value.indexTreeSha !== snapshot.value.worktreeTreeSha };
		}
		const headTreeSha = headTree.stdout.trim();
		return { ok: true, value: snapshot.value.indexTreeSha !== headTreeSha || snapshot.value.worktreeTreeSha !== headTreeSha };
	}

	listCheckpoints(): Result<CheckpointMetadata[]> {
		const refs = this.git(["for-each-ref", `${REF_PREFIX}/${this.safeSessionId}`, "--format=%(refname)"]);
		if (!refs.ok) return { ok: false, error: refs.gitMissing ? "GitUnavailable" : "NotGitRepository", message: refs.stderr };
		const checkpoints: CheckpointMetadata[] = [];
		for (const ref of refs.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
			const loaded = this.loadCheckpointByRef(ref);
			if (loaded.ok) checkpoints.push(loaded.value);
		}
		checkpoints.sort(compareCheckpointsNewestFirst);
		return { ok: true, value: checkpoints };
	}

	previewDiff(id: string, policy: SafeSnapshotPolicy = DEFAULT_SNAPSHOT_POLICY): Result<DiffPreview> {
		const checkpoint = this.loadCheckpoint(id);
		if (!checkpoint.ok) return checkpoint;
		const repo = this.isGitRepo();
		if (!repo.ok) return repo;
		const repoRoot = repo.value;
		const universe = this.buildRestoreTargetUniverse(checkpoint.value, repoRoot);
		if (!universe.ok) return universe;
		const current = this.buildCurrentSnapshot(policy);
		if (!current.ok) return current;
		const cleanupPlan = this.planSafeUntrackedCleanup(current.value.plan, universe.value);
		if (!cleanupPlan.ok) return cleanupPlan;
		const conflictCandidates = this.collectRestoreConflictCandidates(checkpoint.value, universe.value.targetTreePaths, repoRoot);
		if (!conflictCandidates.ok) return conflictCandidates;
		const unchangedCheckpointOwnedPaths = this.verifyCheckpointOwnedUntrackedMatches(
			checkpoint.value,
			conflictCandidates.value.exactTargetConflicts,
			universe.value.worktreeTreePaths,
			repoRoot,
		);
		if (!unchangedCheckpointOwnedPaths.ok) return unchangedCheckpointOwnedPaths;
		const skippedBlockers = this.collectSkippedRestoreBlockers(universe.value, repoRoot);
		if (!skippedBlockers.ok) return skippedBlockers;
		const unsafeRestorePaths = sortedUniquePaths([
			...conflictCandidates.value.all.filter((path) => !unchangedCheckpointOwnedPaths.value.has(path)),
			...skippedBlockers.value,
		]);
		const worktreeDiff = this.gitDiffPreview(["diff", current.value.worktreeTreeSha, checkpoint.value.worktreeTreeSha], repoRoot);
		if (!worktreeDiff.ok) return worktreeDiff;
		const indexDiff = this.gitDiffPreview(["diff", current.value.indexTreeSha, checkpoint.value.indexTreeSha], repoRoot);
		if (!indexDiff.ok) return indexDiff;
		const worktreeText = worktreeDiff.value.text;
		const indexText = indexDiff.value.text;
		const cleanupText = formatPathPreview(cleanupPlan.value.removeUntrackedFiles);
		const unsafeText = formatPathPreview(unsafeRestorePaths);
		const text = [
			"Unsafe restore paths that must be resolved before restore:",
			unsafeText,
			"",
			"Untracked files that would be removed:",
			cleanupText,
			"",
			"Worktree changes that would be restored:",
			worktreeText.trimEnd() || "(none)",
			"",
			"Staged/index changes that would be reset:",
			indexText.trimEnd() || "(none)",
		].join("\n");
		return {
			ok: true,
			value: {
				text,
				worktreeText,
				indexText,
				truncated: worktreeDiff.value.truncated || indexDiff.value.truncated,
				removedUntrackedFiles: cleanupPlan.value.removeUntrackedFiles,
				unsafeRestorePaths,
			},
		};
	}

	checkRestoreEligibility(id: string): Result<CheckpointMetadata> {
		const checkpoint = this.loadCheckpoint(id);
		if (!checkpoint.ok) return checkpoint;
		const eligible = this.verifyRestoreEligibility(checkpoint.value);
		if (!eligible.ok) return eligible;
		return { ok: true, value: checkpoint.value };
	}

	restoreCheckpoint(id: string, policy?: SafeSnapshotPolicy): Result<RestoredFiles> {
		const checkpoint = this.loadCheckpoint(id);
		if (!checkpoint.ok) return checkpoint;
		const metadata = checkpoint.value;
		const eligible = this.verifyRestoreEligibility(metadata);
		if (!eligible.ok) return eligible;
		const repoRoot = eligible.value.repoRoot;
		const universe = this.buildRestoreTargetUniverse(metadata, repoRoot);
		if (!universe.ok) return universe;
		const skippedGuard = this.guardSkippedRestorePaths(universe.value, repoRoot);
		if (!skippedGuard.ok) return skippedGuard;
		const conflictCandidates = this.collectRestoreConflictCandidates(metadata, universe.value.targetTreePaths, repoRoot);
		if (!conflictCandidates.ok) return conflictCandidates;
		const unchangedCheckpointOwnedPaths = this.verifyCheckpointOwnedUntrackedMatches(
			metadata,
			conflictCandidates.value.exactTargetConflicts,
			universe.value.worktreeTreePaths,
			repoRoot,
		);
		if (!unchangedCheckpointOwnedPaths.ok) return unchangedCheckpointOwnedPaths;
		const hazards = conflictCandidates.value.all.filter((path) => !unchangedCheckpointOwnedPaths.value.has(path));
		if (hazards.length > 0) {
			return { ok: false, error: "UnsafeUntrackedOverwrite", message: `Restore would overwrite untracked path(s): ${hazards.slice(0, 20).join(", ")}` };
		}
		const preRestoreState = this.buildCurrentSnapshot(policy ?? metadata.snapshotPolicy ?? DEFAULT_SNAPSHOT_POLICY);
		if (!preRestoreState.ok) return preRestoreState;
		const cleanupPlan = this.planSafeUntrackedCleanup(preRestoreState.value.plan, universe.value);
		if (!cleanupPlan.ok) return cleanupPlan;
		const restoreWorktree = this.git(["read-tree", "--reset", "-u", metadata.worktreeTreeSha], { cwd: repoRoot });
		if (!restoreWorktree.ok) return { ok: false, error: "RestoreFailed", message: restoreWorktree.stderr };
		const restoreIndex = this.git(["read-tree", "--reset", metadata.indexTreeSha], { cwd: repoRoot });
		if (!restoreIndex.ok) {
			const rollback = this.rollbackRestore(preRestoreState.value, repoRoot);
			if (!rollback.ok) {
				return {
					ok: false,
					error: "RestoreFailed",
					message: `Restore index update failed after worktree update (${restoreIndex.stderr}); rollback failed: ${rollback.message ?? rollback.error}`,
				};
			}
			return { ok: false, error: "RestoreFailed", message: `Restore index update failed after worktree update; rolled back previous state: ${restoreIndex.stderr}` };
		}
		const cleanup = this.removeSafeUntrackedFiles(cleanupPlan.value.removeUntrackedFiles, repoRoot);
		if (!cleanup.ok) {
			const rollback = this.rollbackRestore(preRestoreState.value, repoRoot);
			if (!rollback.ok) {
				return {
					ok: false,
					error: "RestoreFailed",
					message: `Restore cleanup failed after files were restored (${cleanup.message ?? cleanup.error}); rollback failed: ${rollback.message ?? rollback.error}`,
				};
			}
			return { ok: false, error: "RestoreFailed", message: `Restore cleanup failed after files were restored; rolled back previous state: ${cleanup.message ?? cleanup.error}` };
		}
		return { ok: true, value: { checkpoint: metadata, removedUntrackedFiles: cleanup.value } };
	}

	loadCheckpoint(id: string): Result<CheckpointMetadata> {
		const safeId = sanitizeRefSegment(id);
		if (!safeId || safeId !== id) return { ok: false, error: "InvalidCheckpointRef" };
		return this.loadCheckpointByRef(this.refFor(id));
	}

	deleteCheckpoint(id: string): Result<DeletedCheckpoint> {
		const safeId = sanitizeRefSegment(id);
		if (!safeId || safeId !== id) return { ok: false, error: "InvalidCheckpointRef" };
		const deleted = this.git(["update-ref", "-d", this.refFor(id)]);
		if (!deleted.ok) return { ok: false, error: "PruneFailed", message: deleted.stderr };
		return { ok: true, value: { id } };
	}

	private planSafeUntrackedCleanup(currentPlan: SafeSnapshotPlan, universe: RestoreTargetUniverse): Result<RestoreCleanupPlan> {
		const targetPaths = new Set(universe.targetTreePaths);
		const skippedFiles = new Set(universe.skippedLargeFiles);
		const skippedDirs = skippedRestoreDirs(universe);
		const removeUntrackedFiles = currentPlan.allowedUntrackedFiles.filter(
			(path) => !targetPaths.has(path) && !skippedFiles.has(path) && !isUnderAnyPath(path, skippedDirs),
		);
		const bounds = validatePathListBounds(removeUntrackedFiles);
		if (!bounds.ok) return bounds;
		return { ok: true, value: { removeUntrackedFiles } };
	}

	private removeSafeUntrackedFiles(paths: readonly string[], repoRoot: string): Result<string[]> {
		const removed: string[] = [];
		for (const path of paths) {
			const stat = lstatRepoPath(repoRoot, path);
			if (stat === null) continue;
			if (!stat.ok) return stat;
			if (stat.value.isDirectory()) {
				return { ok: false, error: "RestoreFailed", message: `Refusing to recursively remove untracked directory during restore cleanup: ${path}` };
			}
			try {
				unlinkSync(join(repoRoot, path));
				removed.push(path);
				removeEmptyParentDirs(repoRoot, path);
			} catch (error) {
				if (!isNotFoundError(error)) return { ok: false, error: "RestoreFailed", message: formatFilesystemError(error) };
			}
		}
		return { ok: true, value: removed };
	}

	private gitDiffPreview(args: string[], repoRoot: string): Result<PreviewDiffResult> {
		const env = createGitEnvironment();
		const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", env, maxBuffer: PREVIEW_DIFF_MAX_BYTES });
		const stdout = result.stdout ?? "";
		const stderr = result.stderr ?? "";
		if (result.error) {
			const code = (result.error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") return { ok: false, error: "GitUnavailable", message: result.error.message };
			if (code === "ENOBUFS") return { ok: true, value: { text: appendTruncationMarker(stdout), truncated: true } };
			return { ok: false, error: "RestoreFailed", message: result.error.message };
		}
		if (result.status !== 0) return { ok: false, error: "RestoreFailed", message: stderr || stdout || "Git diff failed" };
		return { ok: true, value: { text: stdout, truncated: false } };
	}

	private rollbackRestore(state: RestoreStateIdentity, repoRoot: string): Result<void> {
		const restoreWorktree = this.git(["read-tree", "--reset", "-u", state.worktreeTreeSha], { cwd: repoRoot });
		if (!restoreWorktree.ok) return { ok: false, error: "RestoreFailed", message: restoreWorktree.stderr };
		const restoreIndex = this.git(["read-tree", "--reset", state.indexTreeSha], { cwd: repoRoot });
		if (!restoreIndex.ok) return { ok: false, error: "RestoreFailed", message: restoreIndex.stderr };
		return { ok: true, value: undefined };
	}

	private loadCheckpointByRef(ref: string): Result<CheckpointMetadata> {
		const cat = this.git(["cat-file", "-p", ref]);
		if (!cat.ok) return { ok: false, error: "CheckpointNotFound", message: cat.stderr };
		const body = cat.stdout.slice(cat.stdout.indexOf("\n\n") + 2).trim();
		try {
			const parsed = JSON.parse(body) as Partial<CheckpointMetadata>;
			if (parsed.version !== 1 || typeof parsed.id !== "string" || !sanitizeRefSegment(parsed.id)) return { ok: false, error: "InvalidCheckpointRef" };
			const metadata = parsed as CheckpointMetadata;
			metadata.preexistingUntrackedFiles = normalizeStringArray(parsed.preexistingUntrackedFiles);
			metadata.skippedLargeFiles = normalizeStringArray(parsed.skippedLargeFiles);
			metadata.skippedLargeDirs = normalizeStringArray(parsed.skippedLargeDirs);
			metadata.skippedIgnoredDirs = normalizeStringArray(parsed.skippedIgnoredDirs);
			return { ok: true, value: metadata };
		} catch (error) {
			return { ok: false, error: "InvalidCheckpointRef", message: error instanceof Error ? error.message : String(error) };
		}
	}

	private refFor(id: string): string {
		return `${REF_PREFIX}/${this.safeSessionId}/${id}`;
	}

	private currentBranch(): Result<string> {
		const branch = this.git(["branch", "--show-current"]);
		if (!branch.ok) return { ok: false, error: "NotGitRepository", message: branch.stderr };
		return { ok: true, value: branch.stdout.trim() || "HEAD" };
	}

	private headSha(): Result<string> {
		const head = this.git(["rev-parse", "--verify", "HEAD"]);
		if (!head.ok) return { ok: true, value: ZERO_SHA };
		return { ok: true, value: head.stdout.trim() };
	}

	private buildCurrentSnapshot(policy: SafeSnapshotPolicy): Result<RestoreStateIdentity & { repoRoot: string; plan: SafeSnapshotPlan }> {
		const repo = this.isGitRepo();
		if (!repo.ok) return repo;
		const repoRoot = repo.value;
		const branch = this.currentBranch();
		if (!branch.ok) return branch;
		const headSha = this.headSha();
		if (!headSha.ok) return headSha;
		const indexTree = this.git(["write-tree"], { cwd: repoRoot });
		if (!indexTree.ok) return { ok: false, error: "RestoreFailed", message: indexTree.stderr };
		const indexTreeSha = indexTree.stdout.trim();
		const worktreeSnapshot = this.writeWorktreeTree(indexTreeSha, repoRoot, policy);
		if (!worktreeSnapshot.ok) return worktreeSnapshot;
		return {
			ok: true,
			value: {
				repoRoot,
				branch: branch.value,
				headSha: headSha.value,
				indexTreeSha,
				worktreeTreeSha: worktreeSnapshot.value.treeSha,
				plan: worktreeSnapshot.value.plan,
			},
		};
	}

	private writeWorktreeTree(indexTreeSha: string, repoRoot: string, policy: SafeSnapshotPolicy): Result<{ treeSha: string; plan: SafeSnapshotPlan }> {
		const plan = this.planSafeSnapshot(repoRoot, policy);
		if (!plan.ok) return plan;
		const dir = mkdtempSync(join(tmpdir(), "atomic-checkpoint-index-"));
		const indexFile = join(dir, "index");
		try {
			const readTree = this.git(["read-tree", indexTreeSha], { gitIndexFile: indexFile, cwd: repoRoot });
			if (!readTree.ok) return { ok: false, error: "RestoreFailed", message: readTree.stderr };
			const addTracked = this.git(["add", "-u"], { gitIndexFile: indexFile, cwd: repoRoot });
			if (!addTracked.ok) return { ok: false, error: "RestoreFailed", message: addTracked.stderr };
			if (plan.value.allowedUntrackedFiles.length > 0) {
				const addUntracked = this.git(["add", "--pathspec-from-file=-", "--pathspec-file-nul"], {
					gitIndexFile: indexFile,
					input: `${plan.value.allowedUntrackedFiles.join("\0")}\0`,
					literalPathspecs: true,
					cwd: repoRoot,
				});
				if (!addUntracked.ok) return { ok: false, error: "RestoreFailed", message: addUntracked.stderr };
			}
			const tree = this.git(["write-tree"], { gitIndexFile: indexFile, cwd: repoRoot });
			if (!tree.ok) return { ok: false, error: "RestoreFailed", message: tree.stderr };
			return { ok: true, value: { treeSha: tree.stdout.trim(), plan: plan.value } };
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	private planSafeSnapshot(repoRoot: string, policy: SafeSnapshotPolicy): Result<SafeSnapshotPlan> {
		const untracked = this.listGitNulPathEntries(["ls-files", "--others", "--exclude-standard", "-z"], repoRoot);
		if (!untracked.ok) return untracked;
		const ignored = this.listGitNulPathEntries(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], repoRoot);
		if (!ignored.ok) return ignored;
		const tracked = this.listGitNulPaths(["ls-files", "-z"], repoRoot);
		if (!tracked.ok) return tracked;

		const trackedPrefixes = trackedDirectoryPrefixes(tracked.value);
		const ignoredNames = new Set(policy.ignoredDirNames.filter((name) => name.length > 0));
		const untrackedFilesOutsideIgnoredDirs: string[] = [];
		const skippedIgnoredDirs = new Set<string>();
		const skippedDirectoryMarkers = new Set<string>();
		for (const entry of ignored.value) {
			const ignoredDir = findIgnoredDir(entry.path, ignoredNames, entry.kind === "directory-marker");
			if (ignoredDir) skippedIgnoredDirs.add(ignoredDir);
		}
		for (const entry of untracked.value) {
			if (entry.kind === "directory-marker") {
				skippedDirectoryMarkers.add(entry.path);
				continue;
			}
			const safePath = entry.path;
			const ignoredDir = findIgnoredDir(safePath, ignoredNames, false);
			if (ignoredDir) {
				skippedIgnoredDirs.add(ignoredDir);
				continue;
			}
			untrackedFilesOutsideIgnoredDirs.push(safePath);
		}

		const sizeAllowedFiles: string[] = [];
		const skippedLargeFiles: string[] = [];
		for (const file of untrackedFilesOutsideIgnoredDirs) {
			try {
				const stat = lstatSync(join(repoRoot, file));
				if (stat.isFile() && stat.size > policy.maxUntrackedFileBytes) {
					skippedLargeFiles.push(file);
					continue;
				}
				sizeAllowedFiles.push(file);
			} catch (error) {
				return { ok: false, error: "SnapshotPlanFailed", message: error instanceof Error ? error.message : String(error) };
			}
		}

		const untrackedGroupCounts = new Map<string, number>();
		for (const file of sizeAllowedFiles) {
			const group = untrackedDirectoryGroup(file, trackedPrefixes);
			if (!group) continue;
			untrackedGroupCounts.set(group, (untrackedGroupCounts.get(group) ?? 0) + 1);
		}

		const skippedLargeDirs = new Set<string>(skippedDirectoryMarkers);
		for (const [group, fileCount] of untrackedGroupCounts) {
			if (fileCount > policy.maxUntrackedDirFiles) skippedLargeDirs.add(group);
		}

		const allowedUntrackedFiles = sizeAllowedFiles.filter((file) => !isUnderAnyPath(file, skippedLargeDirs));
		const preexistingUntrackedFiles = [...allowedUntrackedFiles, ...skippedLargeFiles];
		return {
			ok: true,
			value: {
				allowedUntrackedFiles: allowedUntrackedFiles.sort(),
				preexistingUntrackedFiles: preexistingUntrackedFiles.sort(),
				skippedLargeFiles: skippedLargeFiles.sort(),
				skippedLargeDirs: [...skippedLargeDirs].sort(),
				skippedIgnoredDirs: [...skippedIgnoredDirs].sort(),
			},
		};
	}

	private writeReachableCheckpointCommit(metadata: CheckpointMetadata, repoRoot: string): Result<string> {
		const env = checkpointCommitEnvironment(metadata.timestamp);
		const indexCommit = this.git(["commit-tree", metadata.indexTreeSha], { input: "Atomic checkpoint index tree retention", cwd: repoRoot, env });
		if (!indexCommit.ok) return { ok: false, error: "RestoreFailed", message: indexCommit.stderr };
		const indexCommitSha = indexCommit.stdout.trim();
		const topCommit = this.git(["commit-tree", metadata.worktreeTreeSha, "-p", indexCommitSha], { input: JSON.stringify(metadata), cwd: repoRoot, env });
		if (!topCommit.ok) return { ok: false, error: "RestoreFailed", message: topCommit.stderr };
		return { ok: true, value: topCommit.stdout.trim() };
	}

	private verifyRestoreEligibility(metadata: CheckpointMetadata): Result<{ repoRoot: string }> {
		const repo = this.isGitRepo();
		if (!repo.ok) return repo;
		const branch = this.currentBranch();
		if (!branch.ok) return branch;
		if (branch.value !== metadata.branch) return { ok: false, error: "BranchMismatch" };
		const headSha = this.headSha();
		if (!headSha.ok) return headSha;
		if (headSha.value !== metadata.headSha) return { ok: false, error: "HeadMoved" };
		const objects = this.preflightRestoreObjects(metadata, repo.value);
		if (!objects.ok) return objects;
		return { ok: true, value: { repoRoot: repo.value } };
	}

	private preflightRestoreObjects(metadata: CheckpointMetadata, repoRoot: string): Result<void> {
		for (const [field, sha] of [
			["worktreeTreeSha", metadata.worktreeTreeSha],
			["indexTreeSha", metadata.indexTreeSha],
		] as const) {
			const exists = this.git(["cat-file", "-e", `${sha}^{tree}`], { cwd: repoRoot });
			if (!exists.ok) {
				return { ok: false, error: "CheckpointObjectMissing", message: `Checkpoint ${field} object is missing or is not a tree: ${sha}` };
			}
		}
		return { ok: true, value: undefined };
	}

	private buildRestoreTargetUniverse(metadata: CheckpointMetadata, repoRoot: string): Result<RestoreTargetUniverse> {
		const worktreeTreePaths = this.listGitNulPaths(["ls-tree", "-r", "-z", "--name-only", metadata.worktreeTreeSha], repoRoot);
		if (!worktreeTreePaths.ok) return worktreeTreePaths;
		const indexTreePaths = this.listGitNulPaths(["ls-tree", "-r", "-z", "--name-only", metadata.indexTreeSha], repoRoot);
		if (!indexTreePaths.ok) return indexTreePaths;
		const skippedLargeFiles = validateMetadataPathList(metadata.skippedLargeFiles, repoRoot);
		if (!skippedLargeFiles.ok) return skippedLargeFiles;
		const skippedLargeDirs = validateMetadataPathList(metadata.skippedLargeDirs, repoRoot);
		if (!skippedLargeDirs.ok) return skippedLargeDirs;
		const skippedIgnoredDirs = validateMetadataPathList(metadata.skippedIgnoredDirs, repoRoot);
		if (!skippedIgnoredDirs.ok) return skippedIgnoredDirs;
		const targetTreePaths = sortedUniquePaths([...worktreeTreePaths.value, ...indexTreePaths.value]);
		const bounds = validatePathListBounds([
			...targetTreePaths,
			...skippedLargeFiles.value,
			...skippedLargeDirs.value,
			...skippedIgnoredDirs.value,
		]);
		if (!bounds.ok) return bounds;
		return {
			ok: true,
			value: {
				worktreeTreePaths: worktreeTreePaths.value,
				indexTreePaths: indexTreePaths.value,
				targetTreePaths,
				skippedLargeFiles: skippedLargeFiles.value,
				skippedLargeDirs: skippedLargeDirs.value,
				skippedIgnoredDirs: skippedIgnoredDirs.value,
			},
		};
	}

	private collectSkippedRestoreBlockers(universe: RestoreTargetUniverse, repoRoot: string): Result<string[]> {
		const skippedPaths = skippedRestorePaths(universe);
		if (skippedPaths.length === 0) return { ok: true, value: [] };
		return this.listTrackedPathsUnder(skippedPaths, repoRoot);
	}

	private guardSkippedRestorePaths(universe: RestoreTargetUniverse, repoRoot: string): Result<void> {
		const tracked = this.collectSkippedRestoreBlockers(universe, repoRoot);
		if (!tracked.ok) return tracked;
		if (tracked.value.length > 0) {
			return {
				ok: false,
				error: "UnsafeUntrackedOverwrite",
				message: `Restore would reset staged/tracked skipped path(s): ${tracked.value.slice(0, 20).join(", ")}`,
			};
		}
		return { ok: true, value: undefined };
	}

	private collectRestoreConflictCandidates(metadata: CheckpointMetadata, targetTreePaths: readonly string[], repoRoot: string): Result<RestoreConflictCandidates> {
		const targetLeafPaths = sortedUniquePaths(targetTreePaths);
		const checkpointOwnedTargets = new Set(checkpointOwnedUntrackedExactCandidates(metadata, targetLeafPaths, targetLeafPaths));
		const targetParentPaths = sortedUniquePaths(targetParentPathsFor(targetLeafPaths));
		const candidateProbePaths = sortedUniquePaths([...targetLeafPaths, ...targetParentPaths]);
		const bounds = validatePathListBounds(candidateProbePaths);
		if (!bounds.ok) return bounds;
		const trackedExactPaths = this.listTrackedExactPaths(candidateProbePaths, repoRoot);
		if (!trackedExactPaths.ok) return trackedExactPaths;

		const exactTargetConflicts: string[] = [];
		const targetDirectoryConflicts: string[] = [];
		for (const targetPath of targetLeafPaths) {
			const stat = lstatRepoPath(repoRoot, targetPath);
			if (stat === null) continue;
			if (stat.ok) {
				const hasTrackedExactPath = trackedExactPaths.value.has(targetPath);
				const needsConflictCheck = !hasTrackedExactPath || checkpointOwnedTargets.has(targetPath);
				if (stat.value.isDirectory()) {
					targetDirectoryConflicts.push(targetPath);
				} else if (needsConflictCheck) {
					exactTargetConflicts.push(targetPath);
				}
			} else {
				return stat;
			}
		}

		const parentConflicts: string[] = [];
		for (const parentPath of targetParentPaths) {
			const stat = lstatRepoPath(repoRoot, parentPath);
			if (stat === null || trackedExactPaths.value.has(parentPath)) continue;
			if (stat.ok) {
				if (!stat.value.isDirectory()) parentConflicts.push(parentPath);
			} else {
				return stat;
			}
		}

		return {
			ok: true,
			value: {
				exactTargetConflicts,
				parentConflicts,
				targetDirectoryConflicts,
				all: sortedUniquePaths([...exactTargetConflicts, ...parentConflicts, ...targetDirectoryConflicts]),
			},
		};
	}

	private listTrackedExactPaths(paths: readonly string[], repoRoot: string): Result<Set<string>> {
		const bounds = validatePathListBounds(paths);
		if (!bounds.ok) return bounds;
		const pathSet = new Set(paths);
		const trackedExactPaths = new Set<string>();
		let useNulPathspecs = true;
		for (const chunk of chunkPathArgs(paths)) {
			let tracked: Result<string[]> | undefined;
			if (useNulPathspecs) {
				tracked = this.listGitNulPaths(["ls-files", "-z", "--pathspec-from-file=-", "--pathspec-file-nul"], repoRoot, {
					input: `${chunk.join("\0")}\0`,
					literalPathspecs: true,
					failureError: "RestoreFailed",
				});
				if (!tracked.ok && isUnsupportedLsFilesNulPathspecs(tracked.message)) {
					useNulPathspecs = false;
				}
			}
			if (!useNulPathspecs) {
				tracked = this.listGitNulPaths(["ls-files", "-z", "--", ...chunk], repoRoot, {
					literalPathspecs: true,
					failureError: "RestoreFailed",
				});
			}
			if (tracked === undefined) return { ok: false, error: "RestoreFailed", message: "Git tracked-path listing did not run" };
			if (!tracked.ok) return tracked;
			for (const path of tracked.value) {
				if (pathSet.has(path)) trackedExactPaths.add(path);
			}
		}
		return { ok: true, value: trackedExactPaths };
	}

	private listTrackedPathsUnder(paths: readonly string[], repoRoot: string): Result<string[]> {
		const bounds = validatePathListBounds(paths);
		if (!bounds.ok) return bounds;
		const roots = new Set(paths);
		const trackedPaths = new Set<string>();
		let useNulPathspecs = true;
		for (const chunk of chunkPathArgs(paths)) {
			let tracked: Result<string[]> | undefined;
			if (useNulPathspecs) {
				tracked = this.listGitNulPaths(["ls-files", "-z", "--pathspec-from-file=-", "--pathspec-file-nul"], repoRoot, {
					input: `${chunk.join("\0")}\0`,
					literalPathspecs: true,
					failureError: "RestoreFailed",
				});
				if (!tracked.ok && isUnsupportedLsFilesNulPathspecs(tracked.message)) {
					useNulPathspecs = false;
				}
			}
			if (!useNulPathspecs) {
				tracked = this.listGitNulPaths(["ls-files", "-z", "--", ...chunk], repoRoot, {
					literalPathspecs: true,
					failureError: "RestoreFailed",
				});
			}
			if (tracked === undefined) return { ok: false, error: "RestoreFailed", message: "Git tracked-path listing did not run" };
			if (!tracked.ok) return tracked;
			for (const path of tracked.value) {
				if (isUnderAnyPath(path, roots)) trackedPaths.add(path);
			}
		}
		return { ok: true, value: [...trackedPaths].sort() };
	}

	private listIndexPathsDifferentFromTree(treeSha: string, paths: readonly string[], repoRoot: string): Result<string[]> {
		const bounds = validatePathListBounds(paths);
		if (!bounds.ok) return bounds;
		const changedPaths = new Set<string>();
		let useNulPathspecs = true;
		for (const chunk of chunkPathArgs(paths)) {
			let changed: Result<string[]> | undefined;
			if (useNulPathspecs) {
				changed = this.listGitNulPaths(["diff", "--cached", "--name-only", "-z", "--pathspec-from-file=-", "--pathspec-file-nul", treeSha], repoRoot, {
					input: `${chunk.join("\0")}\0`,
					literalPathspecs: true,
					failureError: "RestoreFailed",
				});
				if (!changed.ok && isUnsupportedDiffCachedNulPathspecs(changed.message)) {
					useNulPathspecs = false;
				}
			}
			if (!useNulPathspecs) {
				changed = this.listGitNulPaths(["diff", "--cached", "--name-only", "-z", treeSha, "--", ...chunk], repoRoot, {
					literalPathspecs: true,
					failureError: "RestoreFailed",
				});
			}
			if (changed === undefined) return { ok: false, error: "RestoreFailed", message: "Git staged path comparison did not run" };
			if (!changed.ok) return changed;
			for (const path of changed.value) changedPaths.add(path);
		}
		return { ok: true, value: [...changedPaths] };
	}

	private verifyCheckpointOwnedUntrackedMatches(
		metadata: CheckpointMetadata,
		currentUntrackedFiles: readonly string[],
		targetTreePaths: readonly string[],
		repoRoot: string,
	): Result<Set<string>> {
		const candidates = checkpointOwnedUntrackedExactCandidates(metadata, currentUntrackedFiles, targetTreePaths);
		if (candidates.length === 0) return { ok: true, value: new Set() };
		const dir = mkdtempSync(join(tmpdir(), "atomic-checkpoint-verify-index-"));
		const indexFile = join(dir, "index");
		try {
			const readTree = this.git(["read-tree", metadata.worktreeTreeSha], { gitIndexFile: indexFile, cwd: repoRoot });
			if (!readTree.ok) return { ok: false, error: "RestoreFailed", message: readTree.stderr };
			const refresh = this.refreshTemporaryIndex(indexFile, repoRoot);
			if (!refresh.ok) return refresh;
			const matches = new Set(candidates);
			let useNulPathspecs = true;
			for (const chunk of chunkPathArgs(candidates)) {
				let changed: Result<string[]> | undefined;
				if (useNulPathspecs) {
					changed = this.listGitNulPaths(["diff-files", "--name-only", "-z", "--pathspec-from-file=-", "--pathspec-file-nul"], repoRoot, {
						gitIndexFile: indexFile,
						literalPathspecs: true,
						input: `${chunk.join("\0")}\0`,
						failureError: "RestoreFailed",
					});
					if (!changed.ok && isUnsupportedDiffFilesNulPathspecs(changed.message)) {
						useNulPathspecs = false;
					}
				}
				if (!useNulPathspecs) {
					changed = this.listGitNulPaths(["diff-files", "--name-only", "-z", "--", ...chunk], repoRoot, {
						gitIndexFile: indexFile,
						literalPathspecs: true,
						failureError: "RestoreFailed",
					});
				}
				if (changed === undefined) return { ok: false, error: "RestoreFailed", message: "Git path comparison did not run" };
				if (!changed.ok) return { ok: false, error: changed.error, message: changed.message };
				for (const path of changed.value) matches.delete(path);
			}
			const trackedCandidates = this.listTrackedExactPaths(candidates, repoRoot);
			if (!trackedCandidates.ok) return trackedCandidates;
			const stagedCandidates = candidates.filter((path) => trackedCandidates.value.has(path));
			if (stagedCandidates.length > 0) {
				const stagedDivergence = this.listIndexPathsDifferentFromTree(metadata.worktreeTreeSha, stagedCandidates, repoRoot);
				if (!stagedDivergence.ok) return stagedDivergence;
				for (const path of stagedDivergence.value) matches.delete(path);
			}
			return { ok: true, value: matches };
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	private refreshTemporaryIndex(indexFile: string, repoRoot: string): Result<void> {
		const env = createGitEnvironment();
		env.GIT_INDEX_FILE = indexFile;
		const result = spawnSync("git", ["update-index", "--refresh"], { cwd: repoRoot, encoding: "utf8", env });
		if (result.error) {
			return { ok: false, error: (result.error as NodeJS.ErrnoException).code === "ENOENT" ? "GitUnavailable" : "RestoreFailed", message: result.error.message };
		}
		if (result.status !== 0 && result.status !== 1) {
			return { ok: false, error: "RestoreFailed", message: result.stderr || result.stdout || "Git index refresh failed" };
		}
		return { ok: true, value: undefined };
	}

	private generateCheckpointId(timestamp: number, trigger: CheckpointRequest["trigger"]): string {
		const sequence = this.checkpointSequence;
		this.checkpointSequence = (this.checkpointSequence + 1) % 36 ** 6;
		const suffix = `${sequence.toString(36).padStart(6, "0")}-${randomBytes(4).toString("hex")}`;
		const id = sanitizeRefSegment(`${timestamp}-${suffix}-${trigger}`);
		return id ?? `${timestamp}-${suffix}`;
	}

	private refExists(id: string, repoRoot: string): boolean {
		const result = spawnSync("git", ["show-ref", "--verify", "--quiet", this.refFor(id)], { cwd: repoRoot, env: createGitEnvironment() });
		return result.status === 0;
	}

	private listGitNulPathEntries(
		args: string[],
		repoRoot: string,
		options?: Pick<GitCommandOptions, "gitIndexFile" | "input" | "literalPathspecs"> & { failureError?: "SnapshotPlanFailed" | "RestoreFailed" },
	): Result<GitPathEntry[]> {
		const dir = mkdtempSync(join(tmpdir(), "atomic-checkpoint-paths-"));
		const outputPath = join(dir, "paths.z");
		const outputFd = openSync(outputPath, "w");
		try {
			try {
				const env = createGitEnvironment();
				if (options?.gitIndexFile !== undefined) env.GIT_INDEX_FILE = options.gitIndexFile;
				if (options?.literalPathspecs === true) env.GIT_LITERAL_PATHSPECS = "1";
				const failureError = options?.failureError ?? "SnapshotPlanFailed";
				const result = spawnSync("git", args, {
					cwd: repoRoot,
					encoding: "utf8",
					env,
					input: options?.input,
					stdio: [options?.input === undefined ? "ignore" : "pipe", outputFd, "pipe"],
				});
				if (result.error) {
					return { ok: false, error: (result.error as NodeJS.ErrnoException).code === "ENOENT" ? "GitUnavailable" : failureError, message: result.error.message };
				}
				if (result.status !== 0) {
					return { ok: false, error: failureError, message: result.stderr ?? "Git path listing failed" };
				}
			} finally {
				closeSync(outputFd);
			}
			return readSafeNulPathEntries(outputPath, repoRoot);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	private listGitNulPaths(
		args: string[],
		repoRoot: string,
		options?: Pick<GitCommandOptions, "gitIndexFile" | "input" | "literalPathspecs"> & { failureError?: "SnapshotPlanFailed" | "RestoreFailed" },
	): Result<string[]> {
		const entries = this.listGitNulPathEntries(args, repoRoot, options);
		if (!entries.ok) return entries;
		return { ok: true, value: entries.value.map((entry) => entry.path) };
	}

	private git(args: string[], options?: GitCommandOptions): GitCommandResult {
		const env = createGitEnvironment(options?.env);
		if (options?.gitIndexFile !== undefined) env.GIT_INDEX_FILE = options.gitIndexFile;
		if (options?.literalPathspecs === true) env.GIT_LITERAL_PATHSPECS = "1";
		const result = spawnSync("git", args, { cwd: options?.cwd ?? this.cwd, encoding: "utf8", input: options?.input, env });
		if (result.error) return { ok: false, stdout: "", stderr: result.error.message, gitMissing: (result.error as NodeJS.ErrnoException).code === "ENOENT" };
		const stdout = result.stdout ?? "";
		const stderr = result.stderr ?? "";
		if (result.status !== 0) return { ok: false, stdout, stderr, gitMissing: false };
		return { ok: true, stdout, stderr };
	}
}

function isSameRestoreState(checkpoint: RestoreStateIdentity | undefined, state: RestoreStateIdentity): boolean {
	return (
		checkpoint !== undefined &&
		checkpoint.branch === state.branch &&
		checkpoint.headSha === state.headSha &&
		checkpoint.indexTreeSha === state.indexTreeSha &&
		checkpoint.worktreeTreeSha === state.worktreeTreeSha
	);
}

function checkpointCommitEnvironment(timestamp: number): NodeJS.ProcessEnv {
	const date = new Date(timestamp).toISOString();
	return {
		GIT_AUTHOR_NAME: CHECKPOINT_AUTHOR_NAME,
		GIT_AUTHOR_EMAIL: CHECKPOINT_AUTHOR_EMAIL,
		GIT_AUTHOR_DATE: date,
		GIT_COMMITTER_NAME: CHECKPOINT_AUTHOR_NAME,
		GIT_COMMITTER_EMAIL: CHECKPOINT_AUTHOR_EMAIL,
		GIT_COMMITTER_DATE: date,
	};
}

function normalizeStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readSafeNulPathEntries(outputPath: string, repoRoot: string): Result<GitPathEntry[]> {
	const fileStat = statSync(outputPath);
	if (fileStat.size > MAX_PATH_LIST_BYTES) {
		return { ok: false, error: "PathListTooLarge", message: `Git path list was ${fileStat.size} bytes, above the ${MAX_PATH_LIST_BYTES} byte safety limit` };
	}
	const fd = openSync(outputPath, "r");
	try {
		const decoder = new StringDecoder("utf8");
		const buffer = Buffer.alloc(PATH_LIST_CHUNK_BYTES);
		const entries: GitPathEntry[] = [];
		let pending = "";
		let bytesRead = 0;
		do {
			bytesRead = readSync(fd, buffer, 0, buffer.length, null);
			if (bytesRead > 0) {
				pending += decoder.write(buffer.subarray(0, bytesRead));
				const processed = drainNulPathEntries(pending, repoRoot, entries);
				if (!processed.ok) return processed;
				pending = processed.value;
			}
		} while (bytesRead > 0);
		pending += decoder.end();
		if (pending.length > 0) {
			const entry = normalizeGitPathMarker(repoRoot, pending);
			if (!entry) return { ok: false, error: "UnsafePath", message: `Unsafe Git path: ${pending}` };
			entries.push(entry);
		}
		if (entries.length > MAX_PATH_LIST_ENTRIES) {
			return { ok: false, error: "PathListTooLarge", message: `Git path list had more than ${MAX_PATH_LIST_ENTRIES} entries` };
		}
		return { ok: true, value: entries };
	} finally {
		closeSync(fd);
	}
}

function drainNulPathEntries(pending: string, repoRoot: string, entries: GitPathEntry[]): Result<string> {
	let rest = pending;
	let boundary = rest.indexOf("\0");
	while (boundary !== -1) {
		const rawPath = rest.slice(0, boundary);
		rest = rest.slice(boundary + 1);
		if (rawPath) {
			const entry = normalizeGitPathMarker(repoRoot, rawPath);
			if (!entry) return { ok: false, error: "UnsafePath", message: `Unsafe Git path: ${rawPath}` };
			entries.push(entry);
			if (entries.length > MAX_PATH_LIST_ENTRIES) {
				return { ok: false, error: "PathListTooLarge", message: `Git path list had more than ${MAX_PATH_LIST_ENTRIES} entries` };
			}
		}
		boundary = rest.indexOf("\0");
	}
	if (Buffer.byteLength(rest, "utf8") > MAX_SINGLE_PATH_BYTES) {
		return { ok: false, error: "UnsafePath", message: `Git path exceeded ${MAX_SINGLE_PATH_BYTES} bytes` };
	}
	return { ok: true, value: rest };
}

function normalizeGitPathMarker(repoRoot: string, rawPath: string): GitPathEntry | null {
	if (rawPath.endsWith("/")) {
		if (rawPath.endsWith("//")) return null;
		const path = toSafeRepoPath(repoRoot, rawPath.slice(0, -1));
		return path ? { kind: "directory-marker", path } : null;
	}
	const path = toSafeRepoPath(repoRoot, rawPath);
	return path ? { kind: "path", path } : null;
}

function toSafeRepoPath(repoRoot: string, rawPath: string): string | null {
	if (!rawPath || isAbsolute(rawPath) || rawPath.includes("\\")) return null;
	const parts = rawPath.split("/");
	if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
	const root = resolve(repoRoot);
	const resolved = resolve(root, rawPath);
	const fromRoot = relative(root, resolved);
	if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return null;
	return parts.join("/");
}

function targetParentPathsFor(paths: readonly string[]): Set<string> {
	const parents = new Set<string>();
	for (const path of paths) {
		const parts = path.split("/");
		for (let index = 1; index < parts.length; index++) {
			parents.add(parts.slice(0, index).join("/"));
		}
	}
	return parents;
}

function validateMetadataPathList(paths: readonly string[], repoRoot: string): Result<string[]> {
	const safePaths: string[] = [];
	for (const path of paths) {
		const safePath = toSafeRepoPath(repoRoot, path);
		if (!safePath) return { ok: false, error: "UnsafePath", message: `Unsafe checkpoint metadata path: ${path}` };
		safePaths.push(safePath);
	}
	const deduped = sortedUniquePaths(safePaths);
	const bounds = validatePathListBounds(deduped);
	if (!bounds.ok) return bounds;
	return { ok: true, value: deduped };
}

function sortedUniquePaths(paths: Iterable<string>): string[] {
	return [...new Set(paths)].sort();
}

function validatePathListBounds(paths: readonly string[]): Result<void> {
	if (paths.length > MAX_PATH_LIST_ENTRIES) {
		return { ok: false, error: "PathListTooLarge", message: `Git path list had more than ${MAX_PATH_LIST_ENTRIES} entries` };
	}
	let byteCount = 0;
	for (const path of paths) byteCount += Buffer.byteLength(path, "utf8") + 1;
	if (byteCount > MAX_PATH_LIST_BYTES) {
		return { ok: false, error: "PathListTooLarge", message: `Git path list was ${byteCount} bytes, above the ${MAX_PATH_LIST_BYTES} byte safety limit` };
	}
	return { ok: true, value: undefined };
}

function lstatRepoPath(repoRoot: string, path: string): Result<Stats, "RestoreFailed"> | null {
	try {
		return { ok: true, value: lstatSync(join(repoRoot, path)) };
	} catch (error) {
		if (isNotFoundError(error)) return null;
		return { ok: false, error: "RestoreFailed", message: error instanceof Error ? error.message : String(error) };
	}
}

function isNotFoundError(error: unknown): boolean {
	return hasErrnoCode(error, ["ENOENT", "ENOTDIR"]);
}

function isNonEmptyDirectoryError(error: unknown): boolean {
	return hasErrnoCode(error, ["ENOTEMPTY", "EEXIST", "ENOENT"]);
}

function hasErrnoCode(error: unknown, codes: readonly string[]): boolean {
	if (typeof error !== "object" || error === null || !("code" in error)) return false;
	return codes.includes((error as NodeJS.ErrnoException).code ?? "");
}

function formatFilesystemError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function removeEmptyParentDirs(repoRoot: string, path: string): void {
	const parts = path.split("/").slice(0, -1);
	while (parts.length > 0) {
		const parent = parts.join("/");
		try {
			rmdirSync(join(repoRoot, parent));
		} catch (error) {
			if (!isNonEmptyDirectoryError(error)) throw error;
			return;
		}
		parts.pop();
	}
}

function appendTruncationMarker(text: string): string {
	const trimmed = text.trimEnd();
	return `${trimmed}${trimmed ? "\n" : ""}${PREVIEW_TRUNCATION_MARKER}\n`;
}

function formatPathPreview(paths: readonly string[]): string {
	return paths.length === 0 ? "(none)" : paths.join("\n");
}

function trackedDirectoryPrefixes(paths: readonly string[]): Set<string> {
	return targetParentPathsFor(paths);
}

function findIgnoredDir(path: string, ignoredNames: Set<string>, includeLeaf: boolean): string | null {
	const parts = path.split("/");
	const limit = includeLeaf ? parts.length : parts.length - 1;
	for (let index = 0; index < limit; index++) {
		const part = parts[index];
		if (part !== undefined && ignoredNames.has(part)) return parts.slice(0, index + 1).join("/");
	}
	return null;
}

function untrackedDirectoryGroup(path: string, trackedPrefixes: Set<string>): string | null {
	const parts = path.split("/");
	if (parts.length <= 1) return null;
	for (let index = 1; index < parts.length; index++) {
		const prefix = parts.slice(0, index).join("/");
		if (!trackedPrefixes.has(prefix)) return prefix;
	}
	return parts.slice(0, -1).join("/");
}

function isUnderAnyPath(path: string, roots: Set<string>): boolean {
	for (const root of roots) {
		if (path === root || path.startsWith(`${root}/`)) return true;
	}
	return false;
}

function checkpointOwnedUntrackedExactCandidates(metadata: CheckpointMetadata, currentUntrackedFiles: readonly string[], targetTreePaths: readonly string[]): string[] {
	const targetPathSet = new Set(targetTreePaths);
	const preexistingUntrackedSet = new Set(metadata.preexistingUntrackedFiles);
	const skippedLargeSet = new Set(metadata.skippedLargeFiles);
	return currentUntrackedFiles
		.filter((path) => targetPathSet.has(path) && preexistingUntrackedSet.has(path) && !skippedLargeSet.has(path))
		.sort();
}

function chunkPathArgs(paths: readonly string[]): string[][] {
	const chunks: string[][] = [];
	let chunk: string[] = [];
	let chunkBytes = 0;
	for (const path of paths) {
		const pathBytes = Buffer.byteLength(path, "utf8") + 1;
		if (chunk.length > 0 && chunkBytes + pathBytes > PATH_LIST_CHUNK_BYTES) {
			chunks.push(chunk);
			chunk = [];
			chunkBytes = 0;
		}
		chunk.push(path);
		chunkBytes += pathBytes;
	}
	if (chunk.length > 0) chunks.push(chunk);
	return chunks;
}

function isUnsupportedDiffFilesNulPathspecs(message: string | undefined): boolean {
	return message?.includes("usage: git diff-files") === true;
}

function isUnsupportedLsFilesNulPathspecs(message: string | undefined): boolean {
	return message?.includes("usage: git ls-files") === true || message?.includes("unknown option `pathspec-from-file=-'") === true;
}

function isUnsupportedDiffCachedNulPathspecs(message: string | undefined): boolean {
	return message?.includes("usage: git diff") === true || message?.includes("unknown option `pathspec-from-file=-'") === true;
}

function compareCheckpointsNewestFirst(a: CheckpointMetadata, b: CheckpointMetadata): number {
	return b.timestamp - a.timestamp || b.id.localeCompare(a.id);
}
