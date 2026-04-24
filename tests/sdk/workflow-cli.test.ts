/**
 * Tests for createWorkflowCli() — the registry-based multi-workflow CLI
 * factory used by the internal `atomic workflow` command.
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
  afterAll,
  mock,
} from "bun:test";
import type { WorkflowRunOptions } from "../../src/sdk/runtime/executor.ts";
import type { WorkflowDefinition } from "../../src/sdk/types.ts";
import type { WorkflowPickerResult } from "../../src/sdk/components/workflow-picker-panel.tsx";

// ─── Module-level mock — declared before any import of cli.ts ─────────

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

// ─── WorkflowPickerPanel mock ─────────────────────────────────────────────────

interface PickerCreateCall {
  agent: string;
  registrySize: number;
}
const pickerCreateCalls: PickerCreateCall[] = [];
let pickerResolution: WorkflowPickerResult | null = null;
let pickerDestroyCalled = false;

const realPickerPanel = await import("../../src/sdk/components/workflow-picker-panel.tsx");
const realPickerPanelSnapshot = { ...realPickerPanel };
const originalCreate = realPickerPanel.WorkflowPickerPanel.create;
(realPickerPanel.WorkflowPickerPanel as { create: unknown }).create =
  async (opts: { agent: string; registry: { list: () => WorkflowDefinition[] } }) => {
    pickerCreateCalls.push({ agent: opts.agent, registrySize: opts.registry.list().length });
    return {
      waitForSelection: async (): Promise<WorkflowPickerResult | null> => pickerResolution,
      destroy: () => { pickerDestroyCalled = true; },
    };
  };
await mock.module("../../src/sdk/components/workflow-picker-panel.tsx", () => ({
  ...realPickerPanelSnapshot,
}));

// Import AFTER mock.module is set up
import { createWorkflowCli } from "../../src/sdk/workflow-cli.ts";
import { toCommand } from "../../src/sdk/commander.ts";
import { createRegistry } from "../../src/sdk/registry.ts";
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

function makeStringWorkflow(
  name: string,
  agent: "claude" | "opencode" | "copilot",
) {
  return defineWorkflow({
    name,
    inputs: [
      { name: "topic", type: "string" as const },
      { name: "mode", type: "string" as const },
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
  pickerCreateCalls.length = 0;
  pickerResolution = null;
  pickerDestroyCalled = false;
  saveOrchEnv();
});

afterEach(() => {
  restoreOrchEnv();
});

// ─── 1. Construction ──────────────────────────────────────────────────────────

describe("createWorkflowCli — construction", () => {
  test("empty registry returns WorkflowCli with registry, entry, defaults, and run", () => {
    const registry = createRegistry();
    const cli = createWorkflowCli(registry);
    expect(cli.registry).toBe(registry);
    expect(typeof cli.entry).toBe("string");
    expect(typeof cli.run).toBe("function");
  });

  test("WorkflowCli does not expose .command() — adapter lives in /commander", () => {
    const registry = createRegistry();
    const cli = createWorkflowCli(registry);
    expect((cli as unknown as { command?: unknown }).command).toBeUndefined();
  });

  test("same-name + different-type inputs across two workflows throws with both workflow names", () => {
    const wf1 = defineWorkflow({
      name: "alpha",
      inputs: [{ name: "score", type: "string" as const }],
    })
      .for("claude")
      .run(async () => {})
      .compile();

    const wf2 = defineWorkflow({
      name: "beta",
      inputs: [{ name: "score", type: "integer" as const }],
    })
      .for("opencode")
      .run(async () => {})
      .compile();

    const registry = createRegistry().register(wf1).register(wf2);

    expect(() => createWorkflowCli(registry)).toThrow("score");
    expect(() => createWorkflowCli(registry)).toThrow("claude/alpha");
    expect(() => createWorkflowCli(registry)).toThrow("opencode/beta");
  });

  test("same-name + same-type inputs across two workflows does not throw", () => {
    const wf1 = defineWorkflow({
      name: "alpha",
      inputs: [{ name: "topic", type: "string" as const }],
    })
      .for("claude")
      .run(async () => {})
      .compile();

    const wf2 = defineWorkflow({
      name: "beta",
      inputs: [{ name: "topic", type: "string" as const }],
    })
      .for("opencode")
      .run(async () => {})
      .compile();

    const registry = createRegistry().register(wf1).register(wf2);
    expect(() => createWorkflowCli(registry)).not.toThrow();
  });
});

// ─── 2. toCommand(cli) — Commander adapter ───────────────────────────

describe("toCommand(cli, name?)", () => {
  test("returns a Commander Command named 'workflow' by default", () => {
    const registry = createRegistry().register(makeSimpleWorkflow("foo", "claude"));
    const cmd = toCommand(createWorkflowCli(registry));
    expect(cmd.name()).toBe("workflow");
  });

  test("returns a Commander Command with the given name", () => {
    const registry = createRegistry();
    const cmd = toCommand(createWorkflowCli(registry), "wf");
    expect(cmd.name()).toBe("wf");
  });

  test("command has -n/--name option", () => {
    const registry = createRegistry();
    const cmd = toCommand(createWorkflowCli(registry));
    const opts = cmd.options;
    expect(opts.find((o) => o.long === "--name")).toBeDefined();
    expect(opts.find((o) => o.short === "-n")).toBeDefined();
  });

  test("command has -a/--agent option", () => {
    const registry = createRegistry();
    const cmd = toCommand(createWorkflowCli(registry));
    const opts = cmd.options;
    expect(opts.find((o) => o.long === "--agent")).toBeDefined();
    expect(opts.find((o) => o.short === "-a")).toBeDefined();
  });

  test("command has -d/--detach option", () => {
    const registry = createRegistry();
    const cmd = toCommand(createWorkflowCli(registry));
    expect(cmd.options.find((o) => o.long === "--detach")).toBeDefined();
  });

  test("command does NOT have -l/--list option (moved to `atomic workflow list` subcommand)", () => {
    const registry = createRegistry();
    const cmd = toCommand(createWorkflowCli(registry));
    expect(cmd.options.find((o) => o.long === "--list")).toBeUndefined();
    expect(cmd.options.find((o) => o.short === "-l")).toBeUndefined();
  });

  test("command has --<inputName> flag for each union input", () => {
    const wf = makeStringWorkflow("myflow", "claude");
    const registry = createRegistry().register(wf);
    const cmd = toCommand(createWorkflowCli(registry));
    expect(cmd.options.find((o) => o.long === "--topic")).toBeDefined();
    expect(cmd.options.find((o) => o.long === "--mode")).toBeDefined();
  });
});

// ─── 3. .run() with argv ────────────────────────────────────────────────────

describe(".run() — argv parsing", () => {
  test("calls executeWorkflow with resolved inputs + entrypointFile + workflowKey", async () => {
    const wf = makeSeverityWorkflow("mywf", "claude");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    await cli.run({
      argv: ["bun", "worker.ts", "-n", "mywf", "-a", "claude", "--severity", "high"],
    });

    expect(executeWorkflowCalls).toHaveLength(1);
    const call = executeWorkflowCalls[0]!;
    expect(call.inputs?.["severity"]).toBe("high");
    expect(call.workflowKey).toBe("claude/mywf");
    expect(typeof call.entrypointFile).toBe("string");
  });

  test("free-form workflow passes prompt tokens through inputs.prompt", async () => {
    const wf = makeSimpleWorkflow("freeflow", "opencode");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    await cli.run({
      argv: ["bun", "worker.ts", "-n", "freeflow", "-a", "opencode", "hello", "world"],
    });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["prompt"]).toBe("hello world");
  });
});

// ─── 4. Unknown (name, agent) pair ───────────────────────────────────────────

describe("unknown (name, agent) pair", () => {
  test("registry has only claude/foo — calling opencode/foo via .run() throws with clear error", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    await expect(
      cli.run({ name: "foo", agent: "opencode", argv: false }),
    ).rejects.toThrow(/no workflow named "foo"/);
  });

  test("error message mentions available agents when name exists for another agent", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    let caught: Error | undefined;
    try {
      await cli.run({ name: "foo", agent: "opencode", argv: false });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/claude/);
  });

  test("error message says 'no workflow named' when name does not exist at all", async () => {
    const registry = createRegistry();
    const cli = createWorkflowCli(registry);

    await expect(
      cli.run({ name: "missing", agent: "claude", argv: false }),
    ).rejects.toThrow(/no workflow named "missing"/);
  });
});

// ─── 5. Input precedence ──────────────────────────────────────────────────────

describe("input precedence", () => {
  test(".run() inputs override createWorkflowCli({ inputs })", async () => {
    const wf = makeSeverityWorkflow("wf", "claude");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry, {
      inputs: { severity: "medium" },
    });

    await cli.run({
      name: "wf",
      agent: "claude",
      inputs: { severity: "high" },
      argv: false,
    });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("high");
  });

  test("createWorkflowCli({ inputs }) overrides defineWorkflow default", async () => {
    const wf = makeSeverityWorkflow("wf", "claude", "low");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry, {
      inputs: { severity: "medium" },
    });

    await cli.run({ name: "wf", agent: "claude", argv: false });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("medium");
  });

  test("CLI argv --severity overrides createWorkflowCli({ inputs })", async () => {
    const wf = makeSeverityWorkflow("wf", "claude");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry, {
      inputs: { severity: "medium" },
    });

    await cli.run({
      argv: ["bun", "worker.ts", "-n", "wf", "-a", "claude", "--severity", "critical"],
    });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("critical");
  });

  test("defineWorkflow default used when no higher-precedence value given", async () => {
    const wf = makeSeverityWorkflow("wf", "claude", "low");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    await cli.run({ name: "wf", agent: "claude", argv: false });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("low");
  });
});

// ─── 6. Orchestrator re-entry ────────────────────────────────────────────────

describe("orchestrator re-entry", () => {
  test("ATOMIC_ORCHESTRATOR_MODE=1 + ATOMIC_WF_KEY calls runOrchestrator, not executeWorkflow", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "claude/foo";

    await cli.run();

    expect(runOrchestratorCalls).toHaveLength(1);
    expect(executeWorkflowCalls).toHaveLength(0);
    expect(runOrchestratorCalls[0]!.name).toBe("foo");
    expect(runOrchestratorCalls[0]!.agent).toBe("claude");
  });

  test("ATOMIC_ORCHESTRATOR_MODE=1 without ATOMIC_WF_KEY throws", async () => {
    const registry = createRegistry();
    const cli = createWorkflowCli(registry);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";

    await expect(cli.run()).rejects.toThrow("ATOMIC_WF_KEY");
  });

  test("ATOMIC_WF_KEY not found in registry throws", async () => {
    const registry = createRegistry();
    const cli = createWorkflowCli(registry);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "claude/nonexistent";

    await expect(cli.run()).rejects.toThrow("claude/nonexistent");
  });

  test("without ATOMIC_ORCHESTRATOR_MODE, runOrchestrator is never called", async () => {
    const wf = makeSimpleWorkflow("bar", "opencode");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    await cli.run({
      argv: ["bun", "worker.ts", "-n", "bar", "-a", "opencode"],
    });

    expect(runOrchestratorCalls).toHaveLength(0);
    expect(executeWorkflowCalls).toHaveLength(1);
  });
});

// ─── 7. Hyphenated input names ───────────────────────────────────────────────

describe("hyphenated input names", () => {
  test("--output-type value reaches workflow inputs under key 'output-type'", async () => {
    const wf = defineWorkflow({
      name: "hyphen-wf",
      inputs: [{ name: "output-type", type: "string" as const }],
    })
      .for("claude")
      .run(async () => {})
      .compile();

    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    await cli.run({
      argv: ["bun", "worker.ts", "-n", "hyphen-wf", "-a", "claude", "--output-type", "json"],
    });

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

    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    await cli.run({
      argv: [
        "bun", "worker.ts",
        "-n", "multi-hyphen",
        "-a", "opencode",
        "--output-type", "yaml",
        "--max-loops", "5",
        "--simple", "yes",
      ],
    });

    expect(executeWorkflowCalls).toHaveLength(1);
    const inputs = executeWorkflowCalls[0]!.inputs;
    expect(inputs?.["output-type"]).toBe("yaml");
    expect(inputs?.["max-loops"]).toBe("5");
    expect(inputs?.["simple"]).toBe("yes");
  });
});

// ─── 8. extend hook ──────────────────────────────────────────────────────────

describe("extend hook", () => {
  test("extend callback is invoked with root program and sibling command runs", async () => {
    let helloRan = false;
    const registry = createRegistry();
    const cli = createWorkflowCli(registry, {
      extend: (program) => {
        program
          .command("hello")
          .action(() => {
            helloRan = true;
          });
      },
    });

    await cli.run({ argv: ["bun", "worker.ts", "hello"] });

    expect(helloRan).toBe(true);
  });

  test("extend not provided — no error on run", async () => {
    const wf = makeSimpleWorkflow("baz", "copilot");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    await expect(
      cli.run({ argv: ["bun", "worker.ts", "-n", "baz", "-a", "copilot"] }),
    ).resolves.toBeUndefined();
  });
});

// ─── 9. Picker branch — no --name + agent present + TTY ─────────────────────

describe("picker branch — missing --name with --agent in TTY", () => {
  let savedIsTTY: boolean | undefined;

  beforeEach(() => {
    savedIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: savedIsTTY, configurable: true });
  });

  test("WorkflowPickerPanel.create is called with the correct agent when --name is omitted + --agent is given + TTY", async () => {
    const wf = makeSimpleWorkflow("myflow", "claude");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    await cli.run({ argv: ["bun", "worker.ts", "-a", "claude"] });

    expect(pickerCreateCalls).toHaveLength(1);
    expect(pickerCreateCalls[0]!.agent).toBe("claude");
  });

  test("picker result resolves and executeWorkflow is called when user selects a workflow", async () => {
    const wf = makeSimpleWorkflow("myflow", "claude");
    const registry = createRegistry().register(wf);

    pickerResolution = { workflow: wf, inputs: {} };

    const cli = createWorkflowCli(registry);

    await cli.run({ argv: ["bun", "worker.ts", "-a", "claude"] });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.workflowKey).toBe("claude/myflow");
  });

  test("picker destroy is called after selection (success path)", async () => {
    const wf = makeSimpleWorkflow("myflow", "claude");
    const registry = createRegistry().register(wf);
    pickerResolution = { workflow: wf, inputs: {} };

    const cli = createWorkflowCli(registry);

    await cli.run({ argv: ["bun", "worker.ts", "-a", "claude"] });

    expect(pickerDestroyCalled).toBe(true);
  });

  test("picker destroy is called and executeWorkflow is NOT called when user cancels (null result)", async () => {
    const wf = makeSimpleWorkflow("myflow", "claude");
    const registry = createRegistry().register(wf);

    const cli = createWorkflowCli(registry);

    await cli.run({ argv: ["bun", "worker.ts", "-a", "claude"] });

    expect(pickerDestroyCalled).toBe(true);
    expect(executeWorkflowCalls).toHaveLength(0);
  });


  test("picker registry is filtered to the selected agent only", async () => {
    const wf1 = makeSimpleWorkflow("myflow", "claude");
    const wf2 = makeSimpleWorkflow("otherflow", "opencode");
    const registry = createRegistry().register(wf1).register(wf2);

    pickerResolution = null;

    const cli = createWorkflowCli(registry);

    await cli.run({ argv: ["bun", "worker.ts", "-a", "claude"] });

    expect(pickerCreateCalls).toHaveLength(1);
    expect(pickerCreateCalls[0]!.agent).toBe("claude");
  });
});

// Restore WorkflowPickerPanel.create to its original implementation so
// workflow-picker-panel.test.tsx sees the real class method.
afterAll(() => {
  (realPickerPanel.WorkflowPickerPanel as { create: unknown }).create = originalCreate;
});
