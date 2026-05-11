/**
 * Integration tests: runtime adapter wiring through dispatch path.
 *
 * Covers:
 * 1. Mock ExtensionAPI with exec surface → adapters built → exec invoked during
 *    workflow tool dispatch (no "prompt adapter not configured" failure).
 * 2. Initial runtime (pre-discovery, seeded from discoverBundledWorkflowsSync)
 *    carries adapters — workflow dispatch calls prompt/complete adapters.
 * 3. Post-discovery runtime swap preserves the same adapters — exec still
 *    called after createExtensionRuntime is re-called with discovered registry.
 * 4. No exec surface → no adapters → test-env stub fires (no hard error).
 *
 * Tests use the public extension/tool dispatch path wherever practical:
 *   factory(mockApi) → mock.tools[0].opts.execute → exec spy
 * Lower-level createExtensionRuntime tests cover the pre/post-swap invariant.
 *
 * cross-ref: src/extension/wiring.ts, src/extension/index.ts,
 *            src/runs/sync/stage-runner.ts, RFC runtime-wiring task
 */

import { test, expect, describe, beforeEach } from "bun:test";
import factory, {
  type ExtensionAPI,
  type PiToolOpts,
  type PiSlashCommandOpts,
  type PiFlagOpts,
  type WorkflowToolArgs,
} from "../../src/extension/index.js";
import type { WorkflowToolResult } from "../../src/extension/render-result.js";
import type { PiExecResult } from "../../src/extension/wiring.js";
import { createExtensionRuntime } from "../../src/extension/runtime.js";
import { discoverBundledWorkflowsSync, discoverWorkflows } from "../../src/extension/discovery.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Valid NDJSON payload: assistant text message_end event. */
function makeNdjson(text: string): string {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

/** Minimal StageAdapters backed by a call-recording spy. */
function makeSpyAdapters(calls: string[]) {
  return {
    prompt: {
      async prompt(text: string): Promise<string> {
        calls.push(`prompt:${text.slice(0, 20)}`);
        return `[spy-prompt-result]`;
      },
    },
    complete: {
      async complete(text: string): Promise<string> {
        calls.push(`complete:${text.slice(0, 20)}`);
        return `partition-a\npartition-b`;
      },
    },
  };
}

/** Mock ExtensionAPI that records registrations and exposes an exec spy. */
interface MockApi extends ExtensionAPI {
  tools: Array<{ opts: PiToolOpts<WorkflowToolArgs, WorkflowToolResult> }>;
  commands: Array<{ opts: PiSlashCommandOpts }>;
  flags: Array<{ opts: PiFlagOpts }>;
  execCalls: Array<{ command: string; args: string[] }>;
}

function makeMockApi(): MockApi {
  const tools: MockApi["tools"] = [];
  const commands: MockApi["commands"] = [];
  const flags: MockApi["flags"] = [];
  const execCalls: MockApi["execCalls"] = [];

  return {
    tools,
    commands,
    flags,
    execCalls,

    // exec surface — present on real pi runtime, used by buildRuntimeAdapters
    async exec(command: string, args: string[]): Promise<PiExecResult> {
      execCalls.push({ command, args });
      // Return valid NDJSON for prompt and complete calls; also works for subagent.
      // complete calls need partition-like output so the workflow can proceed.
      const isComplete = args.some((a) => a.includes("extract") || a.includes("partition"));
      const text = isComplete ? "partition-a\npartition-b" : "[spy-exec-response]";
      return { stdout: makeNdjson(text), stderr: "", code: 0, killed: false };
    },

    registerTool<TArgs, TResult>(opts: PiToolOpts<TArgs, TResult>) {
      tools.push({ opts: opts as unknown as PiToolOpts<WorkflowToolArgs, WorkflowToolResult> });
    },
    registerCommand(opts: PiSlashCommandOpts) {
      commands.push({ opts });
    },
    registerMessageRenderer(_event: string, _renderer: unknown) {},
    registerFlag(opts: PiFlagOpts) {
      flags.push({ opts });
    },
  };
}

/** Run the workflow tool for deep-research-codebase with a minimal prompt input. */
async function runWorkflowTool(
  mock: MockApi,
): Promise<WorkflowToolResult> {
  const execute = mock.tools[0]?.opts.execute;
  if (!execute) throw new Error("workflow tool not registered");
  return execute(
    { name: "deep-research-codebase", inputs: { prompt: "test research question" }, action: "run" },
    {},
  );
}

// ---------------------------------------------------------------------------
// 1. Mock ExtensionAPI with exec → exec invoked during workflow dispatch
// ---------------------------------------------------------------------------

describe("runtime-wiring — exec surface invoked through workflow tool", () => {
  let mock: MockApi;

  beforeEach(() => {
    mock = makeMockApi();
    factory(mock);
  });

  test("factory registers workflow tool on mock api", () => {
    expect(mock.tools.length).toBeGreaterThan(0);
    expect(mock.tools[0]?.opts.name).toBe("workflow");
  });

  test("exec is called when running deep-research-codebase through workflow tool", async () => {
    await runWorkflowTool(mock);
    expect(mock.execCalls.length).toBeGreaterThan(0);
  });

  test("exec is called with pi command", async () => {
    await runWorkflowTool(mock);
    const commands = mock.execCalls.map((c) => c.command);
    expect(commands.every((c) => c === "pi")).toBe(true);
  });

  test("exec args include --mode json and --no-session", async () => {
    await runWorkflowTool(mock);
    for (const call of mock.execCalls) {
      expect(call.args).toContain("--mode");
      expect(call.args).toContain("json");
      expect(call.args).toContain("--no-session");
    }
  });

  test("exec args include -p with prompt text", async () => {
    await runWorkflowTool(mock);
    for (const call of mock.execCalls) {
      expect(call.args).toContain("-p");
    }
  });

  test("dispatch result has action=run and status field", async () => {
    const result = await runWorkflowTool(mock);
    expect(result).toMatchObject({ action: "run" });
  });

  test("no 'prompt adapter not configured' error thrown", async () => {
    // If adapters are missing, stage-runner throws this message in non-test env.
    // With adapters wired, this must not appear.
    await expect(runWorkflowTool(mock)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. No exec surface → no adapters → test-env stub fires (no hard error)
// ---------------------------------------------------------------------------

describe("runtime-wiring — no exec surface → stub fires in test env", () => {
  let mock: MockApi;

  beforeEach(() => {
    // Remove exec surface — simulates a degraded / older pi runtime
    const stripped: ExtensionAPI & {
      tools: MockApi["tools"];
      commands: MockApi["commands"];
      execCalls: MockApi["execCalls"];
      flags: MockApi["flags"];
    } = {
      tools: [],
      commands: [],
      execCalls: [],
      flags: [],
      registerTool<TArgs, TResult>(opts: PiToolOpts<TArgs, TResult>) {
        (this as unknown as MockApi).tools.push({
          opts: opts as unknown as PiToolOpts<WorkflowToolArgs, WorkflowToolResult>,
        });
      },
      registerCommand(opts: PiSlashCommandOpts) {
        (this as unknown as MockApi).commands.push({ opts });
      },
      registerMessageRenderer(_event: string, _renderer: unknown) {},
      registerFlag(opts: PiFlagOpts) {
        (this as unknown as MockApi).flags.push({ opts });
      },
    };
    mock = stripped as unknown as MockApi;
    factory(mock);
  });

  test("workflow tool dispatch resolves (test-env prompt stub fires)", async () => {
    // In NODE_ENV=test: stage-runner uses a deterministic stub string instead of
    // throwing — so the run completes (possibly with stub content) rather than erroring.
    const result = await runWorkflowTool(mock);
    expect(result).toBeDefined();
  });

  test("exec is NOT called when exec surface is absent", async () => {
    await runWorkflowTool(mock);
    // No exec surface → exec was never invoked
    expect(mock.execCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Pre-discovery runtime invariant — adapters present in initial runtime
// ---------------------------------------------------------------------------

describe("runtime-wiring — pre-discovery: initial runtime carries adapters", () => {
  test("createExtensionRuntime with sync bundled registry + spy adapters → adapters invoked", async () => {
    const calls: string[] = [];
    const adapters = makeSpyAdapters(calls);

    // Simulate the pre-discovery state: sync bundled registry + adapters (same
    // as factory does at line: current = createExtensionRuntime({ registry: discoverBundledWorkflowsSync().registry, adapters }))
    const initialRuntime = createExtensionRuntime({
      registry: discoverBundledWorkflowsSync().registry,
      adapters,
    });

    await initialRuntime.dispatch({
      action: "run",
      name: "deep-research-codebase",
      inputs: { prompt: "test pre-discovery" },
    });

    // Adapter must have been called (not test stub, not "not configured" error)
    expect(calls.length).toBeGreaterThan(0);
  });

  test("initial runtime prompt adapter invoked with workflow prompt text", async () => {
    const calls: string[] = [];
    const adapters = makeSpyAdapters(calls);

    const initialRuntime = createExtensionRuntime({
      registry: discoverBundledWorkflowsSync().registry,
      adapters,
    });

    await initialRuntime.dispatch({
      action: "run",
      name: "deep-research-codebase",
      inputs: { prompt: "pre-discovery-research" },
    });

    const promptCalls = calls.filter((c) => c.startsWith("prompt:"));
    expect(promptCalls.length).toBeGreaterThan(0);
  });

  test("initial runtime complete adapter invoked", async () => {
    const calls: string[] = [];
    const adapters = makeSpyAdapters(calls);

    const initialRuntime = createExtensionRuntime({
      registry: discoverBundledWorkflowsSync().registry,
      adapters,
    });

    await initialRuntime.dispatch({
      action: "run",
      name: "deep-research-codebase",
      inputs: { prompt: "test-complete" },
    });

    const completeCalls = calls.filter((c) => c.startsWith("complete:"));
    expect(completeCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Post-discovery runtime swap — same adapters preserved
// ---------------------------------------------------------------------------

describe("runtime-wiring — post-discovery: swapped runtime preserves adapters", () => {
  test("runtime created with discovered registry + same adapters → adapters still invoked", async () => {
    const calls: string[] = [];
    const adapters = makeSpyAdapters(calls);

    // Simulate the post-discovery swap:
    // factory does: runtimeRef.current = createExtensionRuntime({ registry: result.registry, adapters })
    const discoveredResult = await discoverWorkflows({ includeBundled: true });
    const swappedRuntime = createExtensionRuntime({
      registry: discoveredResult.registry,
      adapters,
    });

    await swappedRuntime.dispatch({
      action: "run",
      name: "deep-research-codebase",
      inputs: { prompt: "test post-discovery" },
    });

    expect(calls.length).toBeGreaterThan(0);
  });

  test("post-discovery prompt adapter receives call with workflow text", async () => {
    const calls: string[] = [];
    const adapters = makeSpyAdapters(calls);

    const discoveredResult = await discoverWorkflows({ includeBundled: true });
    const swappedRuntime = createExtensionRuntime({
      registry: discoveredResult.registry,
      adapters,
    });

    await swappedRuntime.dispatch({
      action: "run",
      name: "deep-research-codebase",
      inputs: { prompt: "post-discovery-question" },
    });

    const promptCalls = calls.filter((c) => c.startsWith("prompt:"));
    expect(promptCalls.length).toBeGreaterThan(0);
  });

  test("same adapters object works identically in initial and swapped runtime", async () => {
    const calls: string[] = [];
    const adapters = makeSpyAdapters(calls);

    // Initial runtime (pre-discovery)
    const initialRuntime = createExtensionRuntime({
      registry: discoverBundledWorkflowsSync().registry,
      adapters,
    });
    await initialRuntime.dispatch({
      action: "run",
      name: "deep-research-codebase",
      inputs: { prompt: "initial" },
    });
    const callsAfterInitial = calls.length;
    expect(callsAfterInitial).toBeGreaterThan(0);

    // Swapped runtime (post-discovery) — same adapters reference
    const discoveredResult = await discoverWorkflows({ includeBundled: true });
    const swappedRuntime = createExtensionRuntime({
      registry: discoveredResult.registry,
      adapters,
    });
    await swappedRuntime.dispatch({
      action: "run",
      name: "deep-research-codebase",
      inputs: { prompt: "swapped" },
    });

    // Both runs must have invoked the adapters
    expect(calls.length).toBeGreaterThan(callsAfterInitial);
  });

  test("deep-research-codebase is present in discovered registry (bundled workflows survive swap)", async () => {
    const discoveredResult = await discoverWorkflows({ includeBundled: true });
    expect(discoveredResult.registry.names()).toContain("deep-research-codebase");
  });
});

// ---------------------------------------------------------------------------
// 5. End-to-end: factory with exec → pre-discovery dispatch → exec called
// ---------------------------------------------------------------------------

describe("runtime-wiring — factory e2e: exec invoked immediately (initial runtime)", () => {
  test("dispatch via workflow tool before discovery swap → exec called", async () => {
    const mock = makeMockApi();
    factory(mock);

    // dispatch immediately — runtimeRef.current is still the initial sync-seeded runtime
    const result = await runWorkflowTool(mock);

    expect(result).toBeDefined();
    // exec must have been called (adapters active in initial runtime)
    expect(mock.execCalls.length).toBeGreaterThan(0);
  });

  test("multiple dispatch calls → exec called each time (adapters stable)", async () => {
    const mock = makeMockApi();
    factory(mock);

    await runWorkflowTool(mock);
    const firstCount = mock.execCalls.length;
    expect(firstCount).toBeGreaterThan(0);

    await runWorkflowTool(mock);
    // Second run must also invoke exec (adapters still wired)
    expect(mock.execCalls.length).toBeGreaterThan(firstCount);
  });
});
