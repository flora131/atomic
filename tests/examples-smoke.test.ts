import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkflowDefinition } from "../packages/atomic-sdk/src/types.ts";

const EXAMPLES_DIR = join(import.meta.dir, "..", "examples");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkflowDefinition>;
  return (
    candidate.__brand === "WorkflowDefinition" &&
    typeof candidate.name === "string" &&
    typeof candidate.agent === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.run === "function"
  );
}

async function runExampleCommand(cwd: string, args: readonly string[]): Promise<string> {
  const proc = Bun.spawn([process.execPath, "--silent", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const timeout = setTimeout(() => {
    proc.kill();
  }, 10_000);

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timeout);

  if (exitCode !== 0) {
    throw new Error(
      `example command failed (${exitCode}): ${args.join(" ")} in ${cwd}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return stdout;
}

const helpCommands: Array<{ cwd: string; args: readonly string[]; expected: string }> = [
  { cwd: "commander-embed", args: ["run", "start", "--", "--help"], expected: "Usage: my-app" },
  { cwd: "commander-embed", args: ["run", "status"], expected: "ok" },
  { cwd: "multi-workflow", args: ["run", "start", "--", "--help"], expected: "Usage: multi-workflow" },
  { cwd: "pane-navigation", args: ["run", "start", "--", "--help"], expected: "Usage: pane-navigation" },
  { cwd: "hello-world", args: ["run", "claude", "--", "--help"], expected: "Usage: claude-worker" },
  { cwd: "hello-world", args: ["run", "copilot", "--", "--help"], expected: "Usage: copilot-worker" },
  { cwd: "hello-world", args: ["run", "opencode", "--", "--help"], expected: "Usage: opencode-worker" },
  { cwd: "headless-test", args: ["run", "claude", "--", "--help"], expected: "Usage: claude-worker" },
  { cwd: "headless-test", args: ["run", "copilot", "--", "--help"], expected: "Usage: copilot-worker" },
  { cwd: "headless-test", args: ["run", "opencode", "--", "--help"], expected: "Usage: opencode-worker" },
  { cwd: "hil-favorite-color", args: ["run", "claude", "--", "--help"], expected: "Usage: claude-worker" },
  { cwd: "hil-favorite-color", args: ["run", "copilot", "--", "--help"], expected: "Usage: copilot-worker" },
  { cwd: "hil-favorite-color", args: ["run", "opencode", "--", "--help"], expected: "Usage: opencode-worker" },
  { cwd: "hil-favorite-color-headless", args: ["run", "claude", "--", "--help"], expected: "Usage: claude-worker" },
  { cwd: "hil-favorite-color-headless", args: ["run", "copilot", "--", "--help"], expected: "Usage: copilot-worker" },
  { cwd: "hil-favorite-color-headless", args: ["run", "opencode", "--", "--help"], expected: "Usage: opencode-worker" },
  { cwd: "parallel-hello-world", args: ["run", "claude", "--", "--help"], expected: "Usage: claude-worker" },
  { cwd: "parallel-hello-world", args: ["run", "copilot", "--", "--help"], expected: "Usage: copilot-worker" },
  { cwd: "parallel-hello-world", args: ["run", "opencode", "--", "--help"], expected: "Usage: opencode-worker" },
  { cwd: "structured-output-demo", args: ["run", "claude", "--", "--help"], expected: "Usage: claude-worker" },
  { cwd: "structured-output-demo", args: ["run", "copilot", "--", "--help"], expected: "Usage: copilot-worker" },
  { cwd: "structured-output-demo", args: ["run", "opencode", "--", "--help"], expected: "Usage: opencode-worker" },
  { cwd: "claude-background-subagents", args: ["run", "claude", "--", "--help"], expected: "Usage: claude-worker" },
  { cwd: "review-fix-loop", args: ["run", "claude", "--", "--help"], expected: "Usage: claude-worker" },
  { cwd: "sequential-describe-summarize", args: ["run", "claude", "--", "--help"], expected: "Usage: claude-worker" },
  { cwd: "reviewer-tool-test", args: ["run", "copilot", "--", "--help"], expected: "Usage: copilot-worker" },
];

describe("examples smoke", () => {
  test("all example TypeScript typechecks", async () => {
    await runExampleCommand(join(EXAMPLES_DIR, ".."), [
      "run",
      "tsc",
      "--noEmit",
      "-p",
      "examples/tsconfig.json",
    ]);
  }, 60_000);

  test("interactive example entrypoints use the panel-mounting helper", () => {
    const entrypoints = walk(EXAMPLES_DIR)
      .filter((path) => !path.includes(`${join("node_modules")}`))
      .filter((path) => path.endsWith("worker.ts") || path.endsWith("cli.ts"))
      .filter((path) => !path.includes(`${join("ui-server-client")}`))
      // pane-navigation intentionally starts detached and prints a run id for
      // a second-terminal navigation demo.
      .filter((path) => !path.includes(`${join("pane-navigation")}`));

    expect(entrypoints.length).toBeGreaterThan(0);
    for (const path of entrypoints) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("../run-example-workflow.ts");
      expect(source).toContain("runExampleWorkflow({ workflow");
      expect(source).not.toContain("runWorkflow({ workflow");
    }
  });

  test("workflow source files import as compiled WorkflowDefinitions", async () => {
    const candidates = walk(EXAMPLES_DIR)
      .filter((path) => !path.includes(`${join("node_modules")}`))
      .filter((path) => !path.includes(`${join("ui-server-client")}`))
      .filter((path) => !path.endsWith("run-example-workflow.ts"))
      .filter((path) => !path.endsWith("worker.ts"))
      .filter((path) => !path.endsWith("cli.ts"))
      .filter((path) => !path.includes(`${join("structured-output-demo", "helpers")}`));

    expect(candidates.length).toBeGreaterThan(0);

    for (const path of candidates) {
      const mod = await import(pathToFileURL(path).href) as { default?: unknown };
      if (!isWorkflowDefinition(mod.default)) {
        throw new Error(`${relative(EXAMPLES_DIR, path)} did not default-export a compiled WorkflowDefinition`);
      }
    }
  });

  for (const command of helpCommands) {
    test(`${command.cwd}: ${command.args.join(" ")}`, async () => {
      const stdout = await runExampleCommand(join(EXAMPLES_DIR, command.cwd), command.args);
      expect(stdout).toContain(command.expected);
    }, 20_000);
  }
});
