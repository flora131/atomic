/** @jsxImportSource @opentui/react */
/**
 * WorkflowPickerPanel — interactive TUI for `atomic workflow -a <agent>`.
 *
 * Telescope-style fuzzy picker with a two-phase flow:
 *
 *   1. PICK   — filter workflows scoped to the current agent, navigate with
 *               ↑/↓ or ⌃j/⌃k, press ↵ to lock in a selection.
 *   2. PROMPT — fill the workflow's declared input schema (one field per
 *               declared `WorkflowInput`). Free-form workflows fall back to
 *               a single `prompt` text field.
 *
 * Pressing ⌃s in the prompt phase validates required fields and opens a
 * CONFIRM modal that shows the fully-composed shell command before
 * submission. y/↵ confirms, n/esc cancels back to the form.
 *
 * Lifecycle:
 *
 *   const panel = await WorkflowPickerPanel.create({ agent, workflows });
 *   const result = await panel.waitForSelection();
 *   panel.destroy();
 *   if (result) await executeWorkflow({ ... });
 *
 * `waitForSelection()` resolves with `null` if the user exits without
 * committing (esc in PICK phase, or ⌃c anywhere) and with a
 * `{ workflow, inputs }` record if they confirm the run.
 */

import {
  createCliRenderer,
  type CliRenderer,
  type TextareaRenderable,
} from "@opentui/core";
import {
  createRoot,
  useKeyboard,
  type Root,
} from "@opentui/react";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLatest } from "./hooks.ts";
import { resolveTheme, type TerminalTheme } from "../runtime/theme.ts";
import type { AgentType, WorkflowInput } from "../types.ts";
import type { WorkflowWithMetadata } from "../runtime/discovery.ts";
import { ErrorBoundary } from "./error-boundary.tsx";

// ─── Theme ──────────────────────────────────────
// The picker uses a slightly extended palette vs. the base terminal theme:
// an `info` (sky) hue for built-in workflows and a `mauve` hue for global
// ones — the same distinctions `atomic workflow -l` already draws. The
// rest is sourced from {@link resolveTheme} so light/dark mode tracks the
// orchestrator panel.
export interface PickerTheme {
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

export function buildPickerTheme(base: TerminalTheme): PickerTheme {
  // For dark mode the prototype values track Catppuccin Mocha. For light
  // mode we derive muted variants from the base palette — the specific
  // extras (`info`, `mauve`, the three-level background ladder) have no
  // direct entries in `TerminalTheme`, so we pick close-enough Catppuccin
  // values to keep the picker visually consistent with the orchestrator.
  const isDark = base.bg !== "#eff1f5";
  return {
    background: base.bg,
    backgroundPanel: isDark ? "#181825" : "#e6e9ef",
    backgroundElement: isDark ? "#11111b" : "#dce0e8",
    surface: base.surface,
    text: base.text,
    textMuted: isDark ? "#a6adc8" : "#5c5f77",
    textDim: base.dim,
    primary: base.accent,
    success: base.success,
    error: base.error,
    warning: base.warning,
    info: isDark ? "#89dceb" : "#04a5e5",
    mauve: isDark ? "#cba6f7" : "#8839ef",
    border: base.borderDim,
    borderActive: base.border,
  };
}

// ─── Types ──────────────────────────────────────

type Source = "local" | "global" | "builtin";
type Phase = "pick" | "prompt";

/** The payload the picker resolves with on successful submission. */
export interface WorkflowPickerResult {
  /** The workflow the user committed to running. */
  workflow: WorkflowWithMetadata;
  /** Populated form values, one per declared input (or { prompt } for free-form). */
  inputs: Record<string, string>;
}

/** Fallback field used when a workflow has no structured input schema. */
const DEFAULT_PROMPT_INPUT: WorkflowInput = {
  name: "prompt",
  type: "text",
  required: true,
  description: "what do you want this workflow to do?",
  placeholder: "describe your task…",
};

// ─── Helpers ────────────────────────────────────

const SOURCE_DISPLAY: Record<Source, string> = {
  local: "local",
  global: "global",
  builtin: "builtin",
};

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

/**
 * Subsequence fuzzy match — Telescope-style. Returns a score (lower =
 * better) or null for no match. Adjacent matches are rewarded; jumps over
 * non-matching characters are penalized proportionally to the gap.
 */
export function fuzzyMatch(query: string, target: string): number | null {
  if (query === "") return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let ti = 0;
  let score = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === q[qi]) {
        found = ti;
        break;
      }
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
  workflow: WorkflowWithMetadata;
  section: Source;
}

type ListRow =
  | { kind: "section"; source: Source }
  | { kind: "entry"; entry: ListEntry };

export function buildEntries(
  query: string,
  workflows: WorkflowWithMetadata[],
): ListEntry[] {
  type Scored = { wf: WorkflowWithMetadata; score: number };
  const scored: Scored[] = [];
  for (const wf of workflows) {
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
  return scored.map<ListEntry>((s) => ({
    workflow: s.wf,
    section: s.wf.source,
  }));
}

export function buildRows(entries: ListEntry[], query: string): ListRow[] {
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

// ─── Validation ─────────────────────────────────

export function isFieldValid(field: WorkflowInput, value: string): boolean {
  if (!field.required) return true;
  if (field.type === "enum") return value !== "";
  return value.trim() !== "";
}

// ─── Components ─────────────────────────────────

function SectionLabel({
  theme,
  label,
}: {
  theme: PickerTheme;
  label: string;
}) {
  return (
    <box height={1} flexDirection="row">
      <text>
        <span fg={theme.mauve}>▎ </span>
        <span fg={theme.textMuted}>
          <strong>{label}</strong>
        </span>
      </text>
    </box>
  );
}

function FilterBar({
  theme,
  query,
  focused,
  onInput,
}: {
  theme: PickerTheme;
  query: string;
  focused: boolean;
  onInput: (value: string) => void;
}) {
  return (
    <box
      minHeight={3}
      border
      borderStyle="rounded"
      borderColor={theme.borderActive}
      backgroundColor={theme.backgroundPanel}
      flexDirection="row"
      paddingLeft={2}
      paddingRight={2}
      alignItems="center"
    >
      <text>
        <span fg={theme.primary}>
          <strong>❯ </strong>
        </span>
      </text>
      <input
        value={query}
        focused={focused}
        onInput={onInput}
        textColor={theme.text}
        backgroundColor={theme.backgroundPanel}
        focusedBackgroundColor={theme.backgroundPanel}
        focusedTextColor={theme.text}
        flexGrow={1}
      />
    </box>
  );
}

function WorkflowList({
  theme,
  rows,
  focusedEntryIdx,
}: {
  theme: PickerTheme;
  rows: ListRow[];
  focusedEntryIdx: number;
}) {
  if (rows.length === 0) {
    return (
      <box paddingLeft={2} paddingTop={2}>
        <text>
          <span fg={theme.textDim}>no matches</span>
        </text>
      </box>
    );
  }

  // Pre-compute entry indices so the render pass is side-effect-free.
  const entryIndexByRow = useMemo(() => {
    const map = new Map<number, number>();
    let counter = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]!.kind === "entry") {
        map.set(i, counter++);
      }
    }
    return map;
  }, [rows]);

  return (
    <box flexDirection="column">
      {rows.map((row, i) => {
        if (row.kind === "section") {
          const src = row.source;
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
        const entryIdx = entryIndexByRow.get(i) ?? -1;
        const isFocused = entryIdx === focusedEntryIdx;
        const wf = row.entry.workflow;

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

function ArgumentRow({
  theme,
  field,
}: {
  theme: PickerTheme;
  field: WorkflowInput;
}) {
  const isRequired = field.required ?? false;
  const tagCol = isRequired ? theme.warning : theme.textDim;
  const tagLabel = isRequired ? "required" : "optional";
  const showEnumValues =
    field.type === "enum" && field.values && field.values.length > 0;

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2}>
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

      {field.description ? (
        <box height={1}>
          <text>
            <span fg={theme.textMuted}>{field.description}</span>
          </text>
        </box>
      ) : null}

      {showEnumValues ? (
        <box height={1}>
          <text>
            <span fg={theme.textDim}>{field.values!.join("  ·  ")}</span>
          </text>
        </box>
      ) : null}

      <box height={1} />
    </box>
  );
}

function Preview({
  theme,
  wf,
}: {
  theme: PickerTheme;
  wf: WorkflowWithMetadata;
}) {
  const args: WorkflowInput[] =
    wf.inputs.length > 0 ? [...wf.inputs] : [DEFAULT_PROMPT_INPUT];

  return (
    <box
      flexDirection="column"
      paddingLeft={3}
      paddingRight={3}
      paddingTop={1}
    >
      <text>
        <span fg={theme.text}>
          <strong>{wf.name}</strong>
        </span>
      </text>

      <box height={1} />

      <text>
        <span fg={theme[SOURCE_COLOR[wf.source]]}>
          {SOURCE_DISPLAY[wf.source]}
        </span>
        <span fg={theme.textDim}>
          {" (" + SOURCE_DIR[wf.source] + ")"}
        </span>
      </text>

      <box height={2} />

      <text>
        <span fg={theme.textMuted}>
          {wf.description || "(no description)"}
        </span>
      </text>

      <box height={2} />

      <SectionLabel theme={theme} label="ARGUMENTS" />
      <box height={1} />
      {args.map((f) => (
        <ArgumentRow key={f.name} theme={theme} field={f} />
      ))}
    </box>
  );
}

function EmptyPreview({
  theme,
  query,
}: {
  theme: PickerTheme;
  query: string;
}) {
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
      <text>
        <span fg={theme.textDim}>
          Press backspace to widen your search, or
        </span>
      </text>
      <box height={2} />
      <text>
        <span fg={theme.textDim}>create a new one at</span>
      </text>
      <box height={1} />
      <box paddingLeft={2}>
        <text>
          <span fg={theme.primary}>
            .atomic/workflows/&lt;name&gt;/&lt;agent&gt;/index.ts
          </span>
        </text>
      </box>
    </box>
  );
}

// ─── Field renderers ────────────────────────────

const TEXT_FIELD_LINES = 3;


function TextAreaContent({
  theme,
  value,
  placeholder,
  focused,
  onChangeRef,
}: {
  theme: PickerTheme;
  value: string;
  placeholder: string;
  focused: boolean;
  onChangeRef: React.RefObject<((value: string) => void) | null>;
}) {
  const ref = useRef<TextareaRenderable>(null);

  // Sync external value → textarea when it diverges (e.g. initial value).
  useEffect(() => {
    if (ref.current && ref.current.plainText !== value) {
      ref.current.setText(value);
    }
  }, [value]);

  // Report changes back to parent via onContentChange.
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.onContentChange = () => {
      onChangeRef.current?.(ta.plainText);
    };
    return () => {
      ta.onContentChange = undefined;
    };
  }, [onChangeRef]);

  return (
    <textarea
      ref={ref}
      initialValue={value}
      placeholder={placeholder}
      focused={focused}
      textColor={theme.text}
      backgroundColor="transparent"
      focusedBackgroundColor="transparent"
      focusedTextColor={theme.text}
      placeholderColor={theme.textDim}
      wrapMode="word"
      flexGrow={1}
    />
  );
}

function StringContent({
  theme,
  value,
  placeholder,
  focused,
  onInput,
}: {
  theme: PickerTheme;
  value: string;
  placeholder: string;
  focused: boolean;
  onInput: (value: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      focused={focused}
      onInput={onInput}
      textColor={theme.text}
      backgroundColor="transparent"
      focusedBackgroundColor="transparent"
      focusedTextColor={theme.text}
      flexGrow={1}
    />
  );
}

function EnumContent({
  theme,
  values,
  selected,
  focused,
}: {
  theme: PickerTheme;
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
          ? focused
            ? theme.primary
            : theme.success
          : theme.textDim;
        const textColor = isSelected
          ? focused
            ? theme.text
            : theme.textMuted
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
  theme,
  field,
  value,
  focused,
  onInput,
  onTextChangeRef,
}: {
  theme: PickerTheme;
  field: WorkflowInput;
  value: string;
  focused: boolean;
  onInput: (value: string) => void;
  onTextChangeRef: React.RefObject<((value: string) => void) | null>;
}) {
  const borderCol = focused ? theme.primary : theme.border;
  const bgCol = focused ? theme.backgroundPanel : theme.backgroundElement;

  const boxHeight = field.type === "text" ? TEXT_FIELD_LINES + 2 : 3;

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
        minHeight={boxHeight}
        justifyContent={field.type === "text" ? "flex-start" : "center"}
        title={` ${field.name} `}
        titleAlignment="left"
      >
        {field.type === "text" ? (
          <TextAreaContent
            theme={theme}
            value={value}
            placeholder={field.placeholder ?? ""}
            focused={focused}
            onChangeRef={onTextChangeRef}
          />
        ) : field.type === "string" ? (
          <StringContent
            theme={theme}
            value={value}
            placeholder={field.placeholder ?? ""}
            focused={focused}
            onInput={onInput}
          />
        ) : field.type === "enum" ? (
          <EnumContent
            theme={theme}
            values={field.values ?? []}
            selected={value}
            focused={focused}
          />
        ) : null}
      </box>

      <box paddingLeft={2} paddingRight={2} height={1}>
        <text>
          <span fg={theme.textDim}>{field.type}</span>
          <span fg={theme.textDim}>{"  ·  "}</span>
          <span fg={tagCol}>{tagLabel}</span>
          <span fg={theme.textDim}>{captionDesc}</span>
        </text>
      </box>

      <box height={1} />
    </box>
  );
}

function InputPhase({
  theme,
  workflow,
  agent,
  fields,
  values,
  focusedFieldIdx,
  onFieldInput,
  onTextChangeRef,
}: {
  theme: PickerTheme;
  workflow: WorkflowWithMetadata;
  agent: AgentType;
  fields: WorkflowInput[];
  values: Record<string, string>;
  focusedFieldIdx: number;
  onFieldInput: (fieldName: string, value: string) => void;
  onTextChangeRef: React.RefObject<((value: string) => void) | null>;
}) {
  const isStructured = workflow.inputs.length > 0;

  return (
    <box
      flexDirection="column"
      paddingLeft={3}
      paddingRight={3}
      paddingTop={2}
      flexGrow={1}
    >
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
          <span fg={theme.primary}>
            <strong>▸ </strong>
          </span>
          <span fg={theme.text}>
            <strong>{workflow.name}</strong>
          </span>
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
        <text>
          <span fg={theme.textMuted}>
            {workflow.description || "(no description)"}
          </span>
        </text>
      </box>

      <box height={2} />

      <box flexDirection="row" height={1}>
        <text>
          <span fg={theme.textDim}>
            <strong>{isStructured ? "INPUTS" : "PROMPT"}</strong>
          </span>
        </text>
        <box flexGrow={1} />
        <text>
          <span fg={theme.textDim}>
            {isStructured ? `${focusedFieldIdx + 1} / ${fields.length}` : ""}
          </span>
        </text>
      </box>
      <box height={1} />

      {fields.map((f, i) => (
        <Field
          key={f.name}
          theme={theme}
          field={f}
          value={values[f.name] ?? ""}
          focused={i === focusedFieldIdx}
          onInput={(v) => onFieldInput(f.name, v)}
          onTextChangeRef={onTextChangeRef}
        />
      ))}
    </box>
  );
}

function ConfirmModal({
  theme,
  workflow,
  agent,
}: {
  theme: PickerTheme;
  workflow: WorkflowWithMetadata;
  agent: AgentType;
}) {
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      zIndex={100}
      backgroundColor={theme.background}
    >
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
        {/* Header — the form the user just filled in already shows the
            workflow name, agent, and field values, so the modal stays
            minimal and focuses on the submit/cancel question rather
            than restating the full invocation. */}
        <text>
          <span fg={theme.success}>
            <strong>✓ </strong>
          </span>
          <span fg={theme.text}>
            <strong>{workflow.name}</strong>
          </span>
          <span fg={theme.textDim}>{"  ·  "}</span>
          <span fg={theme.mauve}>{agent}</span>
        </text>

        <box height={1} />

        <text>
          <span fg={theme.textDim}>
            submit and run this workflow?{"  "}
          </span>
          <span fg={theme.success}>
            <strong>y</strong>
          </span>
          <span fg={theme.textDim}> submit  ·  </span>
          <span fg={theme.error}>
            <strong>n</strong>
          </span>
          <span fg={theme.textDim}> cancel</span>
        </text>
      </box>
    </box>
  );
}

// Stable hint arrays — no need for useMemo since they never change.
const PICK_HINTS: { key: string; label: string; dim?: boolean }[] = [
  { key: "↑↓", label: "navigate" },
  { key: "↵", label: "select" },
  { key: "esc", label: "quit" },
];
const CONFIRM_HINTS: { key: string; label: string; dim?: boolean }[] = [
  { key: "y", label: "submit" },
  { key: "n", label: "cancel" },
];

// Per-agent brand color used as the Header pill background.
const AGENT_PILL_COLOR: Record<AgentType, keyof PickerTheme> = {
  claude: "warning",
  copilot: "success",
  opencode: "mauve",
};

function Header({
  theme,
  phase,
  confirmOpen,
  selectedAgent,
  scopedCount,
}: {
  theme: PickerTheme;
  phase: Phase;
  confirmOpen: boolean;
  selectedAgent: AgentType;
  scopedCount: number;
}) {
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
      <text>
        <span fg={theme.surface} bg={pillBg}>
          <strong>{" " + selectedAgent.toUpperCase() + " "}</strong>
        </span>
      </text>
      <text>
        <span fg={theme.textDim}>{"  workflow  "}</span>
      </text>
      <text>
        <span fg={theme.textMuted}>›</span>
      </text>
      <text>
        <span fg={theme.textDim}>{"  " + phaseLabel}</span>
      </text>
      <box flexGrow={1} />
      <text>
        <span fg={theme.textDim}>
          {scopedCount + (scopedCount === 1 ? " workflow" : " workflows")}
        </span>
      </text>
    </box>
  );
}

function Statusline({
  theme,
  phase,
  confirmOpen,
  hints,
  focusedWf,
}: {
  theme: PickerTheme;
  phase: Phase;
  confirmOpen: boolean;
  hints: { key: string; label: string; dim?: boolean }[];
  focusedWf: WorkflowWithMetadata | undefined;
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
    <box height={1} flexDirection="row" backgroundColor={theme.surface} position="relative" zIndex={101}>
      <box
        backgroundColor={modeColor}
        paddingLeft={1}
        paddingRight={1}
        alignItems="center"
      >
        <text fg={theme.surface}>
          <strong>{modeLabel}</strong>
        </text>
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
          <box key={h.key} flexDirection="row">
            {i > 0 ? (
              <text>
                <span fg={theme.textDim}>{"  ·  "}</span>
              </text>
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

// ─── App ────────────────────────────────────────

interface PickerAppProps {
  theme: PickerTheme;
  agent: AgentType;
  workflows: WorkflowWithMetadata[];
  onSubmit: (result: WorkflowPickerResult) => void;
  onCancel: () => void;
}

export function WorkflowPicker({
  theme,
  agent,
  workflows,
  onSubmit,
  onCancel,
}: PickerAppProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [query, setQuery] = useState("");
  const [entryIdx, setEntryIdx] = useState(0);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [focusedFieldIdx, setFocusedFieldIdx] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Ref-based callback for textarea change notifications. The ref is
  // stable across renders so the textarea effect doesn't re-attach.
  const textChangeRef = useRef<((value: string) => void) | null>(null);

  const entries = useMemo(() => buildEntries(query, workflows), [query, workflows]);
  const rows = useMemo(() => buildRows(entries, query), [entries, query]);

  // Clamp index when the list shrinks (e.g. typing filters entries out).
  useEffect(() => {
    setEntryIdx((i) => Math.min(i, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  const focusedWf = entries[entryIdx]?.workflow;

  const currentFields = useMemo<WorkflowInput[]>(
    () => focusedWf && focusedWf.inputs.length > 0
      ? focusedWf.inputs.slice()
      : [DEFAULT_PROMPT_INPUT],
    [focusedWf],
  );
  const currentField = currentFields[focusedFieldIdx];

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

  // Wire the textarea change callback so field values stay in sync.
  // The ref is written here (not in a child) so the parent state
  // always reflects the latest textarea content.
  const focusedField = currentField;
  textChangeRef.current = focusedField
    ? (text: string) => {
        setFieldValues((prev) => ({ ...prev, [focusedField.name]: text }));
      }
    : null;

  // Stable callback for field input — the setter is referentially stable.
  const onFieldInput = useCallback(
    (name: string, v: string) => setFieldValues((prev) => ({ ...prev, [name]: v })),
    [],
  );

  // Stable refs for values read inside the keyboard handler,
  // preventing stale closures when useKeyboard holds the first callback.
  const entriesRef = useLatest(entries);
  const focusedWfRef = useLatest(focusedWf);
  const fieldValuesRef = useLatest(fieldValues);
  const isFormValidRef = useLatest(isFormValid);
  const invalidFieldIndicesRef = useLatest(invalidFieldIndices);
  const currentFieldsRef = useLatest(currentFields);
  const currentFieldRef = useLatest(currentField);
  const phaseRef = useLatest(phase);
  const confirmOpenRef = useLatest(confirmOpen);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.stopPropagation();
      onCancel();
      return;
    }

    if (confirmOpenRef.current) {
      // Consume all keys while the modal is open so focused fields
      // behind the overlay never see them.
      key.stopPropagation();
      if (key.name === "y" || key.name === "return") {
        const wf = focusedWfRef.current;
        if (!wf) return;
        onSubmit({ workflow: wf, inputs: { ...fieldValuesRef.current } });
        return;
      }
      if (key.name === "n" || key.name === "escape") {
        setConfirmOpen(false);
        return;
      }
      return;
    }

    if (phaseRef.current === "pick") {
      if (key.name === "escape") {
        key.stopPropagation();
        onCancel();
        return;
      }
      if (key.name === "up" || (key.ctrl && key.name === "k")) {
        key.stopPropagation();
        setEntryIdx((i: number) => Math.max(0, i - 1));
        return;
      }
      if (key.name === "down" || (key.ctrl && key.name === "j")) {
        key.stopPropagation();
        setEntryIdx((i: number) =>
          Math.min(entriesRef.current.length - 1, i + 1),
        );
        return;
      }
      if (key.name === "return") {
        key.stopPropagation();
        const wf = focusedWfRef.current;
        if (wf) {
          const inputs: WorkflowInput[] =
            wf.inputs.length > 0
              ? [...wf.inputs]
              : [DEFAULT_PROMPT_INPUT];
          const initial: Record<string, string> = {};
          for (const f of inputs) {
            initial[f.name] =
              f.default ??
              (f.type === "enum" ? (f.values?.[0] ?? "") : "");
          }
          setFieldValues(initial);
          setFocusedFieldIdx(0);
          setPhase("prompt");
        }
        return;
      }
      // All other keys (typing, backspace, arrows) are handled by the
      // native <input> component in the FilterBar.
      return;
    }

    // ── PROMPT phase ──
    if (key.name === "escape") {
      key.stopPropagation();
      setPhase("pick");
      return;
    }
    if (key.ctrl && key.name === "s") {
      key.stopPropagation();
      if (!isFormValidRef.current) {
        setFocusedFieldIdx(invalidFieldIndicesRef.current[0]!);
        return;
      }
      setConfirmOpen(true);
      return;
    }
    if (key.name === "tab") {
      key.stopPropagation();
      setFocusedFieldIdx((i: number) => {
        const len = currentFieldsRef.current.length;
        if (len <= 1) return 0;
        return key.shift ? (i - 1 + len) % len : (i + 1) % len;
      });
      return;
    }
    const field = currentFieldRef.current;
    if (!field) return;

    // Enum fields use left/right to cycle values.
    if (field.type === "enum") {
      const values = field.values ?? [];
      if (values.length === 0) return;
      if (key.name === "left" || key.name === "right") {
        key.stopPropagation();
        setFieldValues((prev: Record<string, string>) => {
          const cur = prev[field.name] ?? values[0] ?? "";
          const idx = Math.max(0, values.indexOf(cur));
          const delta = key.name === "left" ? -1 : 1;
          const nextIdx = (idx + delta + values.length) % values.length;
          return { ...prev, [field.name]: values[nextIdx] ?? "" };
        });
      }
      return;
    }

    // For string fields, return advances focus to the next field
    // (the native <input> fires onSubmit, but we handle it here so
    // the focus-cycling logic stays in one place).
    if (field.type === "string" && key.name === "return") {
      key.stopPropagation();
      setFocusedFieldIdx((i: number) =>
        Math.min(currentFieldsRef.current.length - 1, i + 1),
      );
      return;
    }
    // All other keys for string/text fields (typing, backspace,
    // arrows, undo/redo) are handled by native <input>/<textarea>.
  });

  const pickHints = PICK_HINTS;
  const confirmHints = CONFIRM_HINTS;
  const promptHints = useMemo(() => [
    { key: "tab", label: "to navigate forward" },
    { key: "shift+tab", label: "to navigate backward" },
    { key: "ctrl+s", label: "to run", dim: !isFormValid },
  ], [isFormValid]);

  const hints = confirmOpen
    ? confirmHints
    : phase === "pick"
      ? pickHints
      : promptHints;

  return (
    <box
      position="relative"
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <Header
        theme={theme}
        phase={phase}
        confirmOpen={confirmOpen}
        selectedAgent={agent}
        scopedCount={workflows.length}
      />

      {phase === "pick" ? (
        <box
          flexGrow={1}
          flexDirection="row"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
        >
          <box width={36} flexDirection="column">
            <FilterBar theme={theme} query={query} focused={phase === "pick"} onInput={setQuery} />
            <box height={1} />
            <WorkflowList
              theme={theme}
              rows={rows}
              focusedEntryIdx={entryIdx}
            />
          </box>
          <box width={1} backgroundColor={theme.border} />
          <box flexGrow={1} flexDirection="column">
            {focusedWf ? (
              <Preview theme={theme} wf={focusedWf} />
            ) : (
              <EmptyPreview theme={theme} query={query} />
            )}
          </box>
        </box>
      ) : phase === "prompt" && focusedWf ? (
        <InputPhase
          theme={theme}
          workflow={focusedWf}
          agent={agent}
          fields={currentFields}
          values={fieldValues}
          focusedFieldIdx={confirmOpen ? -1 : focusedFieldIdx}
          onFieldInput={onFieldInput}
          onTextChangeRef={textChangeRef}
        />
      ) : null}

      <Statusline
        theme={theme}
        phase={phase}
        confirmOpen={confirmOpen}
        hints={hints}
        focusedWf={focusedWf}
      />

      {confirmOpen && focusedWf ? (
        <ConfirmModal theme={theme} workflow={focusedWf} agent={agent} />
      ) : null}
    </box>
  );
}

// ─── Public class API ──────────────────────────

export interface WorkflowPickerPanelOptions {
  agent: AgentType;
  /** Pre-loaded workflows to show. Must already be filtered to `agent`. */
  workflows: WorkflowWithMetadata[];
}

/**
 * Imperative shell around the React picker tree — mirrors the
 * {@link OrchestratorPanel} lifecycle so both panels can be used
 * interchangeably by the CLI command layer.
 */
export class WorkflowPickerPanel {
  private renderer: CliRenderer;
  private root: Root;
  private destroyed = false;
  private resolveSelection: ((r: WorkflowPickerResult | null) => void) | null =
    null;
  private selectionPromise: Promise<WorkflowPickerResult | null>;

  private constructor(
    renderer: CliRenderer,
    options: WorkflowPickerPanelOptions,
  ) {
    this.renderer = renderer;
    this.selectionPromise = new Promise((resolve) => {
      this.resolveSelection = resolve;
    });

    const theme = buildPickerTheme(resolveTheme(renderer.themeMode));
    this.root = createRoot(renderer);
    this.root.render(
      <ErrorBoundary
        fallback={(err) => (
          <box
            width="100%"
            height="100%"
            justifyContent="center"
            alignItems="center"
            backgroundColor={theme.background}
          >
            <text>
              <span fg={theme.error}>
                {`Fatal render error: ${err.message}`}
              </span>
            </text>
          </box>
        )}
      >
        <WorkflowPicker
          theme={theme}
          agent={options.agent}
          workflows={options.workflows}
          onSubmit={(result) => this.handleSubmit(result)}
          onCancel={() => this.handleCancel()}
        />
      </ErrorBoundary>,
    );
  }

  /**
   * Create a new WorkflowPickerPanel. Initialises a CLI renderer and
   * mounts the interactive tree. The caller should `await
   * waitForSelection()` and then call `destroy()` regardless of outcome.
   */
  static async create(
    options: WorkflowPickerPanelOptions,
  ): Promise<WorkflowPickerPanel> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      exitSignals: [
        "SIGTERM",
        "SIGQUIT",
        "SIGABRT",
        "SIGHUP",
        "SIGPIPE",
        "SIGBUS",
        "SIGFPE",
      ],
    });
    return new WorkflowPickerPanel(renderer, options);
  }

  /** Create with an externally-provided renderer (e.g. a test renderer). */
  static createWithRenderer(
    renderer: CliRenderer,
    options: WorkflowPickerPanelOptions,
  ): WorkflowPickerPanel {
    return new WorkflowPickerPanel(renderer, options);
  }

  /**
   * Resolve with the user's selection once they confirm, or `null` if
   * they exit the picker without committing. Idempotent — subsequent
   * calls return the same promise.
   */
  waitForSelection(): Promise<WorkflowPickerResult | null> {
    return this.selectionPromise;
  }

  /** Tear down the CLI renderer. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Ensure anyone still awaiting the selection promise is released.
    if (this.resolveSelection) {
      this.resolveSelection(null);
      this.resolveSelection = null;
    }
    try {
      this.renderer.destroy();
    } catch {}
  }

  private handleSubmit(result: WorkflowPickerResult): void {
    if (this.resolveSelection) {
      this.resolveSelection(result);
      this.resolveSelection = null;
    }
  }

  private handleCancel(): void {
    if (this.resolveSelection) {
      this.resolveSelection(null);
      this.resolveSelection = null;
    }
  }
}
