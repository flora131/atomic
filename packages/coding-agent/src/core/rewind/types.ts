export type RewindError =
	| "NotGitRepository"
	| "GitUnavailable"
	| "CheckpointNotFound"
	| "InvalidCheckpointRef"
	| "BranchMismatch"
	| "HeadMoved"
	| "SnapshotUnchanged"
	| "SnapshotPlanFailed"
	| "RefCollisionExhausted"
	| "PathListTooLarge"
	| "UnsafePath"
	| "UnsafeUntrackedOverwrite"
	| "CheckpointObjectMissing"
	| "RestoreWhileStreaming"
	| "RestoreFailed"
	| "PruneFailed";

export type Result<T, E extends string = RewindError> =
	| { ok: true; value: T }
	| { ok: false; error: E; message?: string };

export type CheckpointTrigger = "resume" | "turn" | "before-restore";

export type CheckpointMetadata = {
	version: 1;
	id: string;
	sessionId: string;
	leafEntryId: string | null;
	trigger: CheckpointTrigger;
	turnIndex: number;
	description: string;
	toolNames: string[];
	branch: string;
	headSha: string;
	indexTreeSha: string;
	worktreeTreeSha: string;
	timestamp: number;
	preexistingUntrackedFiles: string[];
	skippedLargeFiles: string[];
	skippedLargeDirs: string[];
	skippedIgnoredDirs: string[];
	snapshotPolicy?: SafeSnapshotPolicy;
};

export type SafeSnapshotPolicy = {
	maxUntrackedFileBytes: number;
	maxUntrackedDirFiles: number;
	ignoredDirNames: readonly string[];
};

export type SafeSnapshotPlan = {
	allowedUntrackedFiles: readonly string[];
	preexistingUntrackedFiles: readonly string[];
	skippedLargeFiles: readonly string[];
	skippedLargeDirs: readonly string[];
	skippedIgnoredDirs: readonly string[];
};

export type CheckpointRequest = {
	leafEntryId?: string | null;
	trigger: CheckpointTrigger;
	turnIndex?: number;
	description?: string;
	toolNames?: string[];
};

export type CheckpointEngineOptions = {
	cwd: string;
	sessionId: string;
};

export type DiffPreview = {
	text: string;
	worktreeText?: string;
	indexText?: string;
	truncated?: boolean;
	removedUntrackedFiles?: string[];
	unsafeRestorePaths?: string[];
};

export type RestoredFiles = {
	checkpoint: CheckpointMetadata;
	removedUntrackedFiles?: string[];
};

export type DeletedCheckpoint = {
	id: string;
};

export type RestoreStateIdentity = Pick<CheckpointMetadata, "branch" | "headSha" | "indexTreeSha" | "worktreeTreeSha">;

export type RewindSettings = {
	enabled: boolean;
	maxCheckpoints: number;
	checkpointOnSessionStart: boolean;
	checkpointOnMutatingTurn: boolean;
	promptOnTree: boolean;
	promptOnFork: boolean;
	maxUntrackedFileBytes: number;
	maxUntrackedDirFiles: number;
	ignoredDirNames: string[];
};
