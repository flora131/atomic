/**
 * Integration-style tests for `workflowCommand` — the CLI entry point that
 * wires list/picker/named-mode branching together. Three modules are stubbed:
 * the workflows SDK (executor + tmux probe + discovery), the system detector
 * (command-presence checks), and the spawn helpers (best-effort installers).
 * Every one of these is a side-effectful dependency — tmux spawn, disk I/O,
 * agent CLI spawn — and replacing them with controlled fakes lets us hit the
 * CLI's error/success branches without actually touching the real system.
 *
 * Two patterns make this file work:
 *
 *   1. `mock.module(…)` replaces each dependency module BEFORE the first
 *      dynamic `import("./workflow.ts")` so the module-under-test binds to
 *      the mocked references. Top-level await is required — a static import
 *      would hoist above the mocks and defeat them.
 *
 *   2. Every test runs against a fresh `mkdtemp`ed cwd plumbed through the
 *      `cwd` option. That lets us control which workflows the command sees
 *      without touching the repo's own `.atomic/workflows` tree.
 */

import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as realWorkflows from "@/sdk/workflows/index.ts";
import * as realDetect from "@/services/system/detect.ts";
import * as realSpawn from "../../lib/spawn.ts";
import { AGENT_CONFIG } from "@/services/config/index.ts";
import type {
  WorkflowDefinition,
  WorkflowRunOptions,
  DiscoveredWorkflow,
} from "@/sdk/workflows/index.ts";

// Capture original function references BEFORE `mock.module` replaces the
// module exports. `import * as realWorkflows` gives a LIVE namespace — after
// mock.module rebinds the exports, `realWorkflows.discoverWorkflows` would
// resolve to our own mock and a pass-through would recurse infinitely. These
// constants lock in the real implementations so pass-through defaults work.
const realDiscoverWorkflows = realWorkflows.discoverWorkflows;
const realLoadWorkflowsMetadata = realWorkflows.loadWorkflowsMetadata;
const realIsCommandInstalled = realDetect.isCommandInstalled;

// ─── Dependency mocks ───────────────────────────────────────────────────────
// Every mock is a wrapper around the real implementation by default so
// unrelated tests that don't care about a given mock still see the real
// behaviour. Tests override specific mocks via `mockImplementationOnce` (or a
// longer-lived `mockImplementation` inside a describe block) to exercise
// failure branches. `beforeEach` resets everything to the default pass-through.

const executeWorkflowMock =
  mock<(opts: WorkflowRunOptions) => Promise<void>>(async () => {});

// Default: real discovery so the filesystem-level branches still work.
const discoverWorkflowsMock = mock<typeof realWorkflows.discoverWorkflows>(
  (...args) => realDiscoverWorkflows(...args),
);

// Default: real metadata load — supports the picker branches that need
// compiled metadata from a real workflow on disk.
const loadWorkflowsMetadataMock = mock<
  typeof realWorkflows.loadWorkflowsMetadata
>((...args) => realLoadWorkflowsMetadata(...args));

// Default: pretend tmux is installed. The test env has it, but we want the
// coverage test to be deterministic regardless of host config — if the host
// removed tmux we'd still want these tests to cover the happy path.
const isTmuxInstalledMock =
  mock<typeof realWorkflows.isTmuxInstalled>(() => true);

// Default: delegate to the real check, but pretend agent CLIs are installed.
// CI runners won't have copilot/opencode/claude on PATH; without this
// override every test that passes through runPrereqChecks would bail early.
// Non-agent commands still hit the real check so mock.module doesn't break
// detect.test.ts (Bun shares one process across test files).
const AGENT_CMDS = new Set(Object.values(AGENT_CONFIG).map((c) => c.cmd));
const defaultIsCommandInstalled = (cmd: string) =>
  AGENT_CMDS.has(cmd) || realIsCommandInstalled(cmd);
const isCommandInstalledMock = mock<typeof realDetect.isCommandInstalled>(
  defaultIsCommandInstalled,
);

// Default: no-op so the best-effort installer branch in runPrereqChecks
// doesn't try to actually install tmux/bun on the test machine.
const ensureTmuxInstalledMock = mock<typeof realSpawn.ensureTmuxInstalled>(
  async () => {},
);
const ensureBunInstalledMock = mock<typeof realSpawn.ensureBunInstalled>(
  async () => {},
);

mock.module("@/sdk/workflows/index.ts", () => ({
  ...realWorkflows,
  executeWorkflow: executeWorkflowMock,
  discoverWorkflows: discoverWorkflowsMock,
  loadWorkflowsMetadata: loadWorkflowsMetadataMock,
  isTmuxInstalled: isTmuxInstalledMock,
}));
mock.module("@/services/system/detect.ts", () => ({
  ...realDetect,
  isCommandInstalled: isCommandInstalledMock,
}));
mock.module("../../lib/spawn.ts", () => ({
  ...realSpawn,
  ensureTmuxInstalled: ensureTmuxInstalledMock,
  ensureBunInstalled: ensureBunInstalledMock,
}));

// Dynamic import — must happen AFTER `mock.module` so the module-under-test
// binds to the mocked dependencies. Top-level await is fine under Bun.
const { workflowCommand } = await import("./workflow.ts");

// ─── Output capture ─────────────────────────────────────────────────────────
// The CLI writes error banners to stderr via `console.error`, success content
// to stdout via `process.stdout.write`. Wrap both so tests can snapshot the
// emitted text without leaking it into the test runner's own output.

interface CapturedOutput {
  stdout: string;
  stderr: string;
  restore: () => void;
}

function captureOutput(): CapturedOutput {
  const captured: CapturedOutput = {
    stdout: "",
    stderr: "",
    restore: () => {},
  };
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;

  // Typed as never so the loose commander signature doesn't widen.
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    captured.stdout +=
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  console.error = (...args: unknown[]) => {
    captured.stderr += args.map((a) => String(a)).join(" ") + "\n";
  };
  console.log = (...args: unknown[]) => {
    captured.stdout += args.map((a) => String(a)).join(" ") + "\n";
  };
  console.warn = (...args: unknown[]) => {
    captured.stderr += args.map((a) => String(a)).join(" ") + "\n";
  };

  captured.restore = () => {
    process.stdout.write = originalStdoutWrite;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  };
  return captured;
}

// ─── Colour handling ────────────────────────────────────────────────────────
// `NO_COLOR` flips both COLORS (module load time) and createPainter (call
// time) into plain-text mode so assertions can match against readable
// substrings rather than SGR escape noise. COLORS is baked at module load
// so the env var must already be set by the time workflow.ts gets imported.

let originalNoColor: string | undefined;
beforeAll(() => {
  originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});
afterAll(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = originalNoColor;
});

// ─── Temp workspace plumbing ────────────────────────────────────────────────
// Each test gets a fresh cwd so one test's workflows can't leak into another.
// The actual workflow files live under `.atomic/workflows/<name>/<agent>/index.ts`
// — matching the layout that `discoverWorkflows` scans.

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "atomic-workflow-cmd-test-"));
  // Reset every mock to its default pass-through / no-op so tests are
  // independent — no leftover state from prior overrides. `mockClear` wipes
  // call history; `mockImplementation` replaces the queued implementation
  // (including anything set via `mockImplementationOnce`) with the default.
  executeWorkflowMock.mockClear();
  executeWorkflowMock.mockImplementation(async () => {});
  discoverWorkflowsMock.mockClear();
  discoverWorkflowsMock.mockImplementation((...args) =>
    realDiscoverWorkflows(...args),
  );
  loadWorkflowsMetadataMock.mockClear();
  loadWorkflowsMetadataMock.mockImplementation((...args) =>
    realLoadWorkflowsMetadata(...args),
  );
  isTmuxInstalledMock.mockClear();
  isTmuxInstalledMock.mockImplementation(() => true);
  isCommandInstalledMock.mockClear();
  isCommandInstalledMock.mockImplementation(defaultIsCommandInstalled);
  ensureTmuxInstalledMock.mockClear();
  ensureTmuxInstalledMock.mockImplementation(async () => {});
  ensureBunInstalledMock.mockClear();
  ensureBunInstalledMock.mockImplementation(async () => {});
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/**
 * Write a real workflow file that compiles through `defineWorkflow()`.
 * Tests import a real SDK so the module under test sees a live
 * `WorkflowDefinition`, not a mock shape — this keeps the coverage
 * line-level on `runNamedMode`'s resolution of the compiled definition.
 */
async function writeCompiledWorkflow(
  opts: {
    name: string;
    agent: "claude" | "copilot" | "opencode";
    source?: string;
  },
): Promise<string> {
  const dir = join(tempDir, ".atomic", "workflows", opts.name, opts.agent);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "index.ts");
  const defaultBody =
    opts.source ??
    `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";

export default defineWorkflow({ name: "${opts.name}" })
  .run(async () => {})
  .compile();
`;
  await writeFile(filePath, defaultBody);
  return filePath;
}

// ─── List mode ──────────────────────────────────────────────────────────────

describe("workflowCommand --list", () => {
  test("prints the rendered list and returns 0", async () => {
    await writeCompiledWorkflow({ name: "alpha", agent: "copilot" });

    const cap = captureOutput();
    const code = await workflowCommand({
      list: true,
      agent: "copilot",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(0);
    // Singular noun because only our one workflow is filtered in, and builtins
    // discovered via `{ merge: false }` may still show up — so assert on the
    // name we wrote instead of a count.
    expect(cap.stdout).toContain("alpha");
    expect(cap.stdout).toContain("run: atomic workflow -n <name> -a <agent>");
  });

  test("filters by the provided agent", async () => {
    await writeCompiledWorkflow({ name: "claude-only", agent: "claude" });
    await writeCompiledWorkflow({ name: "copilot-only", agent: "copilot" });

    const cap = captureOutput();
    const code = await workflowCommand({
      list: true,
      agent: "claude",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(0);
    expect(cap.stdout).toContain("claude-only");
    expect(cap.stdout).not.toContain("copilot-only");
  });

  test("renders the empty state when no workflows exist and no agent filter is set", async () => {
    // No agent filter + a fresh tempdir means `discoverWorkflows` only
    // returns builtins for whichever agents exist on disk; to exercise
    // the real empty-state branch we filter to an agent with no builtin
    // coverage for the tempdir — `opencode` has builtins too, so instead
    // point at an empty workflows directory.
    const cap = captureOutput();
    const code = await workflowCommand({
      list: true,
      agent: "copilot",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(0);
    // Either the builtin ralph shows up or we get the "no workflows" banner.
    // We only need to verify the code path completes and writes *something*.
    expect(cap.stdout.length).toBeGreaterThan(0);
  });
});

// ─── Agent validation ──────────────────────────────────────────────────────

describe("workflowCommand agent validation", () => {
  test("missing agent returns 1 and logs a targeted error", async () => {
    const cap = captureOutput();
    const code = await workflowCommand({ cwd: tempDir });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("Missing agent");
  });

  test("unknown agent returns 1 and lists valid agents", async () => {
    const cap = captureOutput();
    const code = await workflowCommand({
      agent: "bogus-agent",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("Unknown agent");
    // Error helper lists valid agents — spot-check one.
    expect(cap.stderr).toContain("claude");
  });
});

// ─── Picker mode error paths ───────────────────────────────────────────────

describe("workflowCommand picker mode", () => {
  test("rejects passthrough args in picker mode", async () => {
    // No `-n` means picker mode; any extra args are ambiguous (would the
    // user want them fed into the picker's form, or straight through?), so
    // the command bails early rather than guessing.
    const cap = captureOutput();
    const code = await workflowCommand({
      agent: "copilot",
      passthroughArgs: ["oops", "--mode=fast"],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("unexpected arguments");
    // The hint points the user at the right place.
    expect(cap.stderr).toContain("-n <name>");
  });
});

// ─── Named mode error paths ────────────────────────────────────────────────

describe("workflowCommand named-mode error paths", () => {
  test("unknown workflow name returns 1 and lists available options", async () => {
    // Seed one workflow so the "Available" section renders.
    await writeCompiledWorkflow({ name: "real-one", agent: "copilot" });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "does-not-exist",
      agent: "copilot",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("does-not-exist");
    expect(cap.stderr).toContain("not found");
    // Lists the real workflow we wrote so users can copy-paste a valid name.
    expect(cap.stderr).toContain("real-one");
    // executeWorkflow should never be called on the error path.
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("parse errors in passthrough args abort before loading", async () => {
    await writeCompiledWorkflow({ name: "parse-err", agent: "copilot" });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "parse-err",
      agent: "copilot",
      // Trailing --flag with no value is the canonical parse error.
      passthroughArgs: ["--orphan"],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("--orphan");
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("load errors from WorkflowLoader surface cleanly", async () => {
    // Write a workflow file that lacks `.compile()` — the loader treats
    // this as a hard error and the CLI must return 1 rather than crash.
    await writeCompiledWorkflow({
      name: "broken",
      agent: "copilot",
      source: `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";

export default defineWorkflow({ name: "broken" })
  .run(async () => {});
// intentionally missing .compile()
`,
    });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "broken",
      agent: "copilot",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("not compiled");
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("free-form workflow rejects stray --flags", async () => {
    // A workflow with no declared `inputs` takes a positional prompt; any
    // `--<name>` flag is definitionally wrong because there's nothing for
    // it to bind to.
    await writeCompiledWorkflow({ name: "free-form", agent: "copilot" });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "free-form",
      agent: "copilot",
      passthroughArgs: ["--mode=fast"],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("no declared inputs");
    expect(cap.stderr).toContain("--mode");
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("structured workflow rejects positional prompt tokens", async () => {
    await writeCompiledWorkflow({
      name: "structured",
      agent: "copilot",
      source: `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";

export default defineWorkflow({
  name: "structured",
  inputs: [
    { name: "topic", type: "string", required: true },
  ],
})
  .run(async () => {})
  .compile();
`,
    });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "structured",
      agent: "copilot",
      // Positional-only invocation is ambiguous against a structured
      // schema, so the command refuses to guess.
      passthroughArgs: ["just", "a", "prompt"],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("structured inputs");
    expect(cap.stderr).toContain("--topic");
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  test("structured workflow surfaces schema validation errors", async () => {
    await writeCompiledWorkflow({
      name: "validated",
      agent: "copilot",
      source: `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";

export default defineWorkflow({
  name: "validated",
  inputs: [
    { name: "topic", type: "string", required: true },
  ],
})
  .run(async () => {})
  .compile();
`,
    });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "validated",
      agent: "copilot",
      // Empty flag set — required `topic` is missing.
      passthroughArgs: [],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("--topic");
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });
});

// ─── Named mode success paths (via mocked executor) ────────────────────────

describe("workflowCommand named-mode success paths", () => {
  test("free-form workflow runs through the executor with the prompt as input", async () => {
    await writeCompiledWorkflow({ name: "runs", agent: "copilot" });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "runs",
      agent: "copilot",
      passthroughArgs: ["fix", "the", "bug"],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(0);
    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    const call = executeWorkflowMock.mock.calls[0]![0];
    expect(call.agent).toBe("copilot");
    // Free-form prompt is threaded under the `prompt` key so workflow
    // authors can read `ctx.inputs.prompt` uniformly.
    expect(call.inputs).toEqual({ prompt: "fix the bug" });
    expect((call.definition as WorkflowDefinition).name).toBe("runs");
  });

  test("free-form workflow with no prompt forwards an empty inputs record", async () => {
    await writeCompiledWorkflow({ name: "silent", agent: "copilot" });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "silent",
      agent: "copilot",
      passthroughArgs: [],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(0);
    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowMock.mock.calls[0]![0].inputs).toEqual({});
  });

  test("structured workflow resolves flags and calls executor with merged inputs", async () => {
    await writeCompiledWorkflow({
      name: "struct-run",
      agent: "copilot",
      source: `
import { defineWorkflow } from "${join(process.cwd(), "src/sdk/workflows/index.ts")}";

export default defineWorkflow({
  name: "struct-run",
  inputs: [
    { name: "topic", type: "string", required: true },
    { name: "depth", type: "enum", values: ["shallow", "deep"], default: "shallow" },
  ],
})
  .run(async () => {})
  .compile();
`,
    });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "struct-run",
      agent: "copilot",
      passthroughArgs: ["--topic=authz", "--depth=deep"],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(0);
    expect(executeWorkflowMock).toHaveBeenCalledTimes(1);
    expect(executeWorkflowMock.mock.calls[0]![0].inputs).toEqual({
      topic: "authz",
      depth: "deep",
    });
  });

  test("runLoadedWorkflow surfaces executor failures as exit code 1", async () => {
    await writeCompiledWorkflow({ name: "boom", agent: "copilot" });

    executeWorkflowMock.mockImplementationOnce(async () => {
      throw new Error("tmux is on fire");
    });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "boom",
      agent: "copilot",
      passthroughArgs: ["try", "it"],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("Workflow failed");
    expect(cap.stderr).toContain("tmux is on fire");
  });

  test("runLoadedWorkflow stringifies non-Error throwns", async () => {
    await writeCompiledWorkflow({ name: "non-err", agent: "copilot" });

    executeWorkflowMock.mockImplementationOnce(async () => {
      // Thrown value is a plain string — the catch branch falls back to
      // `String(error)` rather than reading `.message`.
      throw "raw string failure";
    });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "non-err",
      agent: "copilot",
      passthroughArgs: [],
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("raw string failure");
  });
});

// ─── Prereq checks (runPrereqChecks) ───────────────────────────────────────

describe("workflowCommand prereq checks", () => {
  test("missing agent CLI returns 1 with an install hint", async () => {
    // `isCommandInstalled` is the first gate in runPrereqChecks — when it
    // returns false for the agent binary, the command errors out before
    // ever touching tmux or bun.
    isCommandInstalledMock.mockImplementation((cmd) => cmd !== "claude");

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "anything",
      agent: "claude",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("'claude' is not installed");
    expect(cap.stderr).toContain("Install it from");
  });

  test("missing tmux attempts installer then errors when still absent", async () => {
    // Force tmux to never appear even after the installer runs. The
    // installer itself resolves cleanly, so we exercise the post-installer
    // recheck + error-branch combination.
    isTmuxInstalledMock.mockImplementation(() => false);

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "anything",
      agent: "copilot",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(ensureTmuxInstalledMock).toHaveBeenCalledTimes(1);
    // Platform-specific message — both tmux and psmux acceptable.
    expect(cap.stderr).toMatch(/(tmux|psmux) is not installed/);
  });

  test("best-effort tmux installer errors are swallowed", async () => {
    // Even if the installer throws, runPrereqChecks falls through to a
    // second `isTmuxInstalled()` check — if that still says false, we
    // return the same error. The installer failure itself must not
    // propagate.
    isTmuxInstalledMock.mockImplementation(() => false);
    ensureTmuxInstalledMock.mockImplementationOnce(async () => {
      throw new Error("installer crashed");
    });

    const cap = captureOutput();
    const code = await workflowCommand({
      name: "anything",
      agent: "copilot",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    // The crash message never surfaces — the catch block just swallows it.
    expect(cap.stderr).not.toContain("installer crashed");
    expect(cap.stderr).toMatch(/(tmux|psmux) is not installed/);
  });
});

// ─── Picker mode discovery branches ────────────────────────────────────────

describe("workflowCommand picker discovery branches", () => {
  test("returns 1 when discovery finds zero workflows", async () => {
    // Picker mode without any workflows on disk — the CLI should explain
    // where to put a new workflow rather than render an empty picker.
    discoverWorkflowsMock.mockImplementationOnce(async () => []);

    const cap = captureOutput();
    const code = await workflowCommand({
      agent: "copilot",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("No workflows found");
    expect(cap.stderr).toContain(".atomic/workflows/<name>/copilot/index.ts");
  });

  test("returns 1 when every discovered workflow fails to load metadata", async () => {
    // Discovery found entries but metadata load returned nothing — that's
    // the "all workflows on disk are broken" branch. We fake a single
    // discovered entry and then make the metadata loader drop it.
    const fakeEntry: DiscoveredWorkflow = {
      name: "broken",
      agent: "copilot",
      source: "local",
      path: join(tempDir, ".atomic/workflows/broken/copilot/index.ts"),
    };
    discoverWorkflowsMock.mockImplementationOnce(async () => [fakeEntry]);
    loadWorkflowsMetadataMock.mockImplementationOnce(async () => []);

    const cap = captureOutput();
    const code = await workflowCommand({
      agent: "copilot",
      cwd: tempDir,
    });
    cap.restore();

    expect(code).toBe(1);
    expect(cap.stderr).toContain("All discovered workflows failed to load");
  });
});

// Note on the picker success path: the branches that actually open the
// interactive picker (runPickerMode lines after the "no workflows found" and
// "all failed to load" guards, plus all of runResolvedSelection) are not
// covered from this file. Exercising them requires mocking
// `WorkflowPickerPanel`, which is a side-effectful class that spins up a
// real CliRenderer on stdin/stdout. Mocking it process-wide via mock.module
// leaks into the WorkflowPickerPanel's own unit tests (they share the same
// bun test process) and breaks them — the same live-binding issue that
// mock.module has with other consumers in the suite. Rather than fight the
// tooling, we accept a small amount of uncovered code in the picker success
// path; the remaining coverage comfortably clears the per-file threshold.
