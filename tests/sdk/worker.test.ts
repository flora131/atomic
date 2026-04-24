/**
 * Tests for createWorker(definition) — the single-workflow CLI factory.
 *
 * Mocking strategy: mock.module("../../src/sdk/runtime/executor.ts") replaces
 * executeWorkflow and runOrchestrator with controlled fakes BEFORE the module
 * under test is dynamically imported. This prevents any real tmux/child-process
 * side effects.
 */

import {
  test,
  expect,
  describe,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import type { WorkflowRunOptions } from "../../src/sdk/runtime/executor.ts";
import type { WorkflowDefinition } from "../../src/sdk/types.ts";

// ─── Module-level mock — declared before any import of worker.ts ─────────────

const executeWorkflowCalls: WorkflowRunOptions[] = [];
const runOrchestratorCalls: WorkflowDefinition[] = [];

const realExecutor = await import("../../src/sdk/runtime/executor.ts");
await mock.module("../../src/sdk/runtime/executor.ts", () => ({
  ...realExecutor,
  executeWorkflow: async (opts: WorkflowRunOptions): Promise<void> => {
    executeWorkflowCalls.push(opts);
  },
  runOrchestrator: async (def: WorkflowDefinition): Promise<void> => {
    runOrchestratorCalls.push(def);
  },
}));

// Import AFTER mock.module is set up
import { createWorker } from "../../src/sdk/worker.ts";
import { defineWorkflow } from "../../src/sdk/define-workflow.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSimpleWorkflow(
  name: string,
  agent: "claude" | "opencode" | "copilot",
) {
  return defineWorkflow({ name })
    .for(agent)
    .run(async () => {})
    .compile();
}

function makeSeverityWorkflow(
  name: string,
  agent: "claude" | "opencode" | "copilot",
  defaultSeverity: string = "low",
) {
  return defineWorkflow({
    name,
    inputs: [
      {
        name: "severity",
        type: "enum" as const,
        values: ["low", "medium", "high", "critical"] as const,
        default: defaultSeverity,
      },
    ],
  })
    .for(agent)
    .run(async () => {})
    .compile();
}

function makeIntegerWorkflow(
  name: string,
  agent: "claude" | "opencode" | "copilot",
) {
  return defineWorkflow({
    name,
    inputs: [
      { name: "loops", type: "integer" as const, required: true },
    ],
  })
    .for(agent)
    .run(async () => {})
    .compile();
}

// ─── Env helpers ──────────────────────────────────────────────────────────────

const ORCH_ENV_KEYS = ["ATOMIC_ORCHESTRATOR_MODE", "ATOMIC_WF_KEY"] as const;
const savedEnv: Partial<Record<string, string>> = {};

function saveOrchEnv(): void {
  for (const k of ORCH_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
}

function restoreOrchEnv(): void {
  for (const k of ORCH_ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
}

beforeEach(() => {
  executeWorkflowCalls.length = 0;
  runOrchestratorCalls.length = 0;
  saveOrchEnv();
});

afterEach(() => {
  restoreOrchEnv();
});

// ─── 1. Construction ──────────────────────────────────────────────────────────

describe("createWorker — construction", () => {
  test("returns Worker with start, command, run methods", () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf);
    expect(typeof worker.start).toBe("function");
    expect(typeof worker.command).toBe("function");
    expect(typeof worker.run).toBe("function");
  });
});

// ─── 2. .command() ────────────────────────────────────────────────────────────

describe(".command(name)", () => {
  test("default command name is the workflow name", () => {
    const wf = makeSimpleWorkflow("myflow", "claude");
    const worker = createWorker(wf);
    const cmd = worker.command();
    expect(cmd.name()).toBe("myflow");
  });

  test("returns a Commander Command with the given name", () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf);
    const cmd = worker.command("wf");
    expect(cmd.name()).toBe("wf");
  });

  test("command does NOT have -n/--name option (single-workflow)", () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf);
    const cmd = worker.command("wf");
    expect(cmd.options.find((o) => o.long === "--name")).toBeUndefined();
  });

  test("command does NOT have -a/--agent option (single-workflow)", () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf);
    const cmd = worker.command("wf");
    expect(cmd.options.find((o) => o.long === "--agent")).toBeUndefined();
  });

  test("command does NOT have -l/--list option (single-workflow)", () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf);
    const cmd = worker.command("wf");
    expect(cmd.options.find((o) => o.long === "--list")).toBeUndefined();
  });

  test("command has -d/--detach option", () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf);
    const cmd = worker.command("wf");
    expect(cmd.options.find((o) => o.long === "--detach")).toBeDefined();
  });

  test("command has --<inputName> flag for each declared input", () => {
    const wf = defineWorkflow({
      name: "sw",
      inputs: [
        { name: "topic", type: "string" as const },
        { name: "mode", type: "string" as const },
      ],
    })
      .for("claude")
      .run(async () => {})
      .compile();

    const worker = createWorker(wf);
    const cmd = worker.command("wf");
    expect(cmd.options.find((o) => o.long === "--topic")).toBeDefined();
    expect(cmd.options.find((o) => o.long === "--mode")).toBeDefined();
  });
});

// ─── 3. .start() with argv ────────────────────────────────────────────────────

describe(".start() — argv parsing", () => {
  test("calls executeWorkflow with resolved inputs + entrypointFile + workflowKey", async () => {
    const wf = makeSeverityWorkflow("mywf", "claude");
    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts", "--severity", "high"],
    });

    await worker.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    const call = executeWorkflowCalls[0]!;
    expect(call.inputs?.["severity"]).toBe("high");
    expect(call.workflowKey).toBe("claude/mywf");
    expect(call.agent).toBe("claude");
    expect(typeof call.entrypointFile).toBe("string");
  });

  test("free-form workflow passes prompt tokens through inputs.prompt", async () => {
    const wf = makeSimpleWorkflow("freeflow", "opencode");
    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts", "hello", "world"],
    });

    await worker.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["prompt"]).toBe("hello world");
  });

  test("--detach flag threads detach=true to executor", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts", "--detach"],
    });

    await worker.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.detach).toBe(true);
  });

  test("-d shorthand also sets detach=true", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts", "-d"],
    });

    await worker.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.detach).toBe(true);
  });

  test("detach defaults to false when flag omitted", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts"],
    });

    await worker.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.detach).toBe(false);
  });
});

// ─── 4. Input precedence ──────────────────────────────────────────────────────

describe("input precedence", () => {
  test("start(inputs) supplies value when no CLI flag given", async () => {
    const wf = makeSeverityWorkflow("wf", "claude");
    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts"],
    });

    await worker.start({ severity: "medium" });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("medium");
  });

  test("CLI argv --severity overrides start(inputs)", async () => {
    const wf = makeSeverityWorkflow("wf", "claude");
    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts", "--severity", "critical"],
    });

    await worker.start({ severity: "medium" });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("critical");
  });

  test("defineWorkflow default used when no higher-precedence value given", async () => {
    const wf = makeSeverityWorkflow("wf", "claude", "low");
    const worker = createWorker(wf);

    await worker.run();

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("low");
  });

  test(".run({ inputs }) overrides defineWorkflow default", async () => {
    const wf = makeSeverityWorkflow("wf", "claude", "low");
    const worker = createWorker(wf);

    await worker.run({ inputs: { severity: "high" } });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("high");
  });

  test("integer value from start(inputs) is coerced to a string flag", async () => {
    const wf = makeIntegerWorkflow("intwf", "claude");
    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts"],
    });

    await worker.start({ loops: 7 });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["loops"]).toBe("7");
  });
});

// ─── 5. Orchestrator re-entry ────────────────────────────────────────────────

describe("orchestrator re-entry", () => {
  test("ATOMIC_ORCHESTRATOR_MODE=1 calls runOrchestrator with bound definition, ignoring ATOMIC_WF_KEY", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const worker = createWorker(wf);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    // Key is irrelevant for a single-definition worker — should not affect resolution.
    process.env.ATOMIC_WF_KEY = "anything/goes";

    await worker.start();

    expect(runOrchestratorCalls).toHaveLength(1);
    expect(executeWorkflowCalls).toHaveLength(0);
    expect(runOrchestratorCalls[0]!.name).toBe("foo");
    expect(runOrchestratorCalls[0]!.agent).toBe("claude");
  });

  test("without ATOMIC_ORCHESTRATOR_MODE, runOrchestrator is never called", async () => {
    const wf = makeSimpleWorkflow("bar", "opencode");
    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts"],
    });

    await worker.start();

    expect(runOrchestratorCalls).toHaveLength(0);
    expect(executeWorkflowCalls).toHaveLength(1);
  });
});

// ─── 6. Hyphenated input names ───────────────────────────────────────────────

describe("hyphenated input names", () => {
  test("--output-type value reaches workflow inputs under key 'output-type'", async () => {
    const wf = defineWorkflow({
      name: "hyphen-wf",
      inputs: [{ name: "output-type", type: "string" as const }],
    })
      .for("claude")
      .run(async () => {})
      .compile();

    const worker = createWorker(wf, {
      argv: ["bun", "worker.ts", "--output-type", "json"],
    });

    await worker.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["output-type"]).toBe("json");
  });

  test("multiple hyphenated inputs all round-trip correctly", async () => {
    const wf = defineWorkflow({
      name: "multi-hyphen",
      inputs: [
        { name: "output-type", type: "string" as const },
        { name: "max-loops", type: "string" as const },
        { name: "simple", type: "string" as const },
      ],
    })
      .for("opencode")
      .run(async () => {})
      .compile();

    const worker = createWorker(wf, {
      argv: [
        "bun", "worker.ts",
        "--output-type", "yaml",
        "--max-loops", "5",
        "--simple", "yes",
      ],
    });

    await worker.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    const inputs = executeWorkflowCalls[0]!.inputs;
    expect(inputs?.["output-type"]).toBe("yaml");
    expect(inputs?.["max-loops"]).toBe("5");
    expect(inputs?.["simple"]).toBe("yes");
  });
});

// ─── 7. Validation errors ────────────────────────────────────────────────────

describe("validation errors", () => {
  test("missing required input rejects with clear error", async () => {
    const wf = makeIntegerWorkflow("intwf", "claude");
    const worker = createWorker(wf);

    await expect(worker.run()).rejects.toThrow(/--loops/);
  });

  test("non-integer value for integer input rejects", async () => {
    const wf = makeIntegerWorkflow("intwf", "claude");
    const worker = createWorker(wf);

    await expect(
      worker.run({ inputs: { loops: "not-an-int" as unknown as number } }),
    ).rejects.toThrow(/integer/);
  });

  test("invalid enum value rejects", async () => {
    const wf = makeSeverityWorkflow("wf", "claude");
    const worker = createWorker(wf);

    await expect(
      worker.run({ inputs: { severity: "catastrophic" } }),
    ).rejects.toThrow(/catastrophic/);
  });
});
