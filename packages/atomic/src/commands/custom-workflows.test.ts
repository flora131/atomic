/**
 * Unit tests for loadCustomWorkflows().
 *
 * Strategy: real Bun.spawn against shell-script and bun-script fixtures
 * created in a temp directory. Each fixture models a specific failure
 * or success mode from spec §5.8.
 *
 * Captured stderr is checked for the exact §5.8 diagnostic strings.
 * BrokenWorkflow entries are checked for correct shape / reason field.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadCustomWorkflows } from "./custom-workflows.ts";
import type { LoadCustomWorkflowsResult } from "./custom-workflows.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface Captured {
  stderr: string;
  restore: () => void;
}

function captureStderr(): Captured {
  const c: Captured = { stderr: "", restore: () => {} };
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    c.stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  c.restore = () => { process.stderr.write = orig; };
  return c;
}

// ─── Fixture directory ────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "atomic-cwf-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const SETTINGS_PATH = "/fake/settings.json";

/**
 * Write a shell script to tmpDir, make it executable, and return its path.
 */
async function mkScript(name: string, body: string): Promise<string> {
  const p = join(tmpDir, name);
  await writeFile(p, `#!/usr/bin/env sh\n${body}\n`);
  await chmod(p, 0o755);
  return p;
}

/**
 * Write a bun script to tmpDir and return a `bun <path>` invocation pair.
 */
async function mkBunScript(name: string, body: string): Promise<{ command: string; args: string[] }> {
  const p = join(tmpDir, name);
  await writeFile(p, body);
  return { command: "bun", args: [p] };
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("loadCustomWorkflows — happy path", () => {
  test("well-formed entry returns loaded with correct ExternalWorkflow shape", async () => {
    const meta = JSON.stringify([
      {
        name: "my-wf",
        description: "Does stuff",
        agent: "claude",
        inputs: [{ name: "prompt", type: "string" }],
        source: "/some/file.ts",
        minSDKVersion: null,
      },
    ]);

    const { command, args } = await mkBunScript("happy.ts", `
const token = process.env.ATOMIC_DISPATCH_TOKEN;
const argv = process.argv;
if (argv.includes("_emit-workflow-meta") && process.env.ATOMIC_HOST === "1" && token) {
  process.stdout.write("ATOMIC_WORKFLOW_META: ${meta.replace(/"/g, '\\"')}\\n");
  process.exit(0);
}
process.exit(1);
`);

    const cap = captureStderr();
    let result: LoadCustomWorkflowsResult;
    try {
      result = await loadCustomWorkflows(
        { "my-alias": { command, args, agents: ["claude"] } },
        "local",
        SETTINGS_PATH,
      );
    } finally {
      cap.restore();
    }

    expect(result.loaded).toHaveLength(1);
    expect(result.broken).toHaveLength(0);

    const lw = result.loaded[0]!;
    expect(lw.alias).toBe("my-alias");
    expect(lw.origin).toBe("local");
    expect(lw.workflow.kind).toBe("external");
    expect(lw.workflow.name).toBe("my-wf");
    expect(lw.workflow.agent).toBe("claude");
    expect(lw.workflow.description).toBe("Does stuff");
    expect(lw.workflow.inputs).toEqual([{ name: "prompt", type: "string" }]);
    expect(lw.workflow.source).toEqual({ command, args });
    expect(cap.stderr).toBe("");
  });
});

// ─── Failure modes ────────────────────────────────────────────────────────────

describe("loadCustomWorkflows — command not found", () => {
  test("emits §5.8 not-found message and records BrokenWorkflow", async () => {
    const cap = captureStderr();
    let result: LoadCustomWorkflowsResult;
    try {
      result = await loadCustomWorkflows(
        { "missing-cmd": { command: "__atomic_no_such_binary_xyz__", agents: ["claude"] } },
        "global",
        SETTINGS_PATH,
      );
    } finally {
      cap.restore();
    }

    expect(result.loaded).toHaveLength(0);
    expect(result.broken).toHaveLength(1);
    expect(cap.stderr).toContain(
      `"missing-cmd": command "__atomic_no_such_binary_xyz__" not found on PATH; install it or use an absolute path`,
    );
    const bw = result.broken[0]!;
    expect(bw.alias).toBe("missing-cmd");
    expect(bw.origin).toBe("global");
    expect(bw.agents).toEqual(["claude"]);
    expect(bw.source).toBe(SETTINGS_PATH);
    expect(bw.reason).toContain("not found on PATH");
  });
});

describe("loadCustomWorkflows — non-zero exit", () => {
  test("emits §5.8 exit-code message and records BrokenWorkflow", async () => {
    const scriptPath = await mkScript("exit1.sh", `
echo "some error" >&2
exit 42
`);

    const cap = captureStderr();
    let result: LoadCustomWorkflowsResult;
    try {
      result = await loadCustomWorkflows(
        { "exit-fail": { command: scriptPath, agents: ["claude"] } },
        "local",
        SETTINGS_PATH,
      );
    } finally {
      cap.restore();
    }

    expect(result.loaded).toHaveLength(0);
    expect(result.broken).toHaveLength(1);
    expect(cap.stderr).toContain(`"exit-fail"`);
    expect(cap.stderr).toContain("exited 42");
    expect(cap.stderr).toContain("some error");
    const bw = result.broken[0]!;
    expect(bw.reason).toContain("exited 42");
  });
});

describe("loadCustomWorkflows — missing ATOMIC_WORKFLOW_META line", () => {
  test("emits §5.8 missing-meta message and records BrokenWorkflow", async () => {
    const scriptPath = await mkScript("no-meta.sh", `
echo "hello world"
exit 0
`);

    const cap = captureStderr();
    let result: LoadCustomWorkflowsResult;
    try {
      result = await loadCustomWorkflows(
        { "no-meta": { command: scriptPath, agents: ["claude"] } },
        "local",
        SETTINGS_PATH,
      );
    } finally {
      cap.restore();
    }

    expect(result.loaded).toHaveLength(0);
    expect(result.broken).toHaveLength(1);
    expect(cap.stderr).toContain(
      `"no-meta": expected ATOMIC_WORKFLOW_META line — third-party CLI may be missing 'import "@bastani/atomic-sdk"'`,
    );
    expect(result.broken[0]!.reason).toContain("expected ATOMIC_WORKFLOW_META line");
  });
});

describe("loadCustomWorkflows — malformed JSON", () => {
  test("emits parse-error with offending substring and records BrokenWorkflow", async () => {
    const scriptPath = await mkScript("bad-json.sh", `
printf 'ATOMIC_WORKFLOW_META: {bad json here}\\n'
exit 0
`);

    const cap = captureStderr();
    let result: LoadCustomWorkflowsResult;
    try {
      result = await loadCustomWorkflows(
        { "bad-json": { command: scriptPath, agents: ["claude"] } },
        "local",
        SETTINGS_PATH,
      );
    } finally {
      cap.restore();
    }

    expect(result.loaded).toHaveLength(0);
    expect(result.broken).toHaveLength(1);
    expect(cap.stderr).toContain('"bad-json"');
    expect(cap.stderr).toContain("failed to parse ATOMIC_WORKFLOW_META JSON");
    expect(cap.stderr).toContain("{bad json here}");
    expect(result.broken[0]!.reason).toContain("failed to parse");
  });
});

describe("loadCustomWorkflows — timeout", () => {
  test("kills child, emits timeout message, records BrokenWorkflow", async () => {
    // Use a bun script that busy-loops so the process is the direct child
    // (no fork/exec child that outlives the parent and keeps the pipe open).
    const { command, args } = await mkBunScript("sleeper.ts", `
// Never exits — simulates a CLI that hangs instead of emitting metadata.
await new Promise(() => {});
`);

    const origTimeout = process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS;
    process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS = "300";

    const cap = captureStderr();
    let result: LoadCustomWorkflowsResult;
    try {
      result = await loadCustomWorkflows(
        { "slow-cmd": { command, args, agents: ["claude"] } },
        "local",
        SETTINGS_PATH,
      );
    } finally {
      cap.restore();
      if (origTimeout === undefined) delete process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS;
      else process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS = origTimeout;
    }

    expect(result.loaded).toHaveLength(0);
    expect(result.broken).toHaveLength(1);
    expect(cap.stderr).toContain("metadata emission timed out after 300ms");
    expect(cap.stderr).toContain("@bastani/atomic-sdk");
    expect(result.broken[0]!.reason).toContain("timed out after 300ms");
  }, 15000);
});

describe("loadCustomWorkflows — declared agent missing in meta", () => {
  test("skips only missing agent, registers present agent, records one BrokenWorkflow", async () => {
    const meta = JSON.stringify([
      {
        name: "my-wf",
        description: "Claude only",
        agent: "claude",
        inputs: [],
        source: "/file.ts",
        minSDKVersion: null,
      },
    ]);

    const { command, args } = await mkBunScript("partial-agents.ts", `
const token = process.env.ATOMIC_DISPATCH_TOKEN;
if (process.argv.includes("_emit-workflow-meta") && process.env.ATOMIC_HOST === "1" && token) {
  process.stdout.write('ATOMIC_WORKFLOW_META: ${meta.replace(/'/g, "\\'")}\\n');
  process.exit(0);
}
process.exit(1);
`);

    const cap = captureStderr();
    let result: LoadCustomWorkflowsResult;
    try {
      result = await loadCustomWorkflows(
        { "partial": { command, args, agents: ["claude", "opencode"] } },
        "local",
        SETTINGS_PATH,
      );
    } finally {
      cap.restore();
    }

    // claude should be loaded, opencode should be broken
    expect(result.loaded).toHaveLength(1);
    expect(result.loaded[0]!.workflow.agent).toBe("claude");

    expect(result.broken).toHaveLength(1);
    expect(result.broken[0]!.agents).toEqual(["opencode"]);
    expect(cap.stderr).toContain(
      `"partial/opencode": command did not register a workflow for agent "opencode"`,
    );
  });
});

describe("loadCustomWorkflows — undefined workflows", () => {
  test("returns empty result without spawning anything", async () => {
    const result = await loadCustomWorkflows(undefined, "local", SETTINGS_PATH);
    expect(result.loaded).toHaveLength(0);
    expect(result.broken).toHaveLength(0);
  });
});

describe("loadCustomWorkflows — Promise.all parallelism", () => {
  test("loads multiple entries concurrently", async () => {
    const makeMeta = (agent: string, name: string) =>
      JSON.stringify([{ name, description: "", agent, inputs: [], source: "/f.ts", minSDKVersion: null }]);

    const { command: cmd1, args: args1 } = await mkBunScript("parallel1.ts", `
if (process.argv.includes("_emit-workflow-meta") && process.env.ATOMIC_HOST === "1") {
  process.stdout.write('ATOMIC_WORKFLOW_META: ${makeMeta("claude", "wf-a").replace(/'/g, "\\'")}\\n');
  process.exit(0);
}
process.exit(1);
`);

    const { command: cmd2, args: args2 } = await mkBunScript("parallel2.ts", `
if (process.argv.includes("_emit-workflow-meta") && process.env.ATOMIC_HOST === "1") {
  process.stdout.write('ATOMIC_WORKFLOW_META: ${makeMeta("opencode", "wf-b").replace(/'/g, "\\'")}\\n');
  process.exit(0);
}
process.exit(1);
`);

    const cap = captureStderr();
    let result: LoadCustomWorkflowsResult;
    try {
      result = await loadCustomWorkflows(
        {
          "alias-a": { command: cmd1, args: args1, agents: ["claude"] },
          "alias-b": { command: cmd2, args: args2, agents: ["opencode"] },
        },
        "local",
        SETTINGS_PATH,
      );
    } finally {
      cap.restore();
    }

    expect(result.loaded).toHaveLength(2);
    expect(result.broken).toHaveLength(0);
    const names = result.loaded.map((l) => l.workflow.name).sort();
    expect(names).toEqual(["wf-a", "wf-b"]);
  });
});
