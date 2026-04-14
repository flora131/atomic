/**
 * Workflow CLI command
 *
 * Usage:
 *   atomic workflow -a <agent>                     interactive picker
 *   atomic workflow -n <name> -a <agent> <prompt>  free-form workflow
 *   atomic workflow -n <name> -a <agent> --<field>=<value> ...
 *                                                  structured-input workflow
 *   atomic workflow list [-a <agent>]              list discoverable workflows
 */

import { AGENT_CONFIG, type AgentKey } from "../../services/config/index.ts";
import { COLORS, createPainter, type PaletteKey } from "../../theme/colors.ts";
import { isCommandInstalled } from "../../services/system/detect.ts";
import { ensureTmuxInstalled, ensureBunInstalled } from "../../lib/spawn.ts";
import {
  isTmuxInstalled,
  discoverWorkflows,
  findWorkflow,
  loadWorkflowsMetadata,
  executeWorkflow,
  WorkflowLoader,
  resetMuxBinaryCache,
} from "../../sdk/workflows/index.ts";
import type {
  AgentType,
  DiscoveredWorkflow,
  WorkflowInput,
  WorkflowWithMetadata,
} from "../../sdk/workflows/index.ts";
import { WorkflowPickerPanel } from "../../sdk/components/workflow-picker-panel.tsx";

// ─── Flag parser ────────────────────────────────────────────────────────────

/**
 * Split commander's passthrough arg list into structured input flags and
 * positional tokens (the latter get joined to form the free-form prompt).
 *
 * Accepts both `--name=value` and `--name value` forms, mirroring the
 * conventions users already know from native agent CLIs. Flags whose
 * values parse-fail (e.g. a trailing `--foo` with nothing after it) are
 * returned as errors so the caller can print a clear usage hint rather
 * than swallowing the mistake.
 *
 * Short flags (`-x value`) are treated as unknown and left in the
 * positional bucket — we only recognise long-form `--<name>` flags as
 * structured inputs.
 */
export function parsePassthroughArgs(args: string[]): {
  flags: Record<string, string>;
  positional: string[];
  errors: string[];
} {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const tok = args[i]!;
    if (tok.startsWith("--")) {
      const body = tok.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        const name = body.slice(0, eq);
        const value = body.slice(eq + 1);
        if (name === "") {
          errors.push(`Malformed flag "${tok}" — expected --<name>=<value>.`);
          continue;
        }
        flags[name] = value;
      } else {
        const next = args[i + 1];
        if (next === undefined || next.startsWith("-")) {
          errors.push(
            `Missing value for --${body}. Use --${body}=<value> or --${body} <value>.`,
          );
          continue;
        }
        flags[body] = next;
        i++;
      }
    } else {
      positional.push(tok);
    }
  }

  return { flags, positional, errors };
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a set of CLI-provided input values against a workflow's
 * declared schema. Returns a list of human-readable error strings — the
 * caller should print each on its own line and exit non-zero if any are
 * returned.
 */
export function validateInputsAgainstSchema(
  inputs: Record<string, string>,
  schema: readonly WorkflowInput[],
): string[] {
  const errors: string[] = [];
  const known = new Set(schema.map((i) => i.name));

  for (const field of schema) {
    const raw = inputs[field.name];
    const value =
      raw === undefined || raw === ""
        ? field.default ?? (field.type === "enum" ? field.values?.[0] ?? "" : "")
        : raw;

    if (field.required) {
      if (field.type === "enum") {
        if (value === "") {
          errors.push(
            `Missing required input --${field.name} (expected one of: ${(field.values ?? []).join(", ")}).`,
          );
        }
      } else if (value.trim() === "") {
        errors.push(`Missing required input --${field.name}.`);
      }
    }

    if (field.type === "enum" && value !== "") {
      const allowed = field.values ?? [];
      if (!allowed.includes(value)) {
        errors.push(
          `Invalid value for --${field.name}: "${value}". ` +
            `Expected one of: ${allowed.join(", ")}.`,
        );
      }
    }
  }

  for (const name of Object.keys(inputs)) {
    if (!known.has(name)) {
      errors.push(
        `Unknown input --${name}. ` +
          `Valid inputs: ${schema.length > 0 ? schema.map((i) => `--${i.name}`).join(", ") : "(none — this workflow takes a free-form prompt)"}.`,
      );
    }
  }

  return errors;
}

/**
 * Merge CLI-provided values with schema defaults so the executor sees a
 * fully-resolved inputs record. Defaults for enum fields fall back to the
 * first declared value when no explicit default is set. Unknown keys are
 * dropped — validation has already flagged them.
 */
export function resolveInputs(
  provided: Record<string, string>,
  schema: readonly WorkflowInput[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of schema) {
    const raw = provided[field.name];
    if (raw !== undefined && raw !== "") {
      out[field.name] = raw;
    } else if (field.default !== undefined) {
      out[field.name] = field.default;
    } else if (field.type === "enum" && field.values && field.values.length > 0) {
      out[field.name] = field.values[0]!;
    }
  }
  return out;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export async function workflowCommand(options: {
  name?: string;
  agent?: string;
  list?: boolean;
  /**
   * Everything commander parked in `cmd.args` — a mix of positional
   * prompt tokens and unknown `--<name>` flags that the
   * {@link parsePassthroughArgs} helper splits apart.
   */
  passthroughArgs?: string[];
  /**
   * Project root used for workflow discovery. Defaults to
   * `process.cwd()` in production; tests inject a temp dir so they
   * can control which workflows are visible without touching the
   * real filesystem.
   */
  cwd?: string;
}): Promise<number> {
  const passthroughArgs = options.passthroughArgs ?? [];
  const cwd = options.cwd;

  // ── List mode ──
  // `merge: false` keeps local and global entries independent so the
  // list can show both copies of a non-reserved name when they coexist
  // on disk. Reserved builtin names are already filtered out of both
  // merge modes inside `discoverWorkflows`, so shadowed local/global
  // workflows never reach the renderer.
  if (options.list) {
    const discovered = await discoverWorkflows(
      cwd,
      options.agent as AgentType | undefined,
      { merge: false },
    );
    // Filter out workflows that fail to load (type errors, missing
    // .compile(), etc.) so the list only shows workflows ready to run.
    const workflows = await loadWorkflowsMetadata(discovered);
    process.stdout.write(renderWorkflowList(workflows));
    return 0;
  }

  // ── Agent validation (required for every non-list branch) ──
  if (!options.agent) {
    console.error(
      `${COLORS.red}Error: Missing agent. Use -a <agent>.${COLORS.reset}`,
    );
    return 1;
  }

  const validAgents = Object.keys(AGENT_CONFIG);
  if (!validAgents.includes(options.agent)) {
    console.error(
      `${COLORS.red}Error: Unknown agent '${options.agent}'.${COLORS.reset}`,
    );
    console.error(`Valid agents: ${validAgents.join(", ")}`);
    return 1;
  }
  const agent = options.agent as AgentKey;

  // ── Preflight checks (shared between picker and named modes) ──
  const preflightCode = await runPrereqChecks(agent);
  if (preflightCode !== 0) return preflightCode;

  // ── Picker mode: -a <agent>, no -n ──
  if (!options.name) {
    return runPickerMode(agent, passthroughArgs, cwd);
  }

  // ── Named mode: -n <name> -a <agent> [args...] ──
  return runNamedMode(options.name, agent, passthroughArgs, cwd);
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Verify that the agent CLI, tmux (or psmux on Windows), and bun are all
 * installed. Attempts best-effort installs for the latter two and
 * returns a non-zero exit code if any check still fails afterwards.
 */
async function runPrereqChecks(agent: AgentKey): Promise<number> {
  if (!isCommandInstalled(AGENT_CONFIG[agent].cmd)) {
    console.error(
      `${COLORS.red}Error: '${AGENT_CONFIG[agent].cmd}' is not installed.${COLORS.reset}`,
    );
    console.error(`Install it from: ${AGENT_CONFIG[agent].install_url}`);
    return 1;
  }

  if (!isTmuxInstalled()) {
    console.log("Terminal multiplexer not found. Installing...");
    try {
      await ensureTmuxInstalled();
      resetMuxBinaryCache();
    } catch {
      // Fall through to the check below — best effort.
    }
    if (!isTmuxInstalled()) {
      const isWin = process.platform === "win32";
      console.error(
        `${COLORS.red}Error: ${isWin ? "psmux" : "tmux"} is not installed.${COLORS.reset}`,
      );
      console.error(
        isWin
          ? "Install psmux: https://github.com/psmux/psmux#installation"
          : "Install tmux: https://github.com/tmux/tmux/wiki/Installing",
      );
      return 1;
    }
  }

  if (!Bun.which("bun")) {
    console.log("Bun runtime not found. Installing...");
    try {
      await ensureBunInstalled();
    } catch {
      // Best effort — fall through to the check below.
    }
    if (!Bun.which("bun")) {
      console.error(
        `${COLORS.red}Error: bun is not installed.${COLORS.reset}`,
      );
      console.error("Install bun: https://bun.sh");
      return 1;
    }
  }

  return 0;
}

/**
 * Run the given workflow definition through the executor, catching any
 * execution errors so the CLI can exit with a non-zero code instead of
 * letting an unhandled promise rejection bubble to `main()`.
 *
 * Free-form workflows ride the same `inputs` pipe — their positional
 * prompt is stored under `inputs.prompt`, so workflow authors read it
 * via `ctx.inputs.prompt ?? ""` whether or not the workflow declares
 * a schema.
 */
async function runLoadedWorkflow(args: {
  definition: Parameters<typeof executeWorkflow>[0]["definition"];
  agent: AgentKey;
  inputs: Record<string, string>;
  workflowFile: string;
}): Promise<number> {
  try {
    await executeWorkflow({
      definition: args.definition,
      agent: args.agent,
      inputs: args.inputs,
      workflowFile: args.workflowFile,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${COLORS.red}Workflow failed: ${message}${COLORS.reset}`);
    return 1;
  }
}

// ─── Picker mode ────────────────────────────────────────────────────────────

/**
 * Show the interactive picker, then hand off to the executor if the
 * user confirms a selection. Passthrough args are rejected here — the
 * picker already surfaces the same UI for typing values, so letting CLI
 * flags leak through would create two conflicting sources of truth.
 */
async function runPickerMode(
  agent: AgentKey,
  passthroughArgs: string[],
  cwd: string | undefined,
): Promise<number> {
  if (passthroughArgs.length > 0) {
    console.error(
      `${COLORS.red}Error: unexpected arguments for the interactive picker: ${passthroughArgs.join(" ")}${COLORS.reset}`,
    );
    console.error(
      `Pass workflow-specific flags only alongside -n <name>, or remove them to launch the picker.`,
    );
    return 1;
  }

  const discovered = await discoverWorkflows(cwd, agent);
  if (discovered.length === 0) {
    console.error(
      `${COLORS.red}No workflows found for agent '${agent}'.${COLORS.reset}`,
    );
    console.error(
      `Create one at: .atomic/workflows/<name>/${agent}/index.ts`,
    );
    return 1;
  }

  const metadata = await loadWorkflowsMetadata(discovered);
  if (metadata.length === 0) {
    console.error(
      `${COLORS.red}All discovered workflows failed to load. Check the files under .atomic/workflows/ and ~/.atomic/workflows/.${COLORS.reset}`,
    );
    return 1;
  }

  // Stable sort so the picker list order is deterministic.
  metadata.sort((a, b) => a.name.localeCompare(b.name));

  const panel = await WorkflowPickerPanel.create({ agent, workflows: metadata });
  let result;
  try {
    result = await panel.waitForSelection();
  } finally {
    panel.destroy();
  }

  if (!result) {
    return 0;
  }

  return runResolvedSelection(result.workflow, agent, result.inputs);
}

/**
 * Execute a workflow selected via the picker. The picker already stores
 * free-form prompts under the canonical `prompt` key,
 * so we can hand the inputs record straight through — no split between
 * "prompt" and "structured inputs" is needed.
 */
async function runResolvedSelection(
  workflow: WorkflowWithMetadata,
  agent: AgentKey,
  inputs: Record<string, string>,
): Promise<number> {
  const loaded = await WorkflowLoader.loadWorkflow(workflow, {
    warn(warnings) {
      for (const w of warnings) {
        console.warn(`⚠ [${w.rule}] ${w.message}`);
      }
    },
    error(stage, _error, message) {
      console.error(`${COLORS.red}Error (${stage}): ${message}${COLORS.reset}`);
    },
  });
  if (!loaded.ok) return 1;

  return runLoadedWorkflow({
    definition: loaded.value.definition,
    agent,
    inputs,
    workflowFile: workflow.path,
  });
}

// ─── Named mode ─────────────────────────────────────────────────────────────

async function runNamedMode(
  name: string,
  agent: AgentKey,
  passthroughArgs: string[],
  cwd: string | undefined,
): Promise<number> {
  // Find the workflow
  const discovered = await findWorkflow(name, agent, cwd);

  if (!discovered) {
    console.error(
      `${COLORS.red}Error: Workflow '${name}' not found for agent '${agent}'.${COLORS.reset}`,
    );
    console.error(`\nExpected location:`);
    console.error(
      `  .atomic/workflows/${name}/${agent}/index.ts  ${COLORS.dim}(local)${COLORS.reset}`,
    );
    console.error(
      `  ~/.atomic/workflows/${name}/${agent}/index.ts ${COLORS.dim}(global)${COLORS.reset}`,
    );

    const available = await loadWorkflowsMetadata(
      await discoverWorkflows(cwd, agent),
    );
    if (available.length > 0) {
      console.error(`\nAvailable ${agent} workflows:`);
      for (const wf of available) {
        console.error(
          `  ${COLORS.dim}•${COLORS.reset} ${wf.name} ${COLORS.dim}(${wf.source})${COLORS.reset}`,
        );
      }
    }

    return 1;
  }

  // Load workflow so we can read the declared input schema before
  // trusting any passthrough values.
  const result = await WorkflowLoader.loadWorkflow(discovered, {
    warn(warnings) {
      for (const w of warnings) {
        console.warn(`⚠ [${w.rule}] ${w.message}`);
      }
    },
    error(stage, _error, message) {
      console.error(`${COLORS.red}Error (${stage}): ${message}${COLORS.reset}`);
    },
  });

  if (!result.ok) return 1;
  const definition = result.value.definition;

  // Parse passthrough args into typed flags + positional tokens. The
  // parser intentionally rejects only obviously-broken flags (e.g.
  // `--foo` with nothing after it) — unknown flag names are surfaced
  // later, in validateInputsAgainstSchema, so we can show the valid
  // flag list alongside the error.
  const { flags, positional, errors: parseErrors } =
    parsePassthroughArgs(passthroughArgs);
  if (parseErrors.length > 0) {
    for (const e of parseErrors) {
      console.error(`${COLORS.red}Error: ${e}${COLORS.reset}`);
    }
    return 1;
  }

  const isStructured = definition.inputs.length > 0;

  if (isStructured) {
    // Positional args are ambiguous for structured workflows — users
    // must go through `--<name>` flags so the executor has a typed
    // record to validate against.
    if (positional.length > 0) {
      console.error(
        `${COLORS.red}Error: workflow '${definition.name}' takes structured inputs — ` +
          `pass them as --<name>=<value> flags instead of a positional prompt.${COLORS.reset}`,
      );
      console.error(
        `Expected flags: ${definition.inputs.map((i) => `--${i.name}`).join(", ")}`,
      );
      return 1;
    }
    const validationErrors = validateInputsAgainstSchema(flags, definition.inputs);
    if (validationErrors.length > 0) {
      for (const e of validationErrors) {
        console.error(`${COLORS.red}Error: ${e}${COLORS.reset}`);
      }
      return 1;
    }
    const resolvedInputs = resolveInputs(flags, definition.inputs);
    return runLoadedWorkflow({
      definition,
      agent,
      inputs: resolvedInputs,
      workflowFile: discovered.path,
    });
  }

  // Free-form workflows: reject stray --<flag> flags outright, since
  // they have no schema to validate against.
  if (Object.keys(flags).length > 0) {
    console.error(
      `${COLORS.red}Error: workflow '${definition.name}' has no declared inputs — unknown flags: ${Object.keys(flags).map((n) => `--${n}`).join(", ")}.${COLORS.reset}`,
    );
    console.error(
      `Pass your request as a positional prompt: atomic workflow -n ${definition.name} -a ${agent} "your prompt"`,
    );
    return 1;
  }

  // Free-form workflows store their single prompt under the `prompt`
  // key so workflow authors can read `ctx.inputs.prompt` uniformly.
  // An empty positional list stays as an empty inputs record and
  // `ctx.inputs.prompt` stays undefined.
  const prompt = positional.join(" ");
  const inputs: Record<string, string> = prompt === "" ? {} : { prompt };
  return runLoadedWorkflow({
    definition,
    agent,
    inputs,
    workflowFile: discovered.path,
  });
}

/** Stable agent sort order; keeps output deterministic across runs. */
const AGENT_ORDER: readonly AgentType[] = ["claude", "opencode", "copilot"];
/** Display names shown as provider sub-headings; honours proper branding. */
const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  copilot: "Copilot CLI",
};
/** Local first — project-scoped workflows are the most immediately relevant. */
const SOURCE_ORDER: readonly DiscoveredWorkflow["source"][] = ["local", "global", "builtin"];
/** Friendly directory labels shown inline with each section heading. */
const SOURCE_DIRS: Record<DiscoveredWorkflow["source"], string> = {
  local: ".atomic/workflows",
  global: "~/.atomic/workflows",
  builtin: "built-in",
};
/** Section heading colour per source — three distinct hues so each
 *  source reads at a glance. `accent` (blue) is deliberately reserved
 *  for the agent-provider sub-headings nested inside each section, so
 *  builtin uses the new `info` (sky) key to avoid a clash. */
const SOURCE_COLORS: Record<DiscoveredWorkflow["source"], PaletteKey> = {
  local: "success", // green — project-scoped, "yours"
  global: "mauve",  // purple — user-scoped, personal
  builtin: "info",  // sky    — ships with atomic, foundational
};

/**
 * Render `atomic workflow --list` output as a printable string.
 *
 * Three-level hierarchy: source → provider → workflow name.
 *
 * Layout:
 *   N workflows
 *
 *   local (.atomic/workflows)
 *
 *     Claude
 *       <name>
 *       <name>
 *
 *     OpenCode
 *       <name>
 *
 *   global (~/.atomic/workflows)
 *
 *     Claude
 *       <name>
 *
 *   run: atomic workflow -n <name> -a <agent>
 *
 * Exported for testing — the pure-function shape makes coverage for the
 * renderer trivial without spinning up a full CLI invocation.
 */
export function renderWorkflowList(workflows: DiscoveredWorkflow[]): string {
  const paint = createPainter();
  const lines: string[] = [];

  // Empty state — teach the user where workflows live.
  if (workflows.length === 0) {
    lines.push("");
    lines.push("  " + paint("text", "no workflows found", { bold: true }));
    lines.push("");
    lines.push("  " + paint("dim", "create one at"));
    lines.push(
      "    " +
        paint("accent", ".atomic/workflows/<name>/<agent>/index.ts"),
    );
    lines.push("");
    return lines.join("\n") + "\n";
  }

  // Group by source → agent → sorted names. This gives the renderer O(1)
  // lookups at both nesting levels and keeps the output deterministic.
  type ByAgent = Map<AgentType, string[]>;
  const bySource = new Map<DiscoveredWorkflow["source"], ByAgent>();
  for (const wf of workflows) {
    let byAgent = bySource.get(wf.source);
    if (!byAgent) {
      byAgent = new Map();
      bySource.set(wf.source, byAgent);
    }
    const names = byAgent.get(wf.agent) ?? [];
    names.push(wf.name);
    byAgent.set(wf.agent, names);
  }
  for (const byAgent of bySource.values()) {
    for (const names of byAgent.values()) {
      names.sort((a, b) => a.localeCompare(b));
    }
  }

  // Top header — data-first: the count is bold (it's the actual info), the
  // noun trails in dim. Handles singular "1 workflow" gracefully.
  const count = workflows.length;
  const noun = count === 1 ? "workflow" : "workflows";
  lines.push("");
  lines.push(
    "  " + paint("text", String(count), { bold: true }) + " " + paint("dim", noun),
  );

  // One stanza per source section, with nested provider sub-groups inside.
  // Rhythm:
  //   1 blank before each source heading  (section break)
  //   1 blank before each provider heading (grouped with its entries)
  for (const source of SOURCE_ORDER) {
    const byAgent = bySource.get(source);
    if (!byAgent || byAgent.size === 0) continue;

    // Section break before the source section.
    lines.push("");

    // Source heading: bold semantic colour + dim inline directory hint.
    // `local (.atomic/workflows)` — label carries the weight, parens recede.
    lines.push(
      "  " +
        paint(SOURCE_COLORS[source], source, { bold: true }) +
        paint("dim", ` (${SOURCE_DIRS[source]})`),
    );

    for (const agent of AGENT_ORDER) {
      const names = byAgent.get(agent);
      if (!names || names.length === 0) continue;

      // Provider heading: bold accent blue — a clearly different layer from
      // both the semantic source heading above and the neutral entries below.
      lines.push("");
      lines.push(
        "    " + paint("accent", AGENT_DISPLAY_NAMES[agent], { bold: true }),
      );

      for (const name of names) {
        lines.push("      " + paint("text", name));
      }
    }
  }

  // Footer — dim run hint, separated by a section break.
  lines.push("");
  lines.push(
    "  " + paint("dim", "run: atomic workflow -n <name> -a <agent>"),
  );
  lines.push("");

  return lines.join("\n") + "\n";
}
