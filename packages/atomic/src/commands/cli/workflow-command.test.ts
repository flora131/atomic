/**
 * Tests for `workflowCommand` — the Commander Command returned by
 * `createWorkflowCli(createBuiltinRegistry()).command("workflow")`.
 *
 * Mocking strategy: mock.module("../../sdk/runtime/executor.ts") replaces
 * executeWorkflow with a spy BEFORE the dynamic import of workflow.ts.
 *
 * Module load order:
 *   1. Static imports execute first (hoisted by ES module semantics) —
 *      this loads registry.ts → providers/claude.ts → executor.ts (REAL),
 *      so `escBash` and all other executor exports are cached before the mock.
 *   2. `mock.module` replaces executor.ts for SUBSEQUENT imports — only
 *      `worker.ts` picks up the mocked executeWorkflow/runOrchestrator.
 *   3. Dynamic import of workflow.ts uses the mocked executor via worker.ts.
 *
 * Commander error handling: `exitOverride()` is called on the command before
 * tests that expect rejection, converting process.exit(1) into a thrown Error.
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import type { WorkflowRunOptions } from "@bastani/atomic-sdk/runtime/executor";
// Static import — loads providers/claude.ts → real executor.ts into module cache
// BEFORE mock.module replaces it for subsequent imports.
import "@bastani/atomic-sdk/registry";

// ─── Module-level mock ────────────────────────────────────────────────────────
// Must be declared AFTER the static imports above (which load the real executor)
// but BEFORE the dynamic import of workflow.ts below (which uses worker.ts → mock).

const executeWorkflowCalls: WorkflowRunOptions[] = [];
const executeWorkflowMock = mock(
  async (opts: WorkflowRunOptions): Promise<{ id: string; tmuxSessionName: string }> => {
    executeWorkflowCalls.push(opts);
    return { id: "fake-id", tmuxSessionName: "fake-session" };
  },
);

// Spread real module to preserve all exports (escBash, discoverCopilotBinary, etc.)
// so this mock doesn't break other test files that import those exports.
const realExecutor = await import("@bastani/atomic-sdk/runtime/executor");
await mock.module("@bastani/atomic-sdk/runtime/executor", () => ({
  ...realExecutor,
  executeWorkflow: executeWorkflowMock,
  runOrchestrator: async () => {},
}));

// Load the workflow command after the executor is mocked. Importing
// `./workflow.ts` triggers the registry build + Commander tree
// construction inside the mocked executor sandbox.
const { workflowCommand, buildWorkflowCommand } = await import("./workflow.ts");
const { defineWorkflow } = await import("@bastani/atomic-sdk/define-workflow");
const { createRegistry } = await import("@bastani/atomic-sdk/registry");

// ─── Output capture ──────────────────────────────────────────────────────────

interface CapturedOutput {
  stdout: string;
  stderr: string;
  restore: () => void;
}

function captureOutput(): CapturedOutput {
  const captured: CapturedOutput = { stdout: "", stderr: "", restore: () => {} };
  const origStdout = process.stdout.write.bind(process.stdout);
  const origConsoleLog = console.log;
  const origConsoleError = console.error;
  const origConsoleWarn = console.warn;

  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    captured.stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  console.log = (...args: unknown[]) => {
    captured.stdout += args.map(String).join(" ") + "\n";
  };
  console.error = (...args: unknown[]) => {
    captured.stderr += args.map(String).join(" ") + "\n";
  };
  console.warn = (...args: unknown[]) => {
    captured.stderr += args.map(String).join(" ") + "\n";
  };

  captured.restore = () => {
    process.stdout.write = origStdout;
    console.log = origConsoleLog;
    console.error = origConsoleError;
    console.warn = origConsoleWarn;
  };
  return captured;
}

// ─── Colour suppression ──────────────────────────────────────────────────────

let savedNoColor: string | undefined;
beforeEach(() => {
  savedNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  executeWorkflowCalls.length = 0;
  executeWorkflowMock.mockClear();
  executeWorkflowMock.mockImplementation(async (opts) => {
    executeWorkflowCalls.push(opts);
    return { id: "fake-id", tmuxSessionName: "fake-session" };
  });
});
afterEach(() => {
  if (savedNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = savedNoColor;
});

// ─── exitOverride helper ──────────────────────────────────────────────────────
// Calling exitOverride() converts Commander's process.exit(1) into a thrown
// Error so tests can assert on rejection without killing the process.

function enableExitOverride(): void {
  workflowCommand.exitOverride();
}

// ─── Listing removed from dispatcher flags ──────────────────────────────────
//
// `--list` / `-l` used to live on the dispatcher command as a flag. It's
// since moved to a dedicated `atomic workflow list` subcommand (registered
// in src/cli.ts, implemented in ./workflow-list.ts) because the flag form
// had confusing interactions with argv parsing. The dispatcher itself no
// longer accepts the flag.

describe("workflowCommand: --list flag removed", () => {
  test("--list is not a recognised dispatcher option", async () => {
    enableExitOverride();
    let threw = false;
    const cap = captureOutput();
    try {
      await workflowCommand.parseAsync(["node", "cli", "--list"]);
    } catch {
      threw = true;
    } finally {
      cap.restore();
    }
    expect(threw).toBe(true);
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });
});

// ─── Named mode success ───────────────────────────────────────────────────────

describe("workflowCommand named mode — success", () => {
  test("dispatches ralph/claude with prompt to executor", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "ralph",
      "-a", "claude",
      "--prompt", "fix the auth bug",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    const call = executeWorkflowCalls[0]!;
    expect(call.agent).toBe("claude");
    expect(call.inputs?.["prompt"]).toBe("fix the auth bug");
    expect(`${call.definition.agent}/${call.definition.name}`).toBe("claude/ralph");
  });

  test("dispatches ralph/copilot successfully", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "ralph",
      "-a", "copilot",
      "--prompt", "review this PR",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    const call = executeWorkflowCalls[0]!;
    expect(call.agent).toBe("copilot");
    expect(call.inputs?.["prompt"]).toBe("review this PR");
  });

  test("dispatches ralph/opencode successfully", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "ralph",
      "-a", "opencode",
      "--prompt", "refactor the service layer",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowCalls[0]!.agent).toBe("opencode");
  });

  test("dispatches deep-research-codebase/claude with prompt", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "deep-research-codebase",
      "-a", "claude",
      "--prompt", "how does auth work",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(`${executeWorkflowCalls[0]!.definition.agent}/${executeWorkflowCalls[0]!.definition.name}`).toBe("claude/deep-research-codebase");
  });

  test("--detach flag threads detach=true to executor", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "ralph",
      "-a", "claude",
      "--prompt", "test",
      "--detach",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowCalls[0]!.detach).toBe(true);
  });

  test("-d shorthand also sets detach=true", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "ralph",
      "-a", "claude",
      "--prompt", "test",
      "-d",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowCalls[0]!.detach).toBe(true);
  });

  test("detach defaults to false when flag omitted", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "ralph",
      "-a", "claude",
      "--prompt", "test",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowCalls[0]!.detach).toBe(false);
  });

  test("integer input --max_loops is forwarded to executor", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "ralph",
      "-a", "claude",
      "--prompt", "test",
      "--max_loops", "3",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowCalls[0]!.inputs?.["max_loops"]).toBe("3");
  });

  test("workflowKey is always <agent>/<name>", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "deep-research-codebase",
      "-a", "copilot",
      "--prompt", "research something",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    const c = executeWorkflowCalls[0]!;
    expect(`${c.definition.agent}/${c.definition.name}`).toBe(
      "copilot/deep-research-codebase",
    );
  });
});

// ─── Named mode — error paths ─────────────────────────────────────────────────

describe("workflowCommand named mode — error paths", () => {
  test("unknown workflow name throws (Commander exits via exitOverride)", async () => {
    enableExitOverride();
    let threw = false;
    const cap = captureOutput();
    try {
      await workflowCommand.parseAsync([
        "node", "cli",
        "-n", "bogus-workflow",
        "-a", "claude",
      ]);
    } catch (_e) {
      threw = true;
    } finally {
      cap.restore();
    }
    expect(threw).toBe(true);
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("unknown agent throws (Commander exits via exitOverride)", async () => {
    enableExitOverride();
    let threw = false;
    const cap = captureOutput();
    try {
      await workflowCommand.parseAsync([
        "node", "cli",
        "-n", "ralph",
        "-a", "bogus-agent",
      ]);
    } catch (_e) {
      threw = true;
    } finally {
      cap.restore();
    }
    expect(threw).toBe(true);
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("missing required prompt for ralph throws from validateAndResolve", async () => {
    enableExitOverride();
    let threw = false;
    const cap = captureOutput();
    try {
      await workflowCommand.parseAsync([
        "node", "cli",
        "-n", "ralph",
        "-a", "claude",
        // --prompt intentionally omitted
      ]);
    } catch (_e) {
      threw = true;
    } finally {
      cap.restore();
    }
    expect(threw).toBe(true);
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("non-integer value for --max_loops throws from validateAndResolve", async () => {
    enableExitOverride();
    let threw = false;
    const cap = captureOutput();
    try {
      await workflowCommand.parseAsync([
        "node", "cli",
        "-n", "ralph",
        "-a", "claude",
        "--prompt", "test",
        "--max_loops", "not-an-int",
      ]);
    } catch (_e) {
      threw = true;
    } finally {
      cap.restore();
    }
    expect(threw).toBe(true);
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });
});

// ─── Enum input coercion ──────────────────────────────────────────────────────

describe("workflowCommand enum input coercion", () => {
  test("valid enum value accepted for open-claude-design --output-type", async () => {
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "open-claude-design",
      "-a", "claude",
      "--prompt", "design a button",
      "--output-type", "prototype",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowCalls[0]!.inputs?.["output-type"]).toBe("prototype");
  });

  test("default enum value applied when --output-type omitted", async () => {
    // output-type has default "prototype" — validateAndResolve fills it in.
    // Note: Commander camelCases hyphenated flags (output-type → outputType),
    // so the CLI flag lookup for "output-type" falls through to the default.
    await workflowCommand.parseAsync([
      "node", "cli",
      "-n", "open-claude-design",
      "-a", "claude",
      "--prompt", "design a button",
      // --output-type intentionally omitted
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowCalls[0]!.inputs?.["output-type"]).toBe("prototype");
  });
});

// ─── Help fallback when name/agent is missing ────────────────────────────────
//
// `cmd.help()` is the action's terminal branch when neither `-n` nor `-a`
// can resolve to a target (and the TTY picker isn't viable). With
// `exitOverride()` Commander throws a CommanderError instead of calling
// `process.exit`, so we can assert the dispatcher reaches the help path
// without dispatching to the executor.

describe("workflowCommand help fallback", () => {
  test("no name and no agent triggers cmd.help() without dispatch", async () => {
    enableExitOverride();
    let threw = false;
    const cap = captureOutput();
    try {
      await workflowCommand.parseAsync(["node", "cli"]);
    } catch {
      threw = true;
    } finally {
      cap.restore();
    }
    expect(threw).toBe(true);
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("agent without name does NOT trigger picker when stdout is not a TTY", async () => {
    enableExitOverride();
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      get: () => false,
    });
    let threw = false;
    const cap = captureOutput();
    try {
      // -a claude with no -n: in TTY mode this would launch the picker;
      // with isTTY=false it falls through to cmd.help().
      await workflowCommand.parseAsync(["node", "cli", "-a", "claude"]);
    } catch {
      threw = true;
    } finally {
      cap.restore();
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        get: () => origIsTTY,
      });
    }
    expect(threw).toBe(true);
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("name without agent triggers cmd.help() — agent is required", async () => {
    enableExitOverride();
    let threw = false;
    const cap = captureOutput();
    try {
      await workflowCommand.parseAsync(["node", "cli", "-n", "ralph"]);
    } catch {
      threw = true;
    } finally {
      cap.restore();
    }
    expect(threw).toBe(true);
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });
});

// ─── Custom-registry behaviours ──────────────────────────────────────────────
//
// `buildWorkflowCommand(registry)` lets us test branches that the
// builtin registry doesn't exercise: workflows with empty input
// schemas (free-form prompt collapse), enum inputs without a
// description (fallback `desc` line), and (name, agent) pairs that
// resolve only for one agent (resolveWorkflow's hint builder).

describe("buildWorkflowCommand with custom registries", () => {
  test("empty-inputs workflow + positional prompt collapses into inputs.prompt", async () => {
    const freeForm = defineWorkflow({
      name: "free-form",
      source: import.meta.path,
    })
      .for("claude")
      .run(async () => {})
      .compile();
    const registry = createRegistry().register(freeForm);
    const cmd = buildWorkflowCommand(registry);

    await cmd.parseAsync([
      "node", "cli",
      "-n", "free-form",
      "-a", "claude",
      "fix",
      "the",
      "auth",
      "bug",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowCalls[0]!.inputs?.["prompt"]).toBe("fix the auth bug");
  });

  test("workflow with declared inputs ignores positional prompt collapsing", async () => {
    const declared = defineWorkflow({
      name: "declared",
      source: import.meta.path,
      inputs: [{ name: "topic", type: "text", required: false }],
    })
      .for("claude")
      .run(async () => {})
      .compile();
    const registry = createRegistry().register(declared);
    const cmd = buildWorkflowCommand(registry);

    await cmd.parseAsync([
      "node", "cli",
      "-n", "declared",
      "-a", "claude",
      "trailing", "positional",
    ]);

    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    // No `prompt` should be synthesised — schema is non-empty.
    expect(executeWorkflowCalls[0]!.inputs?.["prompt"]).toBeUndefined();
  });

  test("resolveWorkflow lists alternate agents when name exists for a different agent", async () => {
    const claudeOnly = defineWorkflow({
      name: "only-claude",
      source: import.meta.path,
      inputs: [{ name: "topic", type: "text", required: false }],
    })
      .for("claude")
      .run(async () => {})
      .compile();
    const registry = createRegistry().register(claudeOnly);
    const cmd = buildWorkflowCommand(registry);
    cmd.exitOverride();

    let caught: unknown;
    const cap = captureOutput();
    try {
      await cmd.parseAsync([
        "node", "cli",
        "-n", "only-claude",
        "-a", "copilot",
      ]);
    } catch (e) {
      caught = e;
    } finally {
      cap.restore();
    }
    expect(caught).toBeDefined();
    const message = caught instanceof Error ? caught.message : String(caught);
    // Hint should call out the agent that DOES have this workflow.
    expect(message).toContain("only-claude");
    expect(message).toContain("claude");
  });

  test("enum input without description gets a 'one of: ...' fallback in --help", async () => {
    const enumWf = defineWorkflow({
      name: "enum-wf",
      source: import.meta.path,
      inputs: [
        {
          name: "format",
          type: "enum",
          required: false,
          values: ["json", "text"],
          // description omitted on purpose — exercises the enum-fallback branch.
        },
      ],
    })
      .for("claude")
      .run(async () => {})
      .compile();
    const registry = createRegistry().register(enumWf);
    const cmd = buildWorkflowCommand(registry);

    // Walk the registered options and find the synthesised --format.
    const formatOption = cmd.options.find((o) => o.long === "--format");
    expect(formatOption).toBeDefined();
    expect(formatOption!.description).toBe("one of: json, text");
  });

  test("text input without description falls back to the type label", async () => {
    const textWf = defineWorkflow({
      name: "text-wf",
      source: import.meta.path,
      inputs: [
        { name: "topic", type: "text", required: false },
      ],
    })
      .for("claude")
      .run(async () => {})
      .compile();
    const registry = createRegistry().register(textWf);
    const cmd = buildWorkflowCommand(registry);

    const topicOption = cmd.options.find((o) => o.long === "--topic");
    expect(topicOption).toBeDefined();
    expect(topicOption!.description).toBe("text");
  });

  test("empty registry rejects unknown name + agent at dispatch time with empty-registry hint", async () => {
    const registry = createRegistry();
    const cmd = buildWorkflowCommand(registry);
    cmd.exitOverride();

    let caught: unknown;
    const cap = captureOutput();
    try {
      // With an empty registry the option parser allows any name (since
      // allNames.length === 0 short-circuits the guard), so we reach
      // resolveWorkflow which throws with the "no workflow named ..."
      // hint.
      await cmd.parseAsync([
        "node", "cli",
        "-n", "anything",
        "-a", "claude",
      ]);
    } catch (e) {
      caught = e;
    } finally {
      cap.restore();
    }
    expect(caught).toBeDefined();
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toContain("anything");
    expect(message).toContain("registry");
  });
});
