/**
 * Workflow CLI command
 *
 * Usage:
 *   atomic workflow -n <name> -a <agent> <prompt>
 *   atomic workflow --list
 */

import { AGENT_CONFIG, type AgentKey } from "@/services/config/index.ts";
import { COLORS } from "@/theme/colors.ts";
import { isCommandInstalled, supportsColor, supportsTrueColor } from "@/services/system/detect.ts";
import { ensureTmuxInstalled, ensureBunInstalled } from "../../lib/spawn.ts";
import {
  isTmuxInstalled,
  discoverWorkflows,
  findWorkflow,
  executeWorkflow,
  WorkflowLoader,
  resetMuxBinaryCache,
} from "@/sdk/workflows/index.ts";
import type { AgentType, DiscoveredWorkflow } from "@/sdk/workflows/index.ts";

export async function workflowCommand(options: {
  name?: string;
  agent?: string;
  prompt?: string;
  list?: boolean;
}): Promise<number> {
  // List mode
  if (options.list) {
    const workflows = await discoverWorkflows(undefined, options.agent as AgentType | undefined);
    process.stdout.write(renderWorkflowList(workflows));
    return 0;
  }

  // Run mode — validate inputs
  if (!options.name) {
    console.error(`${COLORS.red}Error: Missing workflow name. Use -n <name>.${COLORS.reset}`);
    return 1;
  }

  if (!options.agent) {
    console.error(`${COLORS.red}Error: Missing agent. Use -a <agent>.${COLORS.reset}`);
    return 1;
  }

  const validAgents = Object.keys(AGENT_CONFIG);
  if (!validAgents.includes(options.agent)) {
    console.error(`${COLORS.red}Error: Unknown agent '${options.agent}'.${COLORS.reset}`);
    console.error(`Valid agents: ${validAgents.join(", ")}`);
    return 1;
  }

  const agent = options.agent as AgentKey;

  // Check agent CLI is installed
  if (!isCommandInstalled(AGENT_CONFIG[agent].cmd)) {
    console.error(`${COLORS.red}Error: '${AGENT_CONFIG[agent].cmd}' is not installed.${COLORS.reset}`);
    console.error(`Install it from: ${AGENT_CONFIG[agent].install_url}`);
    return 1;
  }

  // Ensure tmux/psmux is installed
  if (!isTmuxInstalled()) {
    console.log("Terminal multiplexer not found. Installing...");
    try {
      await ensureTmuxInstalled();
      resetMuxBinaryCache();
    } catch {
      // Installation attempt failed — fall through to check below
    }
    if (!isTmuxInstalled()) {
      const isWin = process.platform === "win32";
      console.error(`${COLORS.red}Error: ${isWin ? "psmux" : "tmux"} is not installed.${COLORS.reset}`);
      console.error(
        isWin
          ? "Install psmux: https://github.com/psmux/psmux#installation"
          : "Install tmux: https://github.com/tmux/tmux/wiki/Installing",
      );
      return 1;
    }
  }

  // Ensure bun is installed (required for workflow execution)
  if (!Bun.which("bun")) {
    console.log("Bun runtime not found. Installing...");
    try {
      await ensureBunInstalled();
    } catch {
      // Installation attempt failed — fall through to check below
    }
    if (!Bun.which("bun")) {
      console.error(`${COLORS.red}Error: bun is not installed.${COLORS.reset}`);
      console.error("Install bun: https://bun.sh");
      return 1;
    }
  }

  // Find the workflow
  const discovered = await findWorkflow(options.name, agent);

  if (!discovered) {
    console.error(`${COLORS.red}Error: Workflow '${options.name}' not found for agent '${agent}'.${COLORS.reset}`);
    console.error(`\nExpected location:`);
    console.error(`  .atomic/workflows/${options.name}/${agent}/index.ts  ${COLORS.dim}(local)${COLORS.reset}`);
    console.error(`  ~/.atomic/workflows/${options.name}/${agent}/index.ts ${COLORS.dim}(global)${COLORS.reset}`);

    const available = await discoverWorkflows(undefined, agent);
    if (available.length > 0) {
      console.error(`\nAvailable ${agent} workflows:`);
      for (const wf of available) {
        console.error(`  ${COLORS.dim}•${COLORS.reset} ${wf.name} ${COLORS.dim}(${wf.source})${COLORS.reset}`);
      }
    }

    return 1;
  }

  // Load workflow through the pipeline: resolve → validate → load.
  // External workflows must have `@bastani/atomic` installed as a dependency.
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

  if (!result.ok) {
    return 1;
  }

  // Execute
  try {
    await executeWorkflow({
      definition: result.value.definition,
      agent,
      prompt: options.prompt ?? "",
      workflowFile: discovered.path,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${COLORS.red}Workflow failed: ${message}${COLORS.reset}`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Workflow list rendering
//
// Catppuccin Mocha palette rendered via 24-bit ANSI, with graceful fallback
// to basic ANSI on legacy terminals and plain text when colour is disabled.
// Hex values mirror src/sdk/runtime/theme.ts so the CLI output and the TUI
// speak one visual language.
// ---------------------------------------------------------------------------

type PaletteKey = "text" | "dim" | "accent" | "success" | "mauve";

const PALETTE: Record<PaletteKey, readonly [number, number, number]> = {
  text:    [205, 214, 244], // #cdd6f4 — primary text
  dim:     [127, 132, 156], // #7f849c — secondary text
  accent:  [137, 180, 250], // #89b4fa — blue accent
  success: [166, 227, 161], // #a6e3a1 — green (local source)
  mauve:   [203, 166, 247], // #cba6f7 — mauve (global source)
};

interface PaintOptions {
  bold?: boolean;
}

type Paint = (key: PaletteKey, text: string, opts?: PaintOptions) => string;

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
/** Section heading colour per source — preserves the source-type semantic. */
const SOURCE_COLORS: Record<DiscoveredWorkflow["source"], PaletteKey> = {
  local: "success",
  global: "mauve",
  builtin: "accent",
};

/**
 * Build a colour-aware painter for the current terminal.
 * Truecolor terminals get the full Catppuccin palette; legacy terminals
 * degrade to basic ANSI; NO_COLOR emits plain text. The optional `bold`
 * flag adds weight contrast — essential for typographic hierarchy in a
 * monospace medium where size and family are fixed.
 */
function createPainter(): Paint {
  if (supportsTrueColor()) {
    return (key, text, opts) => {
      const [r, g, b] = PALETTE[key];
      const sgr = opts?.bold
        ? `\x1b[1;38;2;${r};${g};${b}m`
        : `\x1b[38;2;${r};${g};${b}m`;
      return `${sgr}${text}\x1b[0m`;
    };
  }
  if (supportsColor()) {
    const ANSI: Record<PaletteKey, string> = {
      text:    "",
      dim:     "\x1b[2m",
      accent:  "\x1b[34m",
      success: "\x1b[32m",
      mauve:   "\x1b[35m",
    };
    return (key, text, opts) => {
      const weight = opts?.bold ? "\x1b[1m" : "";
      return `${weight}${ANSI[key]}${text}\x1b[0m`;
    };
  }
  return (_key, text) => text;
}

/**
 * Render `atomic workflow --list` output as a printable string.
 *
 * Three-level hierarchy: source → provider → workflow name.
 *
 * Layout:
 *   N workflows
 *
 *
 *   local (.atomic/workflows)
 *
 *     Claude
 *
 *       <name>
 *       <name>
 *
 *     OpenCode
 *
 *       <name>
 *
 *
 *   global (~/.atomic/workflows)
 *
 *     Claude
 *
 *       <name>
 *
 *
 *   run: atomic workflow -n <name> -a <agent>
 */
function renderWorkflowList(workflows: DiscoveredWorkflow[]): string {
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
  //   2 blanks before each source heading  (major break)
  //   1 blank before each provider heading (tight, they're nested)
  //   1 blank before each provider's entries
  for (const source of SOURCE_ORDER) {
    const byAgent = bySource.get(source);
    if (!byAgent || byAgent.size === 0) continue;

    // Major break before the source section.
    lines.push("");
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
      lines.push("");

      for (const name of names) {
        lines.push("      " + paint("text", name));
      }
    }
  }

  // Footer — dim run hint, separated by the same major-break rhythm.
  lines.push("");
  lines.push("");
  lines.push(
    "  " + paint("dim", "run: atomic workflow -n <name> -a <agent>"),
  );
  lines.push("");

  return lines.join("\n") + "\n";
}
