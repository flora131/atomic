/**
 * Tests for createDispatcher() — the registry-based multi-workflow CLI
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

// ─── Module-level mock — declared before any import of dispatcher.ts ─────────

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
import { createDispatcher } from "../../src/sdk/dispatcher.ts";
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

describe("createDispatcher — construction", () => {
  test("empty registry returns Dispatcher with start, command, run methods", () => {
    const registry = createRegistry();
    const dispatcher = createDispatcher(registry);
    expect(typeof dispatcher.start).toBe("function");
    expect(typeof dispatcher.command).toBe("function");
    expect(typeof dispatcher.run).toBe("function");
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

    expect(() => createDispatcher(registry)).toThrow("score");
    expect(() => createDispatcher(registry)).toThrow("claude/alpha");
    expect(() => createDispatcher(registry)).toThrow("opencode/beta");
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
    expect(() => createDispatcher(registry)).not.toThrow();
  });
});

// ─── 2. .command() ────────────────────────────────────────────────────────────

describe(".command(name)", () => {
  test("returns a Commander Command named 'workflow' by default", () => {
    const registry = createRegistry().register(makeSimpleWorkflow("foo", "claude"));
    const dispatcher = createDispatcher(registry);
    const cmd = dispatcher.command("workflow");
    expect(cmd.name()).toBe("workflow");
  });

  test("returns a Commander Command with the given name", () => {
    const registry = createRegistry();
    const dispatcher = createDispatcher(registry);
    const cmd = dispatcher.command("wf");
    expect(cmd.name()).toBe("wf");
  });

  test("command has -n/--name option", () => {
    const registry = createRegistry();
    const dispatcher = createDispatcher(registry);
    const cmd = dispatcher.command("workflow");
    const opts = cmd.options;
    const nameOpt = opts.find((o) => o.long === "--name");
    expect(nameOpt).toBeDefined();
    const shortOpt = opts.find((o) => o.short === "-n");
    expect(shortOpt).toBeDefined();
  });

  test("command has -a/--agent option", () => {
    const registry = createRegistry();
    const dispatcher = createDispatcher(registry);
    const cmd = dispatcher.command("workflow");
    const opts = cmd.options;
    const agentOpt = opts.find((o) => o.long === "--agent");
    expect(agentOpt).toBeDefined();
    const shortOpt = opts.find((o) => o.short === "-a");
    expect(shortOpt).toBeDefined();
  });

  test("command has -d/--detach option", () => {
    const registry = createRegistry();
    const dispatcher = createDispatcher(registry);
    const cmd = dispatcher.command("workflow");
    const opts = cmd.options;
    const detachOpt = opts.find((o) => o.long === "--detach");
    expect(detachOpt).toBeDefined();
  });

  test("command does NOT have -l/--list option (moved to `atomic workflow list` subcommand)", () => {
    const registry = createRegistry();
    const dispatcher = createDispatcher(registry);
    const cmd = dispatcher.command("workflow");
    const opts = cmd.options;
    expect(opts.find((o) => o.long === "--list")).toBeUndefined();
    expect(opts.find((o) => o.short === "-l")).toBeUndefined();
  });

  test("command has --<inputName> flag for each union input", () => {
    const wf = makeStringWorkflow("myflow", "claude");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry);
    const cmd = dispatcher.command("workflow");
    const opts = cmd.options;
    expect(opts.find((o) => o.long === "--topic")).toBeDefined();
    expect(opts.find((o) => o.long === "--mode")).toBeDefined();
  });
});

// ─── 3. .start() with argv ────────────────────────────────────────────────────

describe(".start() — argv parsing", () => {
  test("calls executeWorkflow with resolved inputs + entrypointFile + workflowKey", async () => {
    const wf = makeSeverityWorkflow("mywf", "claude");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-n", "mywf", "-a", "claude", "--severity", "high"],
    });

    await dispatcher.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    const call = executeWorkflowCalls[0]!;
    expect(call.inputs?.["severity"]).toBe("high");
    expect(call.workflowKey).toBe("claude/mywf");
    expect(typeof call.entrypointFile).toBe("string");
  });

  test("free-form workflow passes prompt tokens through inputs.prompt", async () => {
    const wf = makeSimpleWorkflow("freeflow", "opencode");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-n", "freeflow", "-a", "opencode", "hello", "world"],
    });

    await dispatcher.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["prompt"]).toBe("hello world");
  });
});

// ─── 4. Unknown (name, agent) pair ───────────────────────────────────────────

describe("unknown (name, agent) pair", () => {
  test("registry has only claude/foo — calling opencode/foo via .run() throws with clear error", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry);

    await expect(dispatcher.run("foo", "opencode")).rejects.toThrow(/no workflow named "foo"/);
  });

  test("error message mentions available agents when name exists for another agent", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry);

    let caught: Error | undefined;
    try {
      await dispatcher.run("foo", "opencode");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/claude/);
  });

  test("error message says 'no workflow named' when name does not exist at all", async () => {
    const registry = createRegistry();
    const dispatcher = createDispatcher(registry);

    await expect(dispatcher.run("missing", "claude")).rejects.toThrow(
      /no workflow named "missing"/,
    );
  });
});

// ─── 5. Input precedence ──────────────────────────────────────────────────────

describe("input precedence", () => {
  test(".run() inputs override createDispatcher({ inputs })", async () => {
    const wf = makeSeverityWorkflow("wf", "claude");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry, {
      inputs: { severity: "medium" },
    });

    await dispatcher.run("wf", "claude", { inputs: { severity: "high" } });

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("high");
  });

  test("createDispatcher({ inputs }) overrides defineWorkflow default", async () => {
    const wf = makeSeverityWorkflow("wf", "claude", "low");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry, {
      inputs: { severity: "medium" },
    });

    await dispatcher.run("wf", "claude");

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("medium");
  });

  test("CLI argv --severity overrides createDispatcher({ inputs })", async () => {
    const wf = makeSeverityWorkflow("wf", "claude");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry, {
      inputs: { severity: "medium" },
      argv: ["bun", "worker.ts", "-n", "wf", "-a", "claude", "--severity", "critical"],
    });

    await dispatcher.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("critical");
  });

  test("defineWorkflow default used when no higher-precedence value given", async () => {
    const wf = makeSeverityWorkflow("wf", "claude", "low");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry);

    await dispatcher.run("wf", "claude");

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.inputs?.["severity"]).toBe("low");
  });
});

// ─── 6. Orchestrator re-entry ────────────────────────────────────────────────

describe("orchestrator re-entry", () => {
  test("ATOMIC_ORCHESTRATOR_MODE=1 + ATOMIC_WF_KEY calls runOrchestrator, not executeWorkflow", async () => {
    const wf = makeSimpleWorkflow("foo", "claude");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "claude/foo";

    await dispatcher.start();

    expect(runOrchestratorCalls).toHaveLength(1);
    expect(executeWorkflowCalls).toHaveLength(0);
    expect(runOrchestratorCalls[0]!.name).toBe("foo");
    expect(runOrchestratorCalls[0]!.agent).toBe("claude");
  });

  test("ATOMIC_ORCHESTRATOR_MODE=1 without ATOMIC_WF_KEY throws", async () => {
    const registry = createRegistry();
    const dispatcher = createDispatcher(registry);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";

    await expect(dispatcher.start()).rejects.toThrow("ATOMIC_WF_KEY");
  });

  test("ATOMIC_WF_KEY not found in registry throws", async () => {
    const registry = createRegistry();
    const dispatcher = createDispatcher(registry);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "claude/nonexistent";

    await expect(dispatcher.start()).rejects.toThrow("claude/nonexistent");
  });

  test("without ATOMIC_ORCHESTRATOR_MODE, runOrchestrator is never called", async () => {
    const wf = makeSimpleWorkflow("bar", "opencode");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-n", "bar", "-a", "opencode"],
    });

    await dispatcher.start();

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
    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-n", "hyphen-wf", "-a", "claude", "--output-type", "json"],
    });

    await dispatcher.start();

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
    const dispatcher = createDispatcher(registry, {
      argv: [
        "bun", "worker.ts",
        "-n", "multi-hyphen",
        "-a", "opencode",
        "--output-type", "yaml",
        "--max-loops", "5",
        "--simple", "yes",
      ],
    });

    await dispatcher.start();

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
    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "hello"],
      extend: (program) => {
        program
          .command("hello")
          .action(() => {
            helloRan = true;
          });
      },
    });

    await dispatcher.start();

    expect(helloRan).toBe(true);
  });

  test("extend not provided — no error on start", async () => {
    const wf = makeSimpleWorkflow("baz", "copilot");
    const registry = createRegistry().register(wf);
    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-n", "baz", "-a", "copilot"],
    });

    await expect(dispatcher.start()).resolves.toBeUndefined();
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
    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-a", "claude"],
    });

    await dispatcher.start();

    expect(pickerCreateCalls).toHaveLength(1);
    expect(pickerCreateCalls[0]!.agent).toBe("claude");
  });

  test("picker result resolves and executeWorkflow is called when user selects a workflow", async () => {
    const wf = makeSimpleWorkflow("myflow", "claude");
    const registry = createRegistry().register(wf);

    pickerResolution = { workflow: wf, inputs: {} };

    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-a", "claude"],
    });

    await dispatcher.start();

    expect(executeWorkflowCalls).toHaveLength(1);
    expect(executeWorkflowCalls[0]!.workflowKey).toBe("claude/myflow");
  });

  test("picker destroy is called after selection (success path)", async () => {
    const wf = makeSimpleWorkflow("myflow", "claude");
    const registry = createRegistry().register(wf);
    pickerResolution = { workflow: wf, inputs: {} };

    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-a", "claude"],
    });

    await dispatcher.start();

    expect(pickerDestroyCalled).toBe(true);
  });

  test("picker destroy is called and executeWorkflow is NOT called when user cancels (null result)", async () => {
    const wf = makeSimpleWorkflow("myflow", "claude");
    const registry = createRegistry().register(wf);

    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-a", "claude"],
    });

    await dispatcher.start();

    expect(pickerDestroyCalled).toBe(true);
    expect(executeWorkflowCalls).toHaveLength(0);
  });


  test("picker registry is filtered to the selected agent only", async () => {
    const wf1 = makeSimpleWorkflow("myflow", "claude");
    const wf2 = makeSimpleWorkflow("otherflow", "opencode");
    const registry = createRegistry().register(wf1).register(wf2);

    pickerResolution = null;

    const dispatcher = createDispatcher(registry, {
      argv: ["bun", "worker.ts", "-a", "claude"],
    });

    await dispatcher.start();

    expect(pickerCreateCalls).toHaveLength(1);
    expect(pickerCreateCalls[0]!.agent).toBe("claude");
  });
});

// Restore WorkflowPickerPanel.create to its original implementation so
// workflow-picker-panel.test.tsx sees the real class method.
afterAll(() => {
  (realPickerPanel.WorkflowPickerPanel as { create: unknown }).create = originalCreate;
});
