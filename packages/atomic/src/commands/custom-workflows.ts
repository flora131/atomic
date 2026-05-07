/**
 * Custom workflow loader.
 *
 * Spawns each entry's command with `_emit-workflow-meta`, parses the emitted
 * JSON, and returns a `LoadCustomWorkflowsResult` containing successfully
 * loaded workflows and structured failure records.
 *
 * RFC §5.5 + §5.8.
 */

import { randomBytes } from "node:crypto";
import type { CustomWorkflowEntry } from "@bastani/atomic-sdk/services/config/atomic-config";
import type { AgentType, ExternalWorkflow, WorkflowInput } from "@bastani/atomic-sdk";

// ─── Public types ────────────────────────────────────────────────────────────

export interface LoadedWorkflow {
  alias: string;
  origin: "local" | "global";
  workflow: ExternalWorkflow;
}

export interface BrokenWorkflow {
  alias: string;
  origin: "local" | "global";
  agents: AgentType[];
  reason: string;
  source: string;
  fix: string;
}

export interface LoadCustomWorkflowsResult {
  loaded: LoadedWorkflow[];
  broken: BrokenWorkflow[];
}

// ─── Emitted meta shape (from the SDK's _emit-workflow-meta handler) ─────────

interface EmittedWorkflowDef {
  name: string;
  description?: string;
  agent: AgentType;
  inputs: WorkflowInput[];
  source: string;
  minSDKVersion: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const META_PREFIX = "ATOMIC_WORKFLOW_META: ";
const DEFAULT_TIMEOUT_MS = 5000;
const STDERR_TRUNCATE = 500;
const JSON_TRUNCATE = 200;

function resolveTimeoutMs(): number {
  const raw = process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load custom workflows from a `settings.json` `workflows` map.
 *
 * Spawns each entry's command with `_emit-workflow-meta`, parses the output,
 * and returns loaded + broken workflows. Failures are isolated per-entry (and
 * per-agent for the "declared agent missing" case).
 */
export async function loadCustomWorkflows(
  workflows: Record<string, CustomWorkflowEntry> | undefined,
  origin: "local" | "global",
  settingsPath: string,
): Promise<LoadCustomWorkflowsResult> {
  if (!workflows) return { loaded: [], broken: [] };

  const results = await Promise.all(
    Object.entries(workflows).map(([alias, entry]) =>
      loadOne(alias, entry, origin, settingsPath),
    ),
  );

  const loaded: LoadedWorkflow[] = [];
  const broken: BrokenWorkflow[] = [];
  for (const r of results) {
    loaded.push(...r.loaded);
    broken.push(...r.broken);
  }
  return { loaded, broken };
}

// ─── Single-entry loader ─────────────────────────────────────────────────────

async function loadOne(
  alias: string,
  entry: CustomWorkflowEntry,
  origin: "local" | "global",
  settingsPath: string,
): Promise<LoadCustomWorkflowsResult> {
  const loaded: LoadedWorkflow[] = [];
  const broken: BrokenWorkflow[] = [];
  const timeoutMs = resolveTimeoutMs();

  // ── Spawn ────────────────────────────────────────────────────────────────

  const token = randomBytes(16).toString("hex");
  const argv = [
    entry.command,
    ...(entry.args ?? []),
    "_emit-workflow-meta",
    `--dispatch-token=${token}`,
  ];

  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(argv, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ATOMIC_HOST: "1", ATOMIC_DISPATCH_TOKEN: token },
    });
  } catch (err) {
    const msg = spawnErrorMessage(alias, entry.command, err);
    process.stderr.write(`[atomic/workflows] ${msg}\n`);
    broken.push({
      alias,
      origin,
      agents: entry.agents,
      reason: msg,
      source: settingsPath,
      fix: isNotFoundError(err)
        ? `install "${entry.command}" or use an absolute path`
        : "check file permissions and PATH",
    });
    return { loaded, broken };
  }

  // ── Timeout race ─────────────────────────────────────────────────────────

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { child.kill(); } catch { /* ignore kill errors */ }
  }, timeoutMs);

  const [stdoutText, stderrText] = await Promise.all([
    readStream(child.stdout),
    readStream(child.stderr),
  ]);

  await child.exited;
  clearTimeout(timer);

  if (timedOut) {
    const msg = `"${alias}": metadata emission timed out after ${timeoutMs}ms — is the third-party CLI using @bastani/atomic-sdk?`;
    process.stderr.write(`[atomic/workflows] ${msg}\n`);
    broken.push({
      alias,
      origin,
      agents: entry.agents,
      reason: msg,
      source: settingsPath,
      fix: `ensure "${entry.command}" imports @bastani/atomic-sdk`,
    });
    return { loaded, broken };
  }

  // ── Exit code ────────────────────────────────────────────────────────────

  const exitCode = child.exitCode;
  if (exitCode !== 0) {
    const argStr = [...(entry.args ?? []), "_emit-workflow-meta"].join(" ");
    const cmdStr = argStr ? `${entry.command} ${argStr}` : `${entry.command} _emit-workflow-meta`;
    const capturedStderr = stderrText.slice(0, STDERR_TRUNCATE);
    const msg = `"${alias}": "${cmdStr}" exited ${exitCode}; stderr: ${capturedStderr}`;
    process.stderr.write(`[atomic/workflows] ${msg}\n`);
    broken.push({
      alias,
      origin,
      agents: entry.agents,
      reason: msg,
      source: settingsPath,
      fix: `check that "${entry.command}" supports _emit-workflow-meta`,
    });
    return { loaded, broken };
  }

  // ── Parse meta line ───────────────────────────────────────────────────────

  const metaLine = stdoutText
    .split("\n")
    .find((l) => l.startsWith(META_PREFIX));

  if (!metaLine) {
    const msg = `"${alias}": expected ATOMIC_WORKFLOW_META line — third-party CLI may be missing 'import "@bastani/atomic-sdk"'`;
    process.stderr.write(`[atomic/workflows] ${msg}\n`);
    broken.push({
      alias,
      origin,
      agents: entry.agents,
      reason: msg,
      source: settingsPath,
      fix: `add 'import "@bastani/atomic-sdk"' to "${entry.command}"`,
    });
    return { loaded, broken };
  }

  const jsonStr = metaLine.slice(META_PREFIX.length);
  let emitted: EmittedWorkflowDef[];
  try {
    emitted = JSON.parse(jsonStr) as EmittedWorkflowDef[];
  } catch (parseErr) {
    const snippet = jsonStr.slice(0, JSON_TRUNCATE);
    const msg = `"${alias}": failed to parse ATOMIC_WORKFLOW_META JSON — ${String(parseErr)}; offending substring: ${snippet}`;
    process.stderr.write(`[atomic/workflows] ${msg}\n`);
    broken.push({
      alias,
      origin,
      agents: entry.agents,
      reason: msg,
      source: settingsPath,
      fix: `ensure "${entry.command}" emits valid JSON on the ATOMIC_WORKFLOW_META line`,
    });
    return { loaded, broken };
  }

  // ── Match per declared agent ──────────────────────────────────────────────

  for (const declaredAgent of entry.agents) {
    const def = emitted.find((d) => d.agent === declaredAgent);
    if (!def) {
      const msg = `"${alias}/${declaredAgent}": command did not register a workflow for agent "${declaredAgent}"`;
      process.stderr.write(`[atomic/workflows] ${msg}\n`);
      broken.push({
        alias,
        origin,
        agents: [declaredAgent],
        reason: msg,
        source: settingsPath,
        fix: `add a .for("${declaredAgent}") branch to the workflow in "${entry.command}"`,
      });
      continue;
    }

    loaded.push({
      alias,
      origin,
      workflow: {
        kind: "external",
        name: def.name,
        agent: declaredAgent,
        description: def.description,
        inputs: def.inputs ?? [],
        source: { command: entry.command, args: entry.args ?? [] },
      },
    });
  }

  return { loaded, broken };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readStream(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>> | number | null | undefined,
): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  return new Response(stream as ReadableStream<Uint8Array>).text();
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT" || code === "MODULE_NOT_FOUND";
}

function spawnErrorMessage(alias: string, cmd: string, err: unknown): string {
  if (isNotFoundError(err)) {
    return `"${alias}": command "${cmd}" not found on PATH; install it or use an absolute path`;
  }
  // Verbatim syscall error with alias prefix
  const errMsg = err instanceof Error ? err.message : String(err);
  return `"${alias}": ${errMsg}`;
}
