import type {
  WorkflowCustomUiComponent,
  WorkflowCustomUiFactory,
  WorkflowCustomUiTheme,
} from "@bastani/workflows";

/**
 * Table-selector widget for the hil-custom-dummy workflow's ctx.ui.custom
 * prompt. Lives in lib/ (not scanned by workflow discovery, which only reads
 * top-level files) so the factory can be exported for standalone smoke tests
 * without tripping the "export is not an object" discovery diagnostic.
 */

export interface TableChoice {
  id: string;
  name: string;
}

interface ArtifactRow {
  id: string;
  name: string;
  status: "ready" | "signing" | "queued" | "failed";
  /** null = no artifact produced (failed/queued). */
  sizeMb: number | null;
  ageHours: number;
}

const ARTIFACTS: readonly ArtifactRow[] = [
  { id: "a1f3", name: "atomic-darwin-arm64", status: "ready", sizeMb: 48.2, ageHours: 3 },
  { id: "b7c9", name: "atomic-linux-x64", status: "ready", sizeMb: 52.7, ageHours: 7 },
  { id: "c2d4", name: "atomic-windows-x64", status: "signing", sizeMb: 55.1, ageHours: 1 },
  { id: "d9e1", name: "atomic-linux-arm64", status: "failed", sizeMb: null, ageHours: 26 },
  { id: "e5f8", name: "workflows-extension", status: "ready", sizeMb: 1.3, ageHours: 54 },
  { id: "f0a2", name: "subagents-extension", status: "queued", sizeMb: null, ageHours: 0.2 },
];

const SORT_MODES = ["original", "name", "status", "size", "age"] as const;
type SortMode = (typeof SORT_MODES)[number];

type ColumnKey = "id" | "name" | "status" | "size" | "age";
type Align = "left" | "right";

interface ColumnSpec {
  key: ColumnKey;
  label: string;
  width: number;
  align: Align;
}

type FgColor = Parameters<WorkflowCustomUiTheme["fg"]>[0];

function formatSize(row: ArtifactRow): string {
  return row.sizeMb === null ? "—" : `${row.sizeMb.toFixed(1)} MB`;
}

function formatAge(row: ArtifactRow): string {
  if (row.ageHours < 1) return "<1h";
  if (row.ageHours < 24) return `${Math.round(row.ageHours)}h`;
  return `${Math.round(row.ageHours / 24)}d`;
}

function statusColor(status: ArtifactRow["status"]): FgColor {
  switch (status) {
    case "ready":
      return "success";
    case "failed":
      return "error";
    default:
      return "warning";
  }
}

/** Pad/truncate plain (ANSI-free) text to an exact width. */
function fit(text: string, width: number, align: Align): string {
  const truncated = text.length > width ? (width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`) : text;
  return align === "right" ? truncated.padStart(width) : truncated.padEnd(width);
}

function sortRows(mode: SortMode): ArtifactRow[] {
  const rows = [...ARTIFACTS];
  switch (mode) {
    case "name":
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    case "status":
      return rows.sort((a, b) => a.status.localeCompare(b.status));
    case "size":
      return rows.sort((a, b) => (b.sizeMb ?? -1) - (a.sizeMb ?? -1));
    case "age":
      return rows.sort((a, b) => a.ageHours - b.ageHours);
    default:
      return rows;
  }
}

function buildColumns(viewportWidth: number): ColumnSpec[] {
  // Full table chrome (borders + cell padding) costs 42 cols beside NAME;
  // compact (ID/NAME/STATUS only) costs 24. Drop SIZE/AGE when tight.
  const compact = viewportWidth < 54;
  const fixedBesideName = compact ? 24 : 42;
  const nameWidth = Math.max(8, Math.min(26, Math.min(viewportWidth, 76) - fixedBesideName));
  const columns: ColumnSpec[] = [
    { key: "id", label: "ID", width: 6, align: "left" },
    { key: "name", label: "NAME", width: nameWidth, align: "left" },
    { key: "status", label: "STATUS", width: 8, align: "left" },
  ];
  if (!compact) {
    columns.push(
      { key: "size", label: "SIZE", width: 7, align: "right" },
      { key: "age", label: "AGE", width: 5, align: "right" },
    );
  }
  return columns;
}

function cellText(key: ColumnKey, row: ArtifactRow, selected: boolean): string {
  switch (key) {
    case "id":
      return `${selected ? "❯ " : "  "}${row.id}`;
    case "name":
      return row.name;
    case "status":
      return row.status;
    case "size":
      return formatSize(row);
    case "age":
      return formatAge(row);
  }
}

/**
 * Themed, sortable, responsive table selector. Receives the real
 * (tui, theme, keybindings, done) types from ctx.ui.custom.
 */
export const tableSelectorFactory: WorkflowCustomUiFactory<TableChoice> = (
  tui,
  theme,
  _keybindings,
  done,
): WorkflowCustomUiComponent => {
  let selected = 0;
  let sortIndex = 0;

  const move = (delta: number): void => {
    selected = (selected + ARTIFACTS.length + delta) % ARTIFACTS.length;
    tui.requestRender();
  };

  const jump = (index: number): void => {
    selected = Math.max(0, Math.min(ARTIFACTS.length - 1, index));
    tui.requestRender();
  };

  return {
    render(width: number): string[] {
      const columns = buildColumns(width);
      const sortMode = SORT_MODES[sortIndex]!;
      const rows = sortRows(sortMode);
      const borderH = (left: string, mid: string, right: string): string =>
        theme.fg("border", left + columns.map((c) => "─".repeat(c.width + 2)).join(mid) + right);
      const sep = theme.fg("border", "│");

      const headerCells = columns
        .map((c) => {
          const label = c.key === sortMode ? `${c.label} ▲` : c.label;
          return ` ${theme.bold(theme.fg("accent", fit(label, c.width, c.align)))} `;
        })
        .join(sep);

      const dataLines = rows.map((row, i) => {
        const isSelected = i === selected;
        const inner = columns
          .map((c) => {
            const plain = fit(cellText(c.key, row, isSelected), c.width, c.align);
            let styled: string;
            if (c.key === "status") {
              styled = theme.fg(statusColor(row.status), plain);
            } else if (c.key === "name" && isSelected) {
              styled = theme.bold(theme.fg("text", plain));
            } else {
              styled = theme.fg(isSelected ? "text" : "muted", plain);
            }
            return ` ${styled} `;
          })
          .join(isSelected ? "│" : sep);
        const body = isSelected ? theme.bg("selectedBg", inner) : inner;
        return sep + body + sep;
      });

      const title =
        theme.bold(theme.fg("accent", "hil-custom-dummy")) + theme.fg("muted", " · pick a build artifact");
      const fullHints = `↑/↓ j/k move · 1-${ARTIFACTS.length} jump · g/G ends · s sort (${sortMode}) · enter select`;
      const shortHints = `↑/↓ move · s sort (${sortMode}) · enter select`;
      const hintText = fullHints.length <= width ? fullHints : shortHints;
      const hints = theme.fg("muted", hintText.length > width ? `${hintText.slice(0, Math.max(0, width - 1))}…` : hintText);

      return [
        title,
        borderH("┌", "┬", "┐"),
        sep + headerCells + sep,
        borderH("├", "┼", "┤"),
        ...dataLines,
        borderH("└", "┴", "┘"),
        hints,
      ];
    },
    invalidate(): void {},
    handleInput(data: string): void {
      switch (data) {
        case "\x1b[A":
        case "\x1bOA":
        case "k":
          move(-1);
          return;
        case "\x1b[B":
        case "\x1bOB":
        case "j":
          move(1);
          return;
        case "\x1b[H":
        case "\x1b[1~":
        case "g":
          jump(0);
          return;
        case "\x1b[F":
        case "\x1b[4~":
        case "G":
          jump(ARTIFACTS.length - 1);
          return;
        case "s":
          sortIndex = (sortIndex + 1) % SORT_MODES.length;
          tui.requestRender();
          return;
        case "\r":
        case "\n": {
          const row = sortRows(SORT_MODES[sortIndex]!)[selected]!;
          done({ id: row.id, name: row.name });
          return;
        }
        default: {
          const digit = Number.parseInt(data, 10);
          if (Number.isInteger(digit) && digit >= 1 && digit <= ARTIFACTS.length) {
            jump(digit - 1);
          }
        }
      }
    },
  };
};
