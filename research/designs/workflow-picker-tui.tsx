/** @jsxImportSource @opentui/react */
/**
 * Atomic — Workflow Picker TUI
 *
 * OpenTUI React prototype of the interactive picker that appears when
 * `atomic workflow -a <agent>` is invoked without a workflow name. The
 * picker is strictly agent-scoped: the backend comes from the `-a`
 * flag at launch and cannot be changed from within the UI, matching
 * how `atomic chat -a <agent>` behaves. Demonstrates:
 *
 *   1. Telescope-style fuzzy picker — type to filter, arrows to navigate,
 *      subsequence matching against both name and description
 *   2. Structured argument preview — each workflow's input schema is
 *      rendered as a form in the right pane; freeform workflows fall
 *      back to a single `prompt` field
 *   3. Two-phase flow with a confirm modal — PICK → PROMPT, with a
 *      locked-in workflow chip once the user commits to a selection and
 *      a centered "ready to run" modal overlay on ⌃s that shows the
 *      fully-composed shell invocation before submission.
 *
 * The confirm modal prints the equivalent shell invocation, so the
 * picker teaches the CLI flags as a side effect of using it.
 *
 * Run:   bun run research/designs/workflow-picker-tui.tsx -a <agent>
 *        (default agent is "copilot" if -a is omitted)
 * Exit:  esc (in pick phase) · ctrl-c (anywhere)
 *
 * Design: Catppuccin Mocha · rounded borders · Neovim-style statusline
 */

import { createCliRenderer } from "@opentui/core";
import {
  createRoot,
  useKeyboard,
  useRenderer,
} from "@opentui/react";
import { useState, useEffect, useMemo } from "react";

// ─── Theme ──────────────────────────────────────

interface PickerTheme {
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  surface: string;
  text: string;
  textMuted: string;
  textDim: string;
  primary: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  mauve: string;
  border: string;
  borderActive: string;
}

// Background ladder — three shades below/around the base:
//   backgroundElement #11111b  — deepest, for RECESSED surfaces
//                                 (unfocused form fields, cursor hiding)
//   backgroundPanel   #181825  — subtly darker than base
//                                 (focused form field bg, locked-in chip)
//   background        #1e1e2e  — Catppuccin Base (main body)
//   surface           #313244  — Catppuccin Surface0, RAISED panel
//                                 (header bar, statusline bar; same as
//                                  the production orchestrator panel's
//                                  `theme.backgroundElement`)
const theme: PickerTheme = {
  background:        "#1e1e2e",
  backgroundPanel:   "#181825",
  backgroundElement: "#11111b",
  surface:           "#313244",
  text:              "#cdd6f4",
  textMuted:         "#a6adc8",
  textDim:           "#585b70",
  primary:           "#89b4fa", // blue   — primary UI
  success:           "#a6e3a1", // green  — local workflows, success state
  error:             "#f38ba8", // red    — errors
  warning:           "#f9e2af", // yellow — warnings
  info:              "#89dceb", // sky    — builtin workflows, informational
  mauve:             "#cba6f7", // purple — global workflows
  border:            "#313244",
  borderActive:      "#45475a",
};

// ─── Types ──────────────────────────────────────

type AgentType = "claude" | "copilot" | "opencode";
type Source = "local" | "global" | "builtin";
type Phase = "pick" | "prompt";

// Structured-input schema — the long-term shape of proposal #5, where
// `defineWorkflow` accepts an `inputs` object and the CLI materialises
// a field per input. Workflows that omit `inputs` fall back to the
// single free-form prompt field via DEFAULT_PROMPT_INPUT.
type FieldType = "text" | "string" | "enum";

interface WorkflowInput {
  name: string;
  type: FieldType;
  required?: boolean;
  description?: string;
  placeholder?: string;
  default?: string;
  values?: string[]; // enum only
}

interface Workflow {
  name: string;
  description: string;
  source: Source;
  agents: AgentType[];
  inputs?: WorkflowInput[];
}

// Fallback field used when a workflow has no structured input schema.
// Keeps the prompt phase renderer uniform — always a non-empty field list.
const DEFAULT_PROMPT_INPUT: WorkflowInput = {
  name: "prompt",
  type: "text",
  required: true,
  description: "what do you want this workflow to do?",
  placeholder: "describe your task…",
};

// ─── Mock Data ──────────────────────────────────
// In the real picker these come from discoverWorkflows() + a
// ~/.atomic/state.json file that tracks last-used per workflow.

const WORKFLOWS: Workflow[] = [
  {
    name: "deep-research-codebase",
    description:
      "Deterministic deep codebase research: scout → LOC-driven parallel explorers → aggregator.",
    source: "local",
    agents: ["copilot"],
  },
  {
    name: "generate-spec",
    description:
      "Convert research docs into detailed execution specs with file paths and test plans.",
    source: "local",
    agents: ["claude", "copilot"],
    inputs: [
      {
        name: "research_doc",
        type: "string",
        required: true,
        description: "path to the research doc to convert",
        placeholder: "research/docs/2026-04-11-auth.md",
      },
      {
        name: "focus",
        type: "enum",
        required: true,
        description: "how aggressively to scope the spec",
        values: ["minimal", "standard", "exhaustive"],
        default: "standard",
      },
      {
        name: "notes",
        type: "text",
        description: "extra guidance for the spec writer (optional)",
        placeholder: "anything the research doc doesn't already cover…",
      },
    ],
  },
  {
    name: "refactor-planner",
    description:
      "Plan multi-file refactors with cross-module impact analysis and rollback guidance.",
    source: "local",
    agents: ["claude"],
    inputs: [
      {
        name: "target_dir",
        type: "string",
        required: true,
        description: "directory rooted in the repo to analyse",
        placeholder: "src/middleware/auth",
      },
      {
        name: "goal",
        type: "text",
        required: true,
        description: "what the refactor should achieve",
        placeholder: "migrate legacy session tokens to HMAC scheme, preserving…",
      },
      {
        name: "strategy",
        type: "enum",
        required: true,
        description: "how to stage the rollout",
        values: ["incremental", "full-rewrite", "parallel"],
        default: "incremental",
      },
    ],
  },
  {
    name: "code-review",
    description:
      "Run a PR diff through every installed agent backend, then reconcile disagreements.",
    source: "global",
    agents: ["claude", "opencode", "copilot"],
    inputs: [
      {
        name: "pr_ref",
        type: "string",
        required: true,
        description: "PR number, branch, or git ref",
        placeholder: "anomalyco/atomic#580",
      },
      {
        name: "depth",
        type: "enum",
        required: true,
        description: "how deeply to analyse each hunk",
        values: ["quick", "thorough"],
        default: "thorough",
      },
    ],
  },
  {
    name: "doc-writer",
    description:
      "Generate or update API docs from source, preserving prior prose where still accurate.",
    source: "global",
    agents: ["claude", "opencode"],
  },
  {
    name: "hello-world",
    description: "Minimal two-stage demo workflow — useful for validating SDK setups.",
    source: "builtin",
    agents: ["claude", "opencode", "copilot"],
  },
];

// Agent install state — in the real picker this would be
// isCommandInstalled(AGENT_CONFIG[agent].cmd) per backend.
const INSTALLED_AGENTS: Record<AgentType, boolean> = {
  claude: true,
  copilot: true,
  opencode: false, // demo: shows a "not installed" agent gracefully
};

// Pinned agent for this session. In production this comes from the
// `atomic workflow -a <agent>` flag; in the demo we parse process.argv
// ourselves. The value is a module-level constant — the picker does
// not expose any in-UI way to change it, matching how
// `atomic chat -a <agent>` behaves.
const VALID_AGENTS: readonly AgentType[] = ["claude", "copilot", "opencode"];
const DEFAULT_AGENT: AgentType = "copilot";

function parseAgentFromArgv(): AgentType {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "-a" || flag === "--agent") {
      const val = args[i + 1];
      if (!val) {
        console.error(
          `Missing value for ${flag}. Usage: -a <${VALID_AGENTS.join("|")}>`,
        );
        process.exit(1);
      }
      if (!(VALID_AGENTS as readonly string[]).includes(val)) {
        console.error(
          `Unknown agent "${val}". Valid: ${VALID_AGENTS.join(", ")}`,
        );
        process.exit(1);
      }
      return val as AgentType;
    }
  }
  return DEFAULT_AGENT;
}

const CURRENT_AGENT: AgentType = parseAgentFromArgv();

// ─── Helpers ────────────────────────────────────

const SOURCE_DISPLAY: Record<Source, string> = {
  local: "local",
  global: "global",
  builtin: "builtin",
};

// Directory hint shown in parentheses next to each source label —
// matches the copy used by `atomic workflow -l` so users see the
// same wording in both surfaces.
const SOURCE_DIR: Record<Source, string> = {
  local: ".atomic/workflows",
  global: "~/.atomic/workflows",
  builtin: "built-in",
};

const SOURCE_COLOR: Record<Source, keyof PickerTheme> = {
  local: "success",
  global: "mauve",
  builtin: "info",
};

// Subsequence fuzzy match — Telescope-style. Returns a score (lower =
// better) or null for no match. Adjacent matches are rewarded; jumps over
// non-matching characters are penalized proportionally to the gap.
function fuzzyMatch(query: string, target: string): number | null {
  if (query === "") return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let ti = 0;
  let score = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === q[qi]) { found = ti; break; }
      ti++;
    }
    if (found === -1) return null;
    score += found === prev + 1 ? 1 : 4 + (found - prev);
    prev = found;
    ti++;
  }
  return score;
}

// ─── List Building ──────────────────────────────

interface ListEntry {
  workflow: Workflow;
  section: Source;
}

interface ListRow {
  kind: "section" | "entry";
  source?: Source; // present on section headers
  entry?: ListEntry;
}

function buildEntries(query: string, agent: AgentType): ListEntry[] {
  type Scored = { wf: Workflow; score: number };
  const scored: Scored[] = [];
  for (const wf of WORKFLOWS) {
    // Scope filter — the picker only shows workflows compatible with
    // the agent the user currently has selected in the sidebar.
    if (!wf.agents.includes(agent)) continue;

    // Match against both name (primary) and description (secondary, +2
    // penalty so name matches always win ties).
    const nameScore = fuzzyMatch(query, wf.name);
    const descScore = fuzzyMatch(query, wf.description);
    const best =
      nameScore !== null && descScore !== null
        ? Math.min(nameScore, descScore + 2)
        : nameScore !== null
        ? nameScore
        : descScore !== null
        ? descScore + 2
        : null;
    if (best !== null) scored.push({ wf, score: best });
  }

  // Empty query: grouped by source. Non-empty query: flat score-sorted.
  if (query === "") {
    const rest: ListEntry[] = [];
    for (const source of ["local", "global", "builtin"] as Source[]) {
      const group = scored
        .filter((s) => s.wf.source === source)
        .sort((a, b) => a.wf.name.localeCompare(b.wf.name));
      for (const s of group) rest.push({ workflow: s.wf, section: source });
    }
    return rest;
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.map<ListEntry>((s) => ({ workflow: s.wf, section: s.wf.source }));
}

function buildRows(entries: ListEntry[], query: string): ListRow[] {
  const rows: ListRow[] = [];
  if (query === "") {
    let lastSection: string | null = null;
    for (const e of entries) {
      if (e.section !== lastSection) {
        rows.push({ kind: "section", source: e.section });
        lastSection = e.section;
      }
      rows.push({ kind: "entry", entry: e });
    }
  } else {
    for (const e of entries) rows.push({ kind: "entry", entry: e });
  }
  return rows;
}

// ─── Components ─────────────────────────────────

// Section header with a leading mauve indicator bar. The colored glyph
// gives ALL-CAPS labels real weight against the preview body so they
// don't blend into the surrounding dim text.
function SectionLabel({ label }: { label: string }) {
  return (
    <box height={1} flexDirection="row">
      <text>
        <span fg={theme.mauve}>▎ </span>
        <span fg={theme.textMuted}><strong>{label}</strong></span>
      </text>
    </box>
  );
}


function FilterBar({
  query,
  count,
  cursorOn,
}: {
  query: string;
  count: number;
  cursorOn: boolean;
}) {
  return (
    <box
      height={3}
      border
      borderStyle="rounded"
      borderColor={theme.borderActive}
      backgroundColor={theme.backgroundPanel}
      flexDirection="row"
      paddingLeft={2}
      paddingRight={2}
      alignItems="center"
    >
      <text><span fg={theme.primary}><strong>❯ </strong></span></text>
      <text>
        <span fg={theme.text}>{query}</span>
        <span fg={cursorOn ? theme.text : theme.backgroundPanel}>▋</span>
      </text>
      <box flexGrow={1} />
      <text>
        <span fg={theme.text}>{count}</span>
        <span fg={theme.textDim}> {count === 1 ? "match" : "matches"}</span>
      </text>
    </box>
  );
}

function WorkflowList({
  rows,
  focusedEntryIdx,
}: {
  rows: ListRow[];
  focusedEntryIdx: number;
}) {
  if (rows.length === 0) {
    return (
      <box paddingLeft={2} paddingTop={2}>
        <text><span fg={theme.textDim}>no matches</span></text>
      </box>
    );
  }

  let entryCounter = -1;
  return (
    <box flexDirection="column">
      {rows.map((row, i) => {
        if (row.kind === "section") {
          const src = row.source!;
          return (
            <box
              key={`s${i}`}
              height={2}
              paddingTop={1}
              paddingLeft={2}
            >
              <text>
                <span fg={theme[SOURCE_COLOR[src]]}>
                  {SOURCE_DISPLAY[src]}
                </span>
                <span fg={theme.textDim}>
                  {" (" + SOURCE_DIR[src] + ")"}
                </span>
              </text>
            </box>
          );
        }
        entryCounter++;
        const isFocused = entryCounter === focusedEntryIdx;
        const wf = row.entry!.workflow;

        return (
          <box
            key={`e${i}`}
            height={1}
            flexDirection="row"
            backgroundColor={isFocused ? theme.border : "transparent"}
            paddingLeft={1}
            paddingRight={2}
          >
            <text>
              <span fg={isFocused ? theme.primary : theme.textDim}>
                {isFocused ? "▸ " : "  "}
              </span>
              <span fg={isFocused ? theme.text : theme.textMuted}>
                {wf.name}
              </span>
            </text>
          </box>
        );
      })}
    </box>
  );
}

// A single argument shown in the preview pane. Three-row layout:
//
//   Row 1 — name (left) | type · required|optional (right)
//   Row 2 — description (muted)
//   Row 3 — enum values list (only for `type: "enum"`)
//
// `required` flips the right-hand tag between warning-yellow ("required")
// and textDim ("optional") so the eye can scan down a form and find the
// mandatory fields immediately.
function ArgumentRow({ field }: { field: WorkflowInput }) {
  const isRequired = field.required ?? false;
  const tagCol = isRequired ? theme.warning : theme.textDim;
  const tagLabel = isRequired ? "required" : "optional";
  const showEnumValues =
    field.type === "enum" && field.values && field.values.length > 0;

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2}>
      {/* Row 1: name + type · required */}
      <box flexDirection="row" height={1}>
        <text>
          <span fg={theme.text}>{field.name}</span>
        </text>
        <box flexGrow={1} />
        <text>
          <span fg={theme.textDim}>{field.type}</span>
          <span fg={theme.textDim}>{"  ·  "}</span>
          <span fg={tagCol}>{tagLabel}</span>
        </text>
      </box>

      {/* Row 2: description */}
      {field.description ? (
        <box height={1}>
          <text><span fg={theme.textMuted}>{field.description}</span></text>
        </box>
      ) : null}

      {/* Row 3: enum values, joined with mid-dots */}
      {showEnumValues ? (
        <box height={1}>
          <text>
            <span fg={theme.textDim}>{field.values!.join("  ·  ")}</span>
          </text>
        </box>
      ) : null}

      {/* Gap between args */}
      <box height={1} />
    </box>
  );
}

function Preview({ wf }: { wf: Workflow }) {
  // Every workflow has at least one argument to show. Structured
  // workflows use their declared inputs; everything else falls back to
  // DEFAULT_PROMPT_INPUT so users still see a clear "prompt — text —
  // required" row.
  const args: WorkflowInput[] =
    wf.inputs && wf.inputs.length > 0 ? wf.inputs : [DEFAULT_PROMPT_INPUT];

  return (
    <box
      flexDirection="column"
      paddingLeft={3}
      paddingRight={3}
      paddingTop={1}
    >
      {/* Name */}
      <text>
        <span fg={theme.text}><strong>{wf.name}</strong></span>
      </text>

      <box height={1} />

      {/* Source — matches the `atomic workflow -l` label + dim dir hint */}
      <text>
        <span fg={theme[SOURCE_COLOR[wf.source]]}>
          {SOURCE_DISPLAY[wf.source]}
        </span>
        <span fg={theme.textDim}>
          {" (" + SOURCE_DIR[wf.source] + ")"}
        </span>
      </text>

      <box height={2} />

      {/* Description */}
      <text><span fg={theme.textMuted}>{wf.description}</span></text>

      <box height={2} />

      {/* ARGUMENTS — the mauve ▎ indicator bar gives the section label
          real weight against the preview body. */}
      <SectionLabel label="ARGUMENTS" />
      <box height={1} />
      {args.map((f) => (
        <ArgumentRow key={f.name} field={f} />
      ))}
    </box>
  );
}

function EmptyPreview({ query }: { query: string }) {
  return (
    <box
      flexDirection="column"
      paddingLeft={3}
      paddingRight={3}
      paddingTop={3}
    >
      <text>
        <span fg={theme.textMuted}>No workflows match </span>
        <span fg={theme.text}>"{query}"</span>
      </text>
      <box height={2} />
      <text><span fg={theme.textDim}>Press backspace to widen your search, or</span></text>
      <box height={2} />
      <text><span fg={theme.textDim}>create a new one at</span></text>
      <box height={1} />
      <box paddingLeft={2}>
        <text><span fg={theme.primary}>.atomic/workflows/&lt;name&gt;/&lt;agent&gt;/index.ts</span></text>
      </box>
    </box>
  );
}

// ─── Field renderers ────────────────────────────
// One per FieldType. Each takes a `focused` flag so the input chrome
// (border, cursor, placeholder) adapts to which field is being edited.

const TEXT_FIELD_LINES = 3;

// When a focused field is empty, we want the cursor to sit *on* the
// first character of the placeholder — so typing replaces the
// placeholder starting at the insertion point, not after it. This
// renders the first char of the placeholder (or a space if the
// placeholder itself is empty) with inverted fg/bg while the cursor
// is blinking on, and as plain dim text while it's off — producing
// a block-cursor effect that matches huh/noice/readline conventions.
function PlaceholderWithCursor({
  placeholder,
  cursorShown,
  bgCol,
}: {
  placeholder: string;
  cursorShown: boolean;
  bgCol: string;
}) {
  // Graceful fallback so the cursor still renders when a field has
  // no placeholder text defined at all.
  const effective = placeholder.length > 0 ? placeholder : " ";
  const first = effective.slice(0, 1);
  const rest = effective.slice(1);

  return (
    <text>
      <span
        fg={cursorShown ? theme.surface : theme.textDim}
        bg={cursorShown ? theme.primary : bgCol}
      >
        {first}
      </span>
      <span fg={theme.textDim}>{rest}</span>
    </text>
  );
}

function TextAreaContent({
  value,
  placeholder,
  focused,
  cursorOn,
  lines,
  bgCol,
}: {
  value: string;
  placeholder: string;
  focused: boolean;
  cursorOn: boolean;
  lines: number;
  bgCol: string;
}) {
  const textLines = value.split("\n");
  // Scroll with content so the cursor line stays visible even when the
  // user has typed more than `lines` rows.
  const start = Math.max(0, textLines.length - lines);
  const visible: string[] = [];
  for (let i = 0; i < lines; i++) {
    visible.push(textLines[start + i] ?? "");
  }
  const cursorLine = Math.min(lines - 1, textLines.length - 1 - start);
  const isEmpty = value === "";
  const cursorShown = focused && cursorOn;

  return (
    <box flexDirection="column">
      {visible.map((line, i) => {
        // Empty + first line: placeholder with the cursor overlapping
        // its first character (the insertion point).
        if (isEmpty && i === 0) {
          return (
            <box key={i} height={1}>
              <PlaceholderWithCursor
                placeholder={placeholder}
                cursorShown={cursorShown}
                bgCol={bgCol}
              />
            </box>
          );
        }
        // Non-empty line: text + trailing cursor on the cursor line.
        const showCursorHere = cursorShown && !isEmpty && i === cursorLine;
        return (
          <box key={i} height={1}>
            <text>
              <span fg={theme.text}>{line}</span>
              <span fg={showCursorHere ? theme.primary : bgCol}>▋</span>
            </text>
          </box>
        );
      })}
    </box>
  );
}

function StringContent({
  value,
  placeholder,
  focused,
  cursorOn,
  bgCol,
}: {
  value: string;
  placeholder: string;
  focused: boolean;
  cursorOn: boolean;
  bgCol: string;
}) {
  const isEmpty = value === "";
  const cursorShown = focused && cursorOn;

  // Empty: cursor overlaps first char of placeholder at the
  // insertion point — so the first keystroke replaces the
  // placeholder instead of pushing a cursor past it.
  if (isEmpty) {
    return (
      <box height={1} flexDirection="row">
        <PlaceholderWithCursor
          placeholder={placeholder}
          cursorShown={cursorShown}
          bgCol={bgCol}
        />
      </box>
    );
  }

  // Non-empty: standard line-input layout with cursor after the value.
  return (
    <box height={1} flexDirection="row">
      <text>
        <span fg={theme.text}>{value}</span>
        <span fg={cursorShown ? theme.primary : bgCol}>▋</span>
      </text>
    </box>
  );
}

function EnumContent({
  values,
  selected,
  focused,
}: {
  values: string[];
  selected: string;
  focused: boolean;
}) {
  return (
    <box height={1} flexDirection="row">
      {values.map((v, i) => {
        const isSelected = v === selected;
        const marker = isSelected ? "●" : "○";
        const markerColor = isSelected
          ? focused ? theme.primary : theme.success
          : theme.textDim;
        const textColor = isSelected
          ? focused ? theme.text : theme.textMuted
          : theme.textDim;
        return (
          <box
            key={v}
            flexDirection="row"
            paddingLeft={i > 0 ? 3 : 0}
            height={1}
          >
            <text>
              <span fg={markerColor}>{marker} </span>
              <span fg={textColor}>{v}</span>
            </text>
          </box>
        );
      })}
    </box>
  );
}

function Field({
  field,
  value,
  focused,
  cursorOn,
}: {
  field: WorkflowInput;
  value: string;
  focused: boolean;
  cursorOn: boolean;
}) {
  // Focused fields light up with the primary accent and a slightly
  // warmer panel background — an unambiguous "edit me" signal.
  const borderCol = focused ? theme.primary : theme.border;
  const bgCol = focused ? theme.backgroundPanel : theme.backgroundElement;

  // Fixed row heights per type — string/enum are single-row, text is
  // multi-row so paragraphs have room to breathe.
  const boxHeight = field.type === "text" ? TEXT_FIELD_LINES + 2 : 3;

  // Caption: type · required|optional · description — dim, single line,
  // sits directly under the field so the form scans cleanly top-to-bottom.
  const tagCol = field.required ? theme.warning : theme.textDim;
  const tagLabel = field.required ? "required" : "optional";
  const captionDesc = field.description ? "  ·  " + field.description : "";

  return (
    <box flexDirection="column">
      <box
        border
        borderStyle="rounded"
        borderColor={borderCol}
        backgroundColor={bgCol}
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        height={boxHeight}
        justifyContent={field.type === "text" ? "flex-start" : "center"}
        title={` ${field.name} `}
        titleAlignment="left"
      >
        {field.type === "text" ? (
          <TextAreaContent
            value={value}
            placeholder={field.placeholder ?? ""}
            focused={focused}
            cursorOn={cursorOn}
            lines={TEXT_FIELD_LINES}
            bgCol={bgCol}
          />
        ) : field.type === "string" ? (
          <StringContent
            value={value}
            placeholder={field.placeholder ?? ""}
            focused={focused}
            cursorOn={cursorOn}
            bgCol={bgCol}
          />
        ) : field.type === "enum" ? (
          <EnumContent
            values={field.values ?? []}
            selected={value}
            focused={focused}
          />
        ) : null}
      </box>

      {/* Caption row directly under the box */}
      <box paddingLeft={2} paddingRight={2} height={1}>
        <text>
          <span fg={theme.textDim}>{field.type}</span>
          <span fg={theme.textDim}>{"  ·  "}</span>
          <span fg={tagCol}>{tagLabel}</span>
          <span fg={theme.textDim}>{captionDesc}</span>
        </text>
      </box>

      {/* Gap between fields */}
      <box height={1} />
    </box>
  );
}

function InputPhase({
  workflow,
  agent,
  fields,
  values,
  focusedFieldIdx,
  cursorOn,
}: {
  workflow: Workflow;
  agent: AgentType;
  fields: WorkflowInput[];
  values: Record<string, string>;
  focusedFieldIdx: number;
  cursorOn: boolean;
}) {
  const isStructured = workflow.inputs !== undefined && workflow.inputs.length > 0;

  return (
    <box
      flexDirection="column"
      paddingLeft={3}
      paddingRight={3}
      paddingTop={2}
      flexGrow={1}
    >
      {/* Locked-in workflow chip — the visual commitment to the selection */}
      <box
        border
        borderStyle="rounded"
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <text>
          <span fg={theme.primary}><strong>▸ </strong></span>
          <span fg={theme.text}><strong>{workflow.name}</strong></span>
          <span fg={theme.textDim}>{"  ·  "}</span>
          <span fg={theme.mauve}>{agent}</span>
          <span fg={theme.textDim}>{"  ·  "}</span>
          <span fg={theme[SOURCE_COLOR[workflow.source]]}>
            {SOURCE_DISPLAY[workflow.source]}
          </span>
          <span fg={theme.textDim}>
            {" (" + SOURCE_DIR[workflow.source] + ")"}
          </span>
        </text>
        <box height={1} />
        <text><span fg={theme.textMuted}>{workflow.description}</span></text>
      </box>

      <box height={2} />

      {/* Section label — shows a field count for structured forms, or
          just "prompt" for the free-form fallback. */}
      <box flexDirection="row" height={1}>
        <text>
          <span fg={theme.textDim}>
            <strong>{isStructured ? "INPUTS" : "PROMPT"}</strong>
          </span>
        </text>
        <box flexGrow={1} />
        <text>
          <span fg={theme.textDim}>
            {isStructured
              ? `${focusedFieldIdx + 1} / ${fields.length}`
              : ""}
          </span>
        </text>
      </box>
      <box height={1} />

      {/* One Field per input — for free-form workflows, there's a single
          text field bound to DEFAULT_PROMPT_INPUT. */}
      {fields.map((f, i) => (
        <Field
          key={f.name}
          field={f}
          value={values[f.name] ?? ""}
          focused={i === focusedFieldIdx}
          cursorOn={cursorOn}
        />
      ))}
    </box>
  );
}

// ConfirmModal — centered overlay shown when the user hits ⌃s in the
// prompt phase. Displays the fully-composed shell invocation so users
// can sanity-check the flags (and copy them out via terminal text
// selection) before committing.
//
// PRODUCTION INTEGRATION:
// In the real Atomic CLI, accepting this modal should:
//   1. Invoke the workflow runner with { workflow, agent, inputs:
//      fieldValues } — see src/commands/cli/workflow.ts for the entry
//      point that `atomic workflow <name> -a <agent> ...` already uses.
//   2. Tear down the picker renderer and hand control to the workflow's
//      live run view, the same surface `atomic workflow <name>` lands
//      on when flags are passed directly on the command line.
// Neither hook is wired up at the prototype layer — the demo just
// destroys the renderer on confirm, and the `// TODO(prod):` callsite
// below marks where the real trigger + navigation belongs.
function ConfirmModal({
  workflow,
  agent,
  fields,
  values,
}: {
  workflow: Workflow;
  agent: AgentType;
  fields: WorkflowInput[];
  values: Record<string, string>;
}) {
  const isStructured = workflow.inputs !== undefined && workflow.inputs.length > 0;

  // Shorten a single value for display on one line. Long text fields
  // get truncated with an ellipsis so the command preview stays readable.
  function shortVal(v: string): string {
    const trimmed = v.replace(/\n/g, " ").trim();
    if (trimmed.length > 48) return trimmed.slice(0, 45) + "…";
    return trimmed;
  }

  // Free-form fallback: pull the single prompt value from DEFAULT_PROMPT_INPUT.
  const promptText = values[DEFAULT_PROMPT_INPUT.name] ?? "";
  const promptShort = shortVal(promptText) || "your question…";

  return (
    // Full-screen absolute overlay container. No backdrop fill — the
    // InputPhase stays faintly visible around the card, giving the
    // modal a "floating panel over a still form" feel rather than a
    // hard page transition.
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      zIndex={100}
    >
      {/* The modal card — sized to content, centered both axes. */}
      <box
        border
        borderStyle="rounded"
        borderColor={theme.success}
        backgroundColor={theme.backgroundPanel}
        flexDirection="column"
        paddingLeft={3}
        paddingRight={3}
        paddingTop={1}
        paddingBottom={1}
        title=" ready to run "
        titleAlignment="center"
      >
        <text>
          <span fg={theme.success}><strong>✓ </strong></span>
          <span fg={theme.text}><strong>command composed</strong></span>
        </text>

        <box height={1} />

        <box paddingLeft={2} flexDirection="column">
          <text>
            <span fg={theme.textMuted}>atomic workflow </span>
            <span fg={theme.text}>{workflow.name}</span>
            <span fg={theme.textMuted}>{" \\"}</span>
          </text>
          <text>
            <span fg={theme.textMuted}>  -a </span>
            <span fg={theme.text}>{agent}</span>
            <span fg={theme.textMuted}>{" \\"}</span>
          </text>
          {isStructured ? (
            <box flexDirection="column">
              {fields.map((f, i) => {
                const last = i === fields.length - 1;
                const val = shortVal(values[f.name] ?? "") || `<${f.type}>`;
                return (
                  <text key={f.name}>
                    <span fg={theme.textMuted}>  --</span>
                    <span fg={theme.text}>{f.name}</span>
                    <span fg={theme.textMuted}>="</span>
                    <span fg={theme.text}>{val}</span>
                    <span fg={theme.textMuted}>"</span>
                    <span fg={theme.textDim}>{last ? "" : " \\"}</span>
                  </text>
                );
              })}
            </box>
          ) : (
            <text>
              <span fg={theme.textMuted}>  "</span>
              <span fg={theme.text}>{promptShort}</span>
              <span fg={theme.textMuted}>"</span>
            </text>
          )}
        </box>

        <box height={1} />

        {/* Prompt + key legend — the modal's own footer. The globally
            mapped keys here are duplicated in the Statusline hints so
            users scanning either surface find the same answer. esc
            still cancels silently since it costs nothing to support,
            but it's not advertised — y/n is the documented path. */}
        <text>
          <span fg={theme.textDim}>submit and run this workflow?  </span>
          <span fg={theme.success}><strong>y</strong></span>
          <span fg={theme.textDim}> submit  ·  </span>
          <span fg={theme.error}><strong>n</strong></span>
          <span fg={theme.textDim}> cancel</span>
        </text>
      </box>
    </box>
  );
}

// Per-agent brand color used as the Header pill background. The pill
// *is* the session identity badge — its contents and hue together
// answer "which backend am I targeting right now?" at a glance.
const AGENT_PILL_COLOR: Record<AgentType, keyof PickerTheme> = {
  claude: "warning", // amber — Anthropic-adjacent
  copilot: "success", // green — GitHub-adjacent
  opencode: "mauve",  // purple — leaves the warm slots for the other two
};

function Header({
  phase,
  confirmOpen,
  selectedAgent,
  scopedCount,
}: {
  phase: Phase;
  confirmOpen: boolean;
  selectedAgent: AgentType;
  scopedCount: number;
}) {
  // When the confirm modal is open we shift the breadcrumb to "confirm"
  // so the header reflects the active surface, even though the
  // underlying phase is still "prompt".
  const phaseLabel = confirmOpen
    ? "confirm"
    : phase === "pick"
    ? "select"
    : "compose";
  const pillBg = theme[AGENT_PILL_COLOR[selectedAgent]];

  return (
    <box
      height={1}
      backgroundColor={theme.surface}
      flexDirection="row"
      paddingRight={2}
      alignItems="center"
    >
      {/* Identity pill — shows the backend this session is pinned to,
          with a per-agent background hue so the badge is recognisable
          at a glance. Rendered in all caps to match the PICK / PROMPT
          / DONE mode pill in the statusline. Fixed at launch from the
          `-a` flag; not selectable from within the UI. */}
      <text>
        <span fg={theme.surface} bg={pillBg}>
          <strong>{" " + selectedAgent.toUpperCase() + " "}</strong>
        </span>
      </text>
      <text><span fg={theme.textDim}>{"  workflow  "}</span></text>
      <text><span fg={theme.textMuted}>›</span></text>
      <text><span fg={theme.textDim}>{"  " + phaseLabel}</span></text>
      <box flexGrow={1} />
      {/* Right side: workflow count for the currently-selected agent. */}
      <text>
        <span fg={theme.textDim}>
          {scopedCount + (scopedCount === 1 ? " workflow" : " workflows")}
        </span>
      </text>
    </box>
  );
}

function Statusline({
  phase,
  confirmOpen,
  hints,
  focusedWf,
}: {
  phase: Phase;
  confirmOpen: boolean;
  // `dim: true` fades the key to textDim so callers can mark a hint as
  // visually disabled — used to signal that ⌃s is currently blocked
  // by unfilled required fields.
  hints: { key: string; label: string; dim?: boolean }[];
  focusedWf: Workflow | undefined;
}) {
  const modeLabel = confirmOpen
    ? "CONFIRM"
    : phase === "pick"
    ? "PICK"
    : "PROMPT";
  const modeColor = confirmOpen
    ? theme.mauve
    : phase === "pick"
    ? theme.primary
    : theme.success;

  return (
    <box height={1} flexDirection="row" backgroundColor={theme.surface}>
      <box
        backgroundColor={modeColor}
        paddingLeft={1}
        paddingRight={1}
        alignItems="center"
      >
        <text fg={theme.surface}><strong>{modeLabel}</strong></text>
      </box>

      {focusedWf ? (
        <box paddingLeft={1} paddingRight={1} alignItems="center">
          <text>
            <span fg={theme.text}>{focusedWf.name}</span>
          </text>
        </box>
      ) : null}

      <box flexGrow={1} />

      <box paddingRight={2} alignItems="center" flexDirection="row">
        {hints.map((h, i) => (
          <box key={i} flexDirection="row">
            {i > 0 ? (
              <text><span fg={theme.textDim}>{"  ·  "}</span></text>
            ) : null}
            <text>
              <span fg={h.dim ? theme.textDim : theme.text}>{h.key}</span>
              <span fg={h.dim ? theme.textDim : theme.textMuted}>
                {" " + h.label}
              </span>
            </text>
          </box>
        ))}
      </box>
    </box>
  );
}

// ─── Validation ─────────────────────────────────

// A field is valid when it's optional, or required + non-empty. Enum
// fields are always seeded with a default or the first value on phase
// transition, so in practice they can't be empty — but we check
// defensively anyway. Text and string fields are validated after
// trimming whitespace so a form of spaces alone doesn't slip through.
function isFieldValid(field: WorkflowInput, value: string): boolean {
  if (!field.required) return true;
  if (field.type === "enum") return value !== "";
  return value.trim() !== "";
}

// ─── App ────────────────────────────────────────

function WorkflowPicker() {
  const renderer = useRenderer();

  const [phase, setPhase] = useState<Phase>("pick");
  const [query, setQuery] = useState("");
  const [entryIdx, setEntryIdx] = useState(0);
  // Structured form state: one value per field, plus the currently
  // focused field index. Initialized on phase transition from "pick".
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [focusedFieldIdx, setFocusedFieldIdx] = useState(0);
  // Confirm modal visibility — opens on ⌃s in the prompt phase, closes
  // on n/esc (cancel) or y/enter (submit; in prod, this is where the
  // workflow is actually triggered — see ConfirmModal's doc comment).
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Blinking cursor — Neovim's default rate is ~530ms half-period.
  const [cursorTick, setCursorTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCursorTick((c: number) => (c + 1) % 2), 530);
    return () => clearInterval(id);
  }, []);
  const cursorOn = cursorTick === 0;

  // The agent is pinned for the whole session — no state, no
  // dependency on anything reactive. `buildEntries` still takes it
  // as a parameter so the scope filter is explicit.
  const entries = useMemo(
    () => buildEntries(query, CURRENT_AGENT),
    [query],
  );
  const rows = useMemo(() => buildRows(entries, query), [entries, query]);

  // Clamp the focused index whenever the filter shrinks the list.
  useEffect(() => {
    if (entryIdx >= entries.length) {
      setEntryIdx(Math.max(0, entries.length - 1));
    }
  }, [entries.length, entryIdx]);

  const focusedWf = entries[entryIdx]?.workflow;

  // Resolve the active field list per render. For structured workflows
  // this is `workflow.inputs`; for free-form, a one-element list with
  // DEFAULT_PROMPT_INPUT — keeping the form renderer uniform.
  const currentFields: WorkflowInput[] =
    focusedWf?.inputs && focusedWf.inputs.length > 0
      ? focusedWf.inputs
      : [DEFAULT_PROMPT_INPUT];
  const currentField = currentFields[focusedFieldIdx];

  // Validation — the list of indices of required fields that are still
  // empty. Users can cycle through these freely with tab/shift+tab,
  // but ⌃s is blocked until the list is empty, so a half-filled form
  // can never reach the confirm modal.
  const invalidFieldIndices = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < currentFields.length; i++) {
      const f = currentFields[i]!;
      const v = fieldValues[f.name] ?? "";
      if (!isFieldValid(f, v)) out.push(i);
    }
    return out;
  }, [currentFields, fieldValues]);
  const isFormValid = invalidFieldIndices.length === 0;

  // Keyboard handling — branches on phase, with the confirm modal
  // intercepting all input while visible.
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      return;
    }

    // ── CONFIRM MODAL (overlay) ──
    // When the modal is open it owns the keyboard: y/enter commits,
    // n/esc cancels, everything else is swallowed so the user can't
    // keep typing into the (now-hidden) form fields.
    if (confirmOpen) {
      if (key.name === "y" || key.name === "return") {
        // TODO(prod): this is where the real CLI should trigger the
        // workflow and navigate to its live run view. Concretely:
        //
        //   await runWorkflow({
        //     workflow: focusedWf,
        //     agent: CURRENT_AGENT,
        //     inputs: fieldValues,
        //   });
        //   // then hand control to the workflow run surface, the
        //   // same one `atomic workflow <name> -a <agent>` lands on
        //   // when flags are passed directly on the command line.
        //
        // Neither hook is wired at the prototype layer, so for now
        // we just tear down the picker renderer on submit.
        renderer.destroy();
        return;
      }
      if (key.name === "n" || key.name === "escape") {
        setConfirmOpen(false);
        return;
      }
      return;
    }

    if (phase === "pick") {
      if (key.name === "escape") {
        renderer.destroy();
        return;
      }
      if (key.name === "up" || (key.ctrl && key.name === "k")) {
        setEntryIdx((i: number) => Math.max(0, i - 1));
        return;
      }
      if (key.name === "down" || (key.ctrl && key.name === "j")) {
        setEntryIdx((i: number) => Math.min(entries.length - 1, i + 1));
        return;
      }
      if (key.name === "return") {
        if (focusedWf) {
          // Seed fieldValues from the schema so enum fields start on
          // their default and the rest start empty. This is the only
          // place fieldValues is initialized — phase returns to "pick"
          // always go back through this handler to re-seed.
          const inputs: WorkflowInput[] =
            focusedWf.inputs && focusedWf.inputs.length > 0
              ? focusedWf.inputs
              : [DEFAULT_PROMPT_INPUT];
          const initial: Record<string, string> = {};
          for (const f of inputs) {
            initial[f.name] =
              f.default ??
              (f.type === "enum" ? f.values?.[0] ?? "" : "");
          }
          setFieldValues(initial);
          setFocusedFieldIdx(0);
          setPhase("prompt");
        }
        return;
      }
      if (key.name === "backspace") {
        setQuery((q: string) => q.slice(0, -1));
        return;
      }
      // Printable characters feed the filter input.
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        const c = key.sequence;
        if (c >= " " && c <= "~") setQuery((q: string) => q + c);
      }
      return;
    }

    // ── PROMPT phase ──
    if (key.name === "escape") {
      setPhase("pick");
      return;
    }
    if (key.ctrl && key.name === "s") {
      // Block submission while any required field is empty. Jump focus
      // to the first invalid field so the user sees exactly where the
      // problem is — the modal never opens, so there's no way to run a
      // workflow with missing required inputs.
      if (!isFormValid) {
        setFocusedFieldIdx(invalidFieldIndices[0]!);
        return;
      }
      setConfirmOpen(true);
      return;
    }
    // Tab / Shift-Tab cycles between fields, wrapping around at the
    // ends so multi-field forms feel like a proper loop — the common
    // expectation in TUI forms (huh, dialog, gum) and web forms alike.
    if (key.name === "tab") {
      setFocusedFieldIdx((i: number) => {
        const len = currentFields.length;
        if (len <= 1) return 0;
        return key.shift ? (i - 1 + len) % len : (i + 1) % len;
      });
      return;
    }
    if (!currentField) return;

    // Enum fields: ← → cycles values, ignores text input.
    if (currentField.type === "enum") {
      const values = currentField.values ?? [];
      if (values.length === 0) return;
      if (key.name === "left" || key.name === "right") {
        setFieldValues((prev: Record<string, string>) => {
          const cur = prev[currentField.name] ?? values[0] ?? "";
          const idx = Math.max(0, values.indexOf(cur));
          const delta = key.name === "left" ? -1 : 1;
          const nextIdx = (idx + delta + values.length) % values.length;
          return { ...prev, [currentField.name]: values[nextIdx] ?? "" };
        });
      }
      return;
    }

    // Text/string fields accept printable input.
    if (key.name === "return") {
      if (currentField.type === "text") {
        setFieldValues((prev: Record<string, string>) => ({
          ...prev,
          [currentField.name]: (prev[currentField.name] ?? "") + "\n",
        }));
      } else {
        // string: advance to next field on Enter
        setFocusedFieldIdx((i: number) =>
          Math.min(currentFields.length - 1, i + 1),
        );
      }
      return;
    }
    if (key.name === "backspace") {
      setFieldValues((prev: Record<string, string>) => ({
        ...prev,
        [currentField.name]: (prev[currentField.name] ?? "").slice(0, -1),
      }));
      return;
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      const c = key.sequence;
      if (c >= " " && c <= "~") {
        setFieldValues((prev: Record<string, string>) => ({
          ...prev,
          [currentField.name]: (prev[currentField.name] ?? "") + c,
        }));
      }
    }
  });

  // Footer hints — compact, action-first. The confirm-modal hints take
  // priority over the underlying phase's hints while the modal is open.
  const pickHints = [
    { key: "↑↓", label: "navigate" },
    { key: "↵", label: "select" },
    { key: "esc", label: "quit" },
  ];
  // When the form is invalid, the ⌃s hint is dimmed to signal that
  // submission is currently blocked. The key still "exists" — hitting
  // it just jumps focus to the first invalid field instead of opening
  // the modal — so we fade it rather than hide it.
  const promptHints = [
    { key: "tab", label: "to navigate forward" },
    { key: "shift+tab", label: "to navigate backward" },
    { key: "ctrl+s", label: "to run", dim: !isFormValid },
  ];
  const confirmHints = [
    { key: "y", label: "submit" },
    { key: "n", label: "cancel" },
  ];

  const hints = confirmOpen
    ? confirmHints
    : phase === "pick"
    ? pickHints
    : promptHints;

  return (
    // `position="relative"` on the root establishes the positioning
    // context for the ConfirmModal's absolute overlay — without this,
    // the modal's `left/top/width/height` resolve against the terminal
    // viewport rather than the app root.
    <box
      position="relative"
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <Header
        phase={phase}
        confirmOpen={confirmOpen}
        selectedAgent={CURRENT_AGENT}
        scopedCount={
          WORKFLOWS.filter((w) => w.agents.includes(CURRENT_AGENT)).length
        }
      />

      {phase === "pick" ? (
        <box
          flexGrow={1}
          flexDirection="row"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
        >
          {/* Left sidebar — filter + list. The selected agent is now
              advertised by the pill in the Header, not here. */}
          <box width={36} flexDirection="column">
            <FilterBar
              query={query}
              count={entries.length}
              cursorOn={cursorOn}
            />
            <box height={1} />
            <WorkflowList rows={rows} focusedEntryIdx={entryIdx} />
          </box>
          {/* Divider — a single column of darker surface */}
          <box width={1} backgroundColor={theme.border} />
          {/* Preview column — takes all remaining width */}
          <box flexGrow={1} flexDirection="column">
            {focusedWf ? (
              <Preview wf={focusedWf} />
            ) : (
              <EmptyPreview query={query} />
            )}
          </box>
        </box>
      ) : phase === "prompt" && focusedWf ? (
        <InputPhase
          workflow={focusedWf}
          agent={CURRENT_AGENT}
          fields={currentFields}
          values={fieldValues}
          focusedFieldIdx={focusedFieldIdx}
          cursorOn={cursorOn}
        />
      ) : null}

      <Statusline
        phase={phase}
        confirmOpen={confirmOpen}
        hints={hints}
        focusedWf={focusedWf}
      />

      {/* Confirm modal — rendered last so it sits above the Header,
          InputPhase, and Statusline in document order. zIndex={100} on
          the overlay container reinforces the stacking for good
          measure. */}
      {confirmOpen && focusedWf ? (
        <ConfirmModal
          workflow={focusedWf}
          agent={CURRENT_AGENT}
          fields={currentFields}
          values={fieldValues}
        />
      ) : null}
    </box>
  );
}

// ─── Entry ──────────────────────────────────────

const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<WorkflowPicker />);
