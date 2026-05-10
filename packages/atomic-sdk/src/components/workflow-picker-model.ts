/**
 * workflow-picker-model.ts
 *
 * Pure input-model helpers for WorkflowPickerPanel:
 *   - Fuzzy-match scoring
 *   - List / row building (entry grouping, section headers)
 *   - Field validation
 *
 * Zero React deps — safe to import in tests and non-UI contexts.
 */

import type {
  AgentType,
  BrokenWorkflow,
  WorkflowDefinition,
  WorkflowInput,
} from "../types.ts";
import type { PickerTheme } from "./workflow-picker-theme.ts";

// ─── Shared types ────────────────────────────────

/** A registry entry the picker can display. */
export type PickerWorkflow = WorkflowDefinition;

/** Two-phase UI state for the picker. */
export type Phase = "pick" | "prompt";

/**
 * A unified navigable row in the picker list — either a healthy workflow or a
 * broken entry that failed to load. Arrow-key navigation indices over this
 * union so broken entries are fully traversable.
 */
export type PickerRow =
  | { kind: "healthy"; wf: PickerWorkflow }
  | { kind: "broken"; alias: string; agent: AgentType; broken: BrokenWorkflow };

/** The payload the picker resolves with on successful submission. */
export interface WorkflowPickerResult {
  /** The workflow the user committed to running. */
  workflow: PickerWorkflow;
  /** Populated form values, one per declared input (or { prompt } for free-form). */
  inputs: Record<string, string>;
}

// ─── Internal list types ─────────────────────────

export interface ListEntry {
  workflow: PickerWorkflow;
  /** Agent the workflow belongs to — used for section grouping. */
  section: AgentType;
}

export type ListRow =
  | { kind: "section"; agent: AgentType }
  | { kind: "entry"; entry: ListEntry };

// ─── Constants ───────────────────────────────────

/** Canonical agent display order for empty-query grouping. */
export const AGENT_ORDER: readonly AgentType[] = ["claude", "copilot", "opencode"];

/** Per-agent display color in the picker list / section headers. */
export const AGENT_COLOR: Record<AgentType, keyof PickerTheme> = {
  claude: "warning",
  copilot: "success",
  opencode: "mauve",
};

// ─── Fuzzy matching ──────────────────────────────

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

/**
 * Combine name + description fuzzy scores into a single rank. Description
 * matches carry a +2 penalty so name hits win ties. Returns `null` when
 * neither field matched.
 */
export function combinedFuzzyScore(
  query: string,
  name: string,
  description: string,
): number | null {
  const nameScore = fuzzyMatch(query, name);
  const descScore = fuzzyMatch(query, description);
  if (nameScore !== null && descScore !== null) {
    return Math.min(nameScore, descScore + 2);
  }
  if (nameScore !== null) return nameScore;
  if (descScore !== null) return descScore + 2;
  return null;
}

// ─── List building ───────────────────────────────

export function buildEntries(
  query: string,
  workflows: PickerWorkflow[],
): ListEntry[] {
  type Scored = { wf: PickerWorkflow; score: number };
  const scored: Scored[] = [];
  for (const wf of workflows) {
    const score = combinedFuzzyScore(query, wf.name, wf.description ?? "");
    if (score !== null) scored.push({ wf, score });
  }

  if (query === "") {
    const rest: ListEntry[] = [];
    for (const agent of AGENT_ORDER) {
      const group = scored
        .filter((s) => s.wf.agent === agent)
        .sort((a, b) => a.wf.name.localeCompare(b.wf.name));
      for (const s of group) rest.push({ workflow: s.wf, section: agent });
    }
    return rest;
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.map<ListEntry>((s) => ({
    workflow: s.wf,
    section: s.wf.agent,
  }));
}

export function buildRows(entries: ListEntry[], query: string): ListRow[] {
  const rows: ListRow[] = [];
  if (query === "") {
    let lastSection: string | null = null;
    for (const e of entries) {
      if (e.section !== lastSection) {
        rows.push({ kind: "section", agent: e.section });
        lastSection = e.section;
      }
      rows.push({ kind: "entry", entry: e });
    }
  } else {
    for (const e of entries) rows.push({ kind: "entry", entry: e });
  }
  return rows;
}

/**
 * Build the unified navigable list of `PickerRow` entries from healthy
 * workflows and a broken index. Broken rows are matched by alias + agent
 * against the query the same way healthy rows are.
 *
 * The returned array is the authoritative navigation list — arrow key
 * indices run over it directly (no separate entry array).
 */
export function buildPickerRows(
  query: string,
  workflows: PickerWorkflow[],
  brokenIndex: ReadonlyMap<string, BrokenWorkflow> = new Map(),
): PickerRow[] {
  type Scored = { row: PickerRow; score: number };
  const scored: Scored[] = [];

  for (const wf of workflows) {
    const score = combinedFuzzyScore(query, wf.name, wf.description ?? "");
    if (score !== null) scored.push({ row: { kind: "healthy", wf }, score });
  }

  for (const [key, broken] of brokenIndex) {
    const slash = key.indexOf("/");
    if (slash === -1) continue;
    const agent = key.slice(0, slash) as AgentType;
    const alias = key.slice(slash + 1);
    const score = fuzzyMatch(query, alias);
    if (score !== null) {
      scored.push({ row: { kind: "broken", alias, agent, broken }, score });
    }
  }

  // With query: pure score sort, broken interleaved with healthy.
  if (query !== "") {
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.row);
  }

  // Empty query: group by agent in canonical order; healthy before broken
  // per agent; alphabetic within each sub-group.
  const rowAgent = (row: PickerRow): AgentType =>
    row.kind === "healthy" ? row.wf.agent : row.agent;
  const sortKey = (row: PickerRow): string =>
    row.kind === "healthy" ? row.wf.name : row.alias;
  const byKey = (a: { row: PickerRow }, b: { row: PickerRow }): number =>
    sortKey(a.row).localeCompare(sortKey(b.row));

  const rows: PickerRow[] = [];
  for (const agent of AGENT_ORDER) {
    const inAgent = scored.filter((s) => rowAgent(s.row) === agent);
    const healthy = inAgent.filter((s) => s.row.kind === "healthy").sort(byKey);
    const broken = inAgent.filter((s) => s.row.kind === "broken").sort(byKey);
    for (const s of healthy) rows.push(s.row);
    for (const s of broken) rows.push(s.row);
  }
  return rows;
}

// ─── Validation ──────────────────────────────────

export function isFieldValid(field: WorkflowInput, value: string): boolean {
  if (field.type === "integer") {
    const trimmed = value.trim();
    if (trimmed === "") return !field.required;
    const parsed = Number.parseInt(trimmed, 10);
    return (
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      String(parsed) === trimmed
    );
  }
  if (!field.required) return true;
  if (field.type === "enum") return value !== "";
  return value.trim() !== "";
}
