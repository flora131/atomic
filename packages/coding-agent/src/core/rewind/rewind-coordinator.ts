import type { BashResult } from "../bash-executor.js";
import { CheckpointEngine } from "./checkpoint-engine.js";
import type {
	CheckpointMetadata,
	CheckpointRequest,
	DiffPreview,
	RestoredFiles,
	Result,
	RestoreStateIdentity,
	RewindSettings,
	SafeSnapshotPolicy,
} from "./types.js";

const MUTATING_TOOL_NAMES = ["bash", "edit", "write"] as const;
type MutatingToolName = (typeof MUTATING_TOOL_NAMES)[number];

export type RewindCoordinatorStatus = {
	state: "disabled" | "unavailable" | "ready";
	checkpointCount: number;
	message?: string;
};

export type RewindCoordinatorOptions = {
	cwd: string;
	sessionId: string;
	settings: RewindSettings;
	engine?: CheckpointEngine;
	onStatusChange?: (status: RewindCoordinatorStatus) => void;
};

export type RewindToolObservation = {
	toolName: string;
};

export type RewindTurnInput = {
	turnIndex: number;
	leafEntryId?: string | null;
};

export type RewindInteractiveBashPrepareInput = RewindTurnInput & {
	command: string;
};

export type RewindInteractiveBashInput = RewindInteractiveBashPrepareInput & {
	// Keep the bash result on this boundary for parity with recordBashResult callers;
	// checkpointing currently only needs command and turn metadata.
	result: BashResult;
};

type InteractiveBashCheckpointBaseline = {
	tokenId: string;
	command: string;
	turnIndex: number;
	leafEntryId: string | null;
	restoreState: RestoreStateIdentity;
};

type PruneToLimitOptions = {
	protectIds?: readonly string[];
};

export class RewindCoordinator {
	private readonly engine: CheckpointEngine;
	private settings: RewindSettings;
	private readonly onStatusChange?: (status: RewindCoordinatorStatus) => void;
	private initialized = false;
	private available = false;
	private status: RewindCoordinatorStatus;
	private checkpoints: CheckpointMetadata[] = [];
	private postRestoreBaseline: RestoreStateIdentity | null = null;
	private initialRestoreState: RestoreStateIdentity | null = null;
	private pendingInteractiveBashBaseline: InteractiveBashCheckpointBaseline | null = null;
	private readonly observedMutatingTools = new Set<MutatingToolName>();

	constructor(options: RewindCoordinatorOptions) {
		this.engine = options.engine ?? new CheckpointEngine({ cwd: options.cwd, sessionId: options.sessionId });
		this.settings = options.settings;
		this.onStatusChange = options.onStatusChange;
		this.status = this.settings.enabled
			? { state: "unavailable", checkpointCount: 0, message: "NotInitialized" }
			: { state: "disabled", checkpointCount: 0 };
	}

	getStatus(): RewindCoordinatorStatus {
		return { ...this.status };
	}

	getFooterStatusText(): string | undefined {
		if (this.status.state !== "ready") return undefined;
		return `◆ ${this.status.checkpointCount} ${this.status.checkpointCount === 1 ? "checkpoint" : "checkpoints"}`;
	}

	updateSettings(settings: RewindSettings): void {
		const wasEnabled = this.settings.enabled;
		this.settings = settings;
		if (!settings.enabled) {
			this.resetRuntimeState();
			this.setStatus({ state: "disabled", checkpointCount: 0 });
			return;
		}
		if (!wasEnabled) {
			this.resetRuntimeState();
			this.setStatus({ state: "unavailable", checkpointCount: 0, message: "NotInitialized" });
			return;
		}
		if (this.initialized && this.available) {
			this.refreshCache();
			this.pruneToLimit();
			this.publishReadyStatus();
		}
	}

	initialize(input: RewindTurnInput = { turnIndex: 0 }, options: { checkpointOnSessionStart?: boolean } = {}): Result<CheckpointMetadata | null> {
		if (this.initialized) return { ok: true, value: null };
		this.initialized = true;
		if (!this.settings.enabled) {
			this.setStatus({ state: "disabled", checkpointCount: 0 });
			return { ok: true, value: null };
		}

		const repo = this.engine.isGitRepo();
		if (!repo.ok) {
			this.available = false;
			this.setStatus({ state: "unavailable", checkpointCount: 0, message: repo.error });
			return { ok: false, error: repo.error, message: repo.message };
		}
		this.available = true;
		this.refreshCache();

		const sessionStartCheckpointDisabled = !this.settings.checkpointOnSessionStart;
		const callerSkippedSessionStartCheckpoint = options.checkpointOnSessionStart === false;
		if (sessionStartCheckpointDisabled || callerSkippedSessionStartCheckpoint) {
			if (!callerSkippedSessionStartCheckpoint) {
				const baseline = this.engine.getCurrentRestoreState(this.snapshotPolicy());
				if (!baseline.ok) return { ok: false, error: baseline.error, message: baseline.message };
				this.initialRestoreState = baseline.value;
			}
			this.publishReadyStatus();
			return { ok: true, value: null };
		}

		const created = this.createCheckpoint({
			trigger: "resume",
			turnIndex: input.turnIndex,
			leafEntryId: input.leafEntryId ?? null,
			description: "Session resume",
			toolNames: [],
		});
		return checkpointOrNullWhenUnchanged(created);
	}

	startTurn(): void {
		this.observedMutatingTools.clear();
	}

	observeToolExecutionEnd(observation: RewindToolObservation): void {
		if (!this.settings.enabled || !this.settings.checkpointOnMutatingTurn) return;
		// Built-in mutating tools can change files before returning an error/abort.
		const toolName = toMutatingToolName(observation.toolName);
		if (!toolName) return;
		this.observedMutatingTools.add(toolName);
	}

	finalizeTurnCheckpoint(input: RewindTurnInput): Result<CheckpointMetadata | null> {
		const toolNames = [...this.observedMutatingTools].sort();
		this.observedMutatingTools.clear();
		if (!this.settings.enabled || !this.settings.checkpointOnMutatingTurn || toolNames.length === 0) {
			return { ok: true, value: null };
		}

		return this.createTurnCheckpoint(input, {
			description: `Turn ${input.turnIndex}: ${toolNames.join(", ")}`,
			toolNames,
		});
	}

	prepareInteractiveBashCheckpoint(input: RewindInteractiveBashPrepareInput): Result<{ tokenId: string } | null> {
		if (!this.settings.enabled || !this.settings.checkpointOnMutatingTurn) {
			this.pendingInteractiveBashBaseline = null;
			return { ok: true, value: null };
		}

		const leafEntryId = input.leafEntryId ?? null;
		if (
			this.pendingInteractiveBashBaseline?.command === input.command &&
			this.pendingInteractiveBashBaseline.turnIndex === input.turnIndex &&
			this.pendingInteractiveBashBaseline.leafEntryId === leafEntryId
		) {
			return { ok: true, value: { tokenId: this.pendingInteractiveBashBaseline.tokenId } };
		}

		this.pendingInteractiveBashBaseline = null;
		const initialized = this.initialize(input, { checkpointOnSessionStart: false });
		if (!initialized.ok) return initialized;
		if (!this.available) return { ok: false, error: "NotGitRepository" };
		const restoreState = this.engine.getCurrentRestoreState(this.snapshotPolicy());
		if (!restoreState.ok) return restoreState;
		const tokenId = `bash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		this.pendingInteractiveBashBaseline = {
			tokenId,
			command: input.command,
			turnIndex: input.turnIndex,
			leafEntryId,
			restoreState: restoreState.value,
		};
		this.publishReadyStatus();
		return { ok: true, value: { tokenId } };
	}

	clearPendingInteractiveBashCheckpoint(): void {
		this.pendingInteractiveBashBaseline = null;
	}

	checkpointInteractiveBashResult(input: RewindInteractiveBashInput): Result<CheckpointMetadata | null> {
		const baseline = this.pendingInteractiveBashBaseline;
		this.pendingInteractiveBashBaseline = null;
		if (!this.settings.enabled || !this.settings.checkpointOnMutatingTurn) {
			return { ok: true, value: null };
		}

		const initialized = this.initialize(input, { checkpointOnSessionStart: false });
		if (!initialized.ok) return initialized;
		if (!this.available) return { ok: false, error: "NotGitRepository" };

		if (!baseline || baseline.command !== input.command) {
			const current = this.engine.getCurrentRestoreState(this.snapshotPolicy());
			if (!current.ok) return current;
			this.initialRestoreState = current.value;
			this.refreshCache();
			this.publishReadyStatus();
			return { ok: true, value: null };
		}

		const changed = this.engine.hasCurrentRestoreStateChangedFrom(baseline.restoreState, this.snapshotPolicy());
		if (!changed.ok) return { ok: false, error: changed.error, message: changed.message };
		if (!changed.value) {
			this.refreshCache();
			this.publishReadyStatus();
			return { ok: true, value: null };
		}

		const created = this.createCheckpoint({
			trigger: "turn",
			turnIndex: input.turnIndex,
			leafEntryId: input.leafEntryId ?? null,
			description: `Interactive bash: ${formatBashCommandForDescription(input.command)}`,
			toolNames: ["bash"],
		});
		return checkpointOrNullWhenUnchanged(created);
	}

	listCheckpoints(): Result<CheckpointMetadata[]> {
		if (!this.settings.enabled) {
			this.setStatus({ state: "disabled", checkpointCount: 0 });
			return { ok: false, error: "NotGitRepository" };
		}
		const repo = this.engine.isGitRepo();
		if (!repo.ok) {
			this.available = false;
			this.setStatus({ state: "unavailable", checkpointCount: 0, message: repo.error });
			return { ok: false, error: repo.error, message: repo.message };
		}
		this.available = true;
		const listed = this.engine.listCheckpoints();
		if (!listed.ok) {
			this.setStatus({ state: "unavailable", checkpointCount: 0, message: listed.error });
			return listed;
		}
		this.checkpoints = listed.value;
		this.publishReadyStatus();
		return { ok: true, value: [...this.checkpoints] };
	}

	previewCheckpoint(id: string): Result<DiffPreview> {
		const available = this.listCheckpoints();
		if (!available.ok) return available;
		return this.engine.previewDiff(id, this.snapshotPolicy());
	}

	checkRestoreEligibility(id: string): Result<CheckpointMetadata> {
		const available = this.listCheckpoints();
		if (!available.ok) return available;
		return this.engine.checkRestoreEligibility(id);
	}

	restoreFilesToCheckpoint(id: string, input: RewindTurnInput): Result<RestoredFiles> {
		const available = this.listCheckpoints();
		if (!available.ok) return available;

		const target = this.engine.loadCheckpoint(id);
		if (!target.ok) return target;

		const safety = this.createCheckpoint(
			{
				trigger: "before-restore",
				turnIndex: input.turnIndex,
				leafEntryId: input.leafEntryId ?? null,
				description: `Before rewind to ${id}`,
				toolNames: [],
			},
			{ prune: false },
		);
		if (!safety.ok) {
			if (safety.error !== "SnapshotUnchanged" || this.checkpoints.length === 0) {
				return { ok: false, error: safety.error, message: safety.message };
			}
		}

		const safetyId = safety.ok ? safety.value.id : undefined;
		const restored = this.engine.restoreCheckpoint(id, this.snapshotPolicy());
		if (!restored.ok) {
			if (restored.error === "NotGitRepository" || restored.error === "GitUnavailable") {
				this.available = false;
				this.setStatus({ state: "unavailable", checkpointCount: 0, message: restored.error });
			} else {
				const protectIds = restored.error === "RestoreFailed" && safetyId !== undefined ? [target.value.id, safetyId] : [target.value.id];
				this.refreshAfterRestoreAttempt(protectIds);
			}
			return restored;
		}
		this.postRestoreBaseline = restoreStateIdentity(restored.value.checkpoint);
		this.refreshAfterRestoreAttempt(this.successfulRestoreProtectIds(target.value.id, safetyId));
		return restored;
	}

	private createTurnCheckpoint(
		input: RewindTurnInput,
		details: Pick<CheckpointRequest, "description" | "toolNames">,
		initializeOptions?: { checkpointOnSessionStart?: boolean },
	): Result<CheckpointMetadata | null> {
		const initializationOptions = this.initialized ? initializeOptions : { checkpointOnSessionStart: false };
		const initialized = this.initialize(input, initializationOptions);
		if (!initialized.ok) return initialized;
		if (!this.available) return { ok: false, error: "NotGitRepository" };
		const changed = this.hasChangedSinceKnownRestoreState();
		if (!changed.ok) return { ok: false, error: changed.error, message: changed.message };
		if (!changed.value) {
			this.refreshCache();
			this.publishReadyStatus();
			return { ok: true, value: null };
		}

		const created = this.createCheckpoint({
			trigger: "turn",
			turnIndex: input.turnIndex,
			leafEntryId: input.leafEntryId ?? null,
			description: details.description,
			toolNames: details.toolNames,
		});
		return checkpointOrNullWhenUnchanged(created);
	}

	private createCheckpoint(request: CheckpointRequest, options: { prune?: boolean } = {}): Result<CheckpointMetadata> {
		const created = this.engine.createCheckpoint(request, this.snapshotPolicy());
		if (!created.ok) {
			if (created.error === "SnapshotUnchanged") {
				this.refreshCache();
				this.publishReadyStatus();
			} else if (created.error === "NotGitRepository" || created.error === "GitUnavailable") {
				this.available = false;
				this.setStatus({ state: "unavailable", checkpointCount: 0, message: created.error });
			}
			return created;
		}
		this.postRestoreBaseline = null;
		this.initialRestoreState = null;
		this.refreshCache();
		if (options.prune !== false) this.pruneToLimit();
		this.publishReadyStatus();
		return created;
	}

	private snapshotPolicy(): SafeSnapshotPolicy {
		return {
			maxUntrackedFileBytes: this.settings.maxUntrackedFileBytes,
			maxUntrackedDirFiles: this.settings.maxUntrackedDirFiles,
			ignoredDirNames: [...this.settings.ignoredDirNames],
		};
	}

	private resetRuntimeState(): void {
		this.available = false;
		this.initialized = false;
		this.checkpoints = [];
		this.postRestoreBaseline = null;
		this.initialRestoreState = null;
		this.pendingInteractiveBashBaseline = null;
		this.observedMutatingTools.clear();
	}

	private hasChangedSinceKnownRestoreState(): Result<boolean> {
		const latest = this.checkpoints[0];
		const baseline = this.postRestoreBaseline ?? this.initialRestoreState ?? latest;
		if (baseline) return this.engine.hasCurrentRestoreStateChangedFrom(baseline, this.snapshotPolicy());
		return this.engine.isCurrentRestoreStateDirty(this.snapshotPolicy());
	}

	private successfulRestoreProtectIds(targetId: string, safetyId: string | undefined): string[] {
		if (safetyId === undefined) return [targetId];
		if (this.settings.maxCheckpoints <= 1) return [safetyId];
		return [safetyId, targetId];
	}

	private refreshCache(): void {
		const listed = this.engine.listCheckpoints();
		if (listed.ok) {
			this.checkpoints = listed.value;
			return;
		}
		this.checkpoints = [];
	}

	private refreshAfterRestoreAttempt(protectIds?: readonly string[]): void {
		this.refreshCache();
		if (protectIds !== undefined) this.pruneToLimit({ protectIds });
		this.publishReadyStatus();
	}

	private pruneToLimit(options: PruneToLimitOptions = {}): void {
		if (this.checkpoints.length <= this.settings.maxCheckpoints) return;
		const protectedIds = new Set(options.protectIds ?? []);
		const removable = [...this.checkpoints]
			.filter((checkpoint) => !protectedIds.has(checkpoint.id))
			.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
		for (const checkpoint of removable) {
			if (this.checkpoints.length <= this.settings.maxCheckpoints) break;
			const deleted = this.engine.deleteCheckpoint(checkpoint.id);
			if (deleted.ok) {
				this.checkpoints = this.checkpoints.filter((current) => current.id !== checkpoint.id);
			}
		}
	}

	private publishReadyStatus(): void {
		this.setStatus({ state: "ready", checkpointCount: this.checkpoints.length });
	}

	private setStatus(status: RewindCoordinatorStatus): void {
		const previous = this.status;
		this.status = status;
		if (statusChanged(previous, status)) {
			this.onStatusChange?.({ ...status });
		}
	}
}

function statusChanged(previous: RewindCoordinatorStatus, next: RewindCoordinatorStatus): boolean {
	return previous.state !== next.state || previous.checkpointCount !== next.checkpointCount || previous.message !== next.message;
}

function checkpointOrNullWhenUnchanged(result: Result<CheckpointMetadata>): Result<CheckpointMetadata | null> {
	if (!result.ok && result.error === "SnapshotUnchanged") return { ok: true, value: null };
	return result;
}

function formatBashCommandForDescription(command: string): string {
	return command.replace(/\s+/g, " ").trim().slice(0, 450);
}

function restoreStateIdentity(metadata: CheckpointMetadata): RestoreStateIdentity {
	return {
		branch: metadata.branch,
		headSha: metadata.headSha,
		indexTreeSha: metadata.indexTreeSha,
		worktreeTreeSha: metadata.worktreeTreeSha,
	};
}

function toMutatingToolName(toolName: string): MutatingToolName | null {
	for (const mutatingToolName of MUTATING_TOOL_NAMES) {
		if (toolName === mutatingToolName) return mutatingToolName;
	}
	return null;
}
