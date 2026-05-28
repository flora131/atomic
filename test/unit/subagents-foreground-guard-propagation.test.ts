import { afterAll, beforeEach, describe, mock, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as asyncExecution from "../../packages/subagents/src/runs/background/async-execution.ts";
import * as foregroundExecution from "../../packages/subagents/src/runs/foreground/execution.ts";
import { WORKFLOW_STAGE_SUBAGENT_GUARD_ENV } from "../../packages/subagents/src/shared/types.js";

interface MinimalRunSyncOptions {
	maxSubagentDepth?: number;
	workflowStageSubagentGuard?: boolean;
}

interface MinimalAsyncChainParams {
	resultMode?: "chain" | "parallel";
	maxSubagentDepth?: number;
	workflowStageSubagentGuard?: boolean;
}

interface MinimalAsyncSingleParams {
	maxSubagentDepth?: number;
	workflowStageSubagentGuard?: boolean;
}

interface CapturedRunSyncCall {
	agentName: string;
	options: MinimalRunSyncOptions;
}

interface CapturedAsyncChainCall {
	id: string;
	params: MinimalAsyncChainParams;
}

interface CapturedAsyncSingleCall {
	id: string;
	params: MinimalAsyncSingleParams;
}

interface MinimalAgentConfig {
	name: string;
	description: string;
	systemPromptMode: "append" | "replace";
	inheritProjectContext: boolean;
	inheritSkills: boolean;
	systemPrompt: string;
	source: "builtin" | "user" | "project";
	filePath: string;
	maxSubagentDepth?: number;
}

interface MinimalExecutorModule {
	createSubagentExecutor: (deps: unknown) => {
		execute: (
			id: string,
			params: Record<string, unknown>,
			signal: AbortSignal,
			onUpdate: undefined,
			ctx: Record<string, unknown>,
		) => Promise<{ isError?: boolean }>;
	};
}

const runSyncCalls: CapturedRunSyncCall[] = [];
const asyncChainCalls: CapturedAsyncChainCall[] = [];
const asyncSingleCalls: CapturedAsyncSingleCall[] = [];

const emptyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };

const runSyncMock = mock(async (...args: [string, MinimalAgentConfig[], string, string, MinimalRunSyncOptions]) => {
	const [, , agentName, task, options] = args;
	runSyncCalls.push({ agentName, options });
	return {
		agent: agentName,
		task,
		exitCode: 0,
		messages: [],
		usage: emptyUsage,
		finalOutput: `${agentName} output`,
	};
});

const executeAsyncChainMock = mock((...args: [string, MinimalAsyncChainParams]) => {
	const [id, params] = args;
	asyncChainCalls.push({ id, params });
	return {
		content: [{ type: "text" as const, text: "Launching in background..." }],
		details: { mode: params.resultMode ?? "chain", results: [] },
	};
});

const executeAsyncSingleMock = mock((...args: [string, MinimalAsyncSingleParams]) => {
	const [id, params] = args;
	asyncSingleCalls.push({ id, params });
	return {
		content: [{ type: "text" as const, text: "Launching in background..." }],
		details: { mode: "single" as const, results: [] },
	};
});

const runSyncSpy = spyOn(foregroundExecution, "runSync").mockImplementation(
	runSyncMock as typeof foregroundExecution.runSync,
);
const executeAsyncChainSpy = spyOn(asyncExecution, "executeAsyncChain").mockImplementation(
	executeAsyncChainMock as typeof asyncExecution.executeAsyncChain,
);
const executeAsyncSingleSpy = spyOn(asyncExecution, "executeAsyncSingle").mockImplementation(
	executeAsyncSingleMock as typeof asyncExecution.executeAsyncSingle,
);
const formatAsyncStartedMessageSpy = spyOn(asyncExecution, "formatAsyncStartedMessage").mockImplementation(
	(id: string) => `Started ${id}`,
);
const isAsyncAvailableSpy = spyOn(asyncExecution, "isAsyncAvailable").mockImplementation(() => true);

const executorModulePath = "../../packages/subagents/src/runs/foreground/subagent-executor.ts";
const { createSubagentExecutor } = await import(executorModulePath) as MinimalExecutorModule;

function makeAgent(name: string, maxSubagentDepth?: number): MinimalAgentConfig {
	return {
		name,
		description: `${name} test agent`,
		systemPromptMode: "replace",
		inheritProjectContext: false,
		inheritSkills: false,
		systemPrompt: "You are a test agent.",
		source: "project",
		filePath: `/tmp/${name}.md`,
		...(maxSubagentDepth !== undefined ? { maxSubagentDepth } : {}),
	};
}

function makeState() {
	return {
		baseCwd: "",
		currentSessionId: null,
		asyncJobs: new Map(),
		foregroundRuns: new Map(),
		foregroundControls: new Map(),
		lastForegroundControlId: null,
		cleanupTimers: new Map(),
		lastUiContext: null,
		poller: null,
		completionSeen: new Map(),
		watcher: null,
		watcherRestartTimer: null,
		resultFileCoalescer: {
			schedule: () => false,
			clear: () => {},
		},
	};
}

function makeWorkflowStageContext(cwd: string, uiResult?: unknown): Record<string, unknown> {
	return {
		cwd,
		hasUI: uiResult !== undefined,
		ui: {
			custom: mock(async () => uiResult),
		},
		model: undefined,
		modelRegistry: {
			getAvailable: () => [],
		},
		sessionManager: {
			getSessionFile: () => undefined,
			getSessionId: () => "parent-session",
			getLeafId: () => null,
		},
		orchestrationContext: {
			kind: "workflow-stage",
			workflowRunId: "workflow-run-1",
			workflowStageId: "stage-1",
			workflowStageName: "Stage 1",
			constraints: { disableWorkflowTool: true, maxSubagentDepth: 1 },
		},
	};
}

function makeExecutor(cwd: string, agents: MinimalAgentConfig[]) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-subagent-guard-"));
	return createSubagentExecutor({
		pi: {
			events: {
				on: () => () => {},
				emit: () => {},
			},
			getSessionName: () => "parent-session-name",
		},
		state: makeState(),
		config: { maxSubagentDepth: 2, parallel: { concurrency: 4, maxTasks: 8 } },
		asyncByDefault: false,
		tempArtifactsDir: path.join(tempRoot, "artifacts"),
		getSubagentSessionRoot: () => path.join(tempRoot, "sessions"),
		expandTilde: (p: string) => p,
		discoverAgents: () => ({ agents }),
	});
}

function clearSubagentGuardEnv(): void {
	delete process.env.ATOMIC_SUBAGENT_DEPTH;
	delete process.env.ATOMIC_SUBAGENT_MAX_DEPTH;
	delete process.env[WORKFLOW_STAGE_SUBAGENT_GUARD_ENV];
}

function resetCapturedCalls(): void {
	runSyncCalls.length = 0;
	asyncChainCalls.length = 0;
	asyncSingleCalls.length = 0;
	runSyncMock.mockClear();
	executeAsyncChainMock.mockClear();
	executeAsyncSingleMock.mockClear();
}

function assertGuardedRunSyncCalls(expectedAgentNames: string[]): void {
	assert.deepEqual(runSyncCalls.map((call) => call.agentName), expectedAgentNames);
	for (const call of runSyncCalls) {
		assert.equal(call.options.maxSubagentDepth, 1);
		assert.equal(call.options.workflowStageSubagentGuard, true);
	}
}

beforeEach(() => {
	resetCapturedCalls();
	clearSubagentGuardEnv();
});

afterAll(() => {
	runSyncSpy.mockRestore();
	executeAsyncChainSpy.mockRestore();
	executeAsyncSingleSpy.mockRestore();
	formatAsyncStartedMessageSpy.mockRestore();
	isAsyncAvailableSpy.mockRestore();
	clearSubagentGuardEnv();
});

describe("foreground workflow-stage subagent guard propagation", () => {
	test("passes workflow-stage guard to sequential and parallel chain children", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-chain-guard-"));
		const agents = [makeAgent("alpha"), makeAgent("beta"), makeAgent("gamma")];
		const executor = makeExecutor(cwd, agents);

		const result = await executor.execute(
			"subagent",
			{
				chain: [
					{ agent: "alpha", task: "first" },
					{ parallel: [{ agent: "beta", task: "second" }, { agent: "gamma", task: "third" }] },
				],
				clarify: false,
			},
			new AbortController().signal,
			undefined,
			makeWorkflowStageContext(cwd),
		);

		assert.equal(result.isError, undefined);
		assertGuardedRunSyncCalls(["alpha", "beta", "gamma"]);
	});

	test("passes workflow-stage guard to foreground parallel children", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-parallel-guard-"));
		const agents = [makeAgent("alpha"), makeAgent("beta")];
		const executor = makeExecutor(cwd, agents);

		const result = await executor.execute(
			"subagent",
			{
				tasks: [{ agent: "alpha", task: "first" }, { agent: "beta", task: "second" }],
				clarify: false,
			},
			new AbortController().signal,
			undefined,
			makeWorkflowStageContext(cwd),
		);

		assert.equal(result.isError, undefined);
		assertGuardedRunSyncCalls(["alpha", "beta"]);
	});

	test("passes workflow-stage guard when foreground parallel clarify launches async", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-parallel-async-guard-"));
		const agents = [makeAgent("alpha"), makeAgent("beta")];
		const executor = makeExecutor(cwd, agents);
		const uiResult = {
			confirmed: true,
			runInBackground: true,
			templates: ["first clarified", "second clarified"],
			behaviorOverrides: [{}, {}],
		};

		const result = await executor.execute(
			"subagent",
			{
				tasks: [{ agent: "alpha", task: "first" }, { agent: "beta", task: "second" }],
				clarify: true,
			},
			new AbortController().signal,
			undefined,
			makeWorkflowStageContext(cwd, uiResult),
		);

		assert.equal(result.isError, undefined);
		assert.equal(runSyncCalls.length, 0);
		assert.equal(asyncChainCalls.length, 1);
		assert.equal(asyncChainCalls[0]!.params.maxSubagentDepth, 1);
		assert.equal(asyncChainCalls[0]!.params.workflowStageSubagentGuard, true);
	});

	test("passes workflow-stage guard when single clarify launches async", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-single-async-guard-"));
		const agents = [makeAgent("alpha")];
		const executor = makeExecutor(cwd, agents);
		const uiResult = {
			confirmed: true,
			runInBackground: true,
			templates: ["clarified single task"],
			behaviorOverrides: [{}],
		};

		const result = await executor.execute(
			"subagent",
			{
				agent: "alpha",
				task: "single task",
				clarify: true,
			},
			new AbortController().signal,
			undefined,
			makeWorkflowStageContext(cwd, uiResult),
		);

		assert.equal(result.isError, undefined);
		assert.equal(runSyncCalls.length, 0);
		assert.equal(asyncSingleCalls.length, 1);
		assert.equal(asyncSingleCalls[0]!.params.maxSubagentDepth, 1);
		assert.equal(asyncSingleCalls[0]!.params.workflowStageSubagentGuard, true);
	});
});
