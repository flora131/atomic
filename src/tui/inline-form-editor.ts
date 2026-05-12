/**
 * Custom `EditorComponent` swapped in via `ctx.ui.setEditorComponent` while
 * an inline workflow form is active. Owns ALL keystrokes during fill-out:
 *
 *   tab / shift+tab     — move focus across form fields (NOT editor lines)
 *   ↑/↓                 — move focus
 *   ←/→                 — caret nav (text) | choice cycle (select) | flip (bool)
 *   space               — boolean toggle
 *   enter               — newline (text) | submit (others move to next field)
 *   backspace           — delete char left of caret
 *   printable ASCII     — insert at caret (text/string/number)
 *   ctrl+s              — submit form (if valid)
 *   esc                 — cancel form
 *
 * On submit/cancel the editor calls back to the orchestrator which:
 *   1. Marks the form state finalized (renderer flips to frozen view)
 *   2. Restores the previously-installed editor via `setEditorComponent`
 *   3. Resolves the open() promise so the slash command can proceed
 *
 * Render: intentionally returns no rows. The chat-history card is the single
 * visible editing surface; this component is a headless keystroke router so
 * the bottom editor does not duplicate the active argument box. No autocomplete,
 * history, paste markers, or kill-rings — we deliberately skip the heavy
 * `Editor` base class for predictable per-field behaviour.
 *
 * cross-ref:
 *  - src/tui/inputs-picker.ts (handler logic shared, adapted here)
 *  - @earendil-works/pi-tui EditorComponent interface
 */

import type { PiEditorComponent } from "../extension/wiring.js";
import type { GraphTheme } from "./graph-theme.js";
import type { WorkflowInputEntry } from "../extension/render-result.js";
import type { InlineFormState } from "./inline-form-store.js";
import { getForm, touch } from "./inline-form-store.js";
import { matchesKey } from "./text-helpers.js";

export type FormEditorOutcome = "submit" | "cancel";

export interface InlineFormEditorOpts {
  formId: string;
  theme: GraphTheme;
  /** Called when ctrl+s passes validation or esc fires. Triggers cleanup. */
  onExit: (outcome: FormEditorOutcome) => void;
}

/**
 * Minimal `PiEditorComponent` implementation. The pi-tui interface requires
 * `getText` / `setText` / `handleInput` / `render` / `invalidate`. We satisfy
 * them with no-ops where the host doesn't really need them during form mode
 * (no autocomplete, no history, no `onSubmit` handler).
 */
export class InlineFormEditor implements PiEditorComponent {
  /** Required by Focusable; we always have focus during the form. */
  focused = true;

  private readonly tui: { requestRender?: () => void };
  private readonly opts: InlineFormEditorOpts;

  // EditorComponent optional hooks — we don't use them.
  onSubmit?: (text: string) => void;
  onChange?: (text: string) => void;

  onAutocompleteCancel?: () => void;
  onAutocompleteUpdate?: () => void;

  private useTerminalCursor = false;
  private autocompleteMaxVisible = 5;
  private readonly customKeyHandlers = new Map<string, () => void>();
  constructor(tui: { requestRender?: () => void }, opts: InlineFormEditorOpts) {
    this.tui = tui;
    this.opts = opts;
  }

  // ── EditorComponent surface ───────────────────────────────────────────

  getText(): string {
    // Used by pi when the user submits via the default editor. We never
    // submit via this path, so return empty.
    return "";
  }

  setText(_text: string): void {
    // Programmatic insertion isn't meaningful for a typed-field editor.
  }

  invalidate(): void {
    // We rebuild from state on every render — nothing to invalidate.
  }

  setUseTerminalCursor(useTerminalCursor: boolean): void {
    this.useTerminalCursor = useTerminalCursor;
  }

  getUseTerminalCursor(): boolean {
    return this.useTerminalCursor;
  }

  setAutocompleteMaxVisible(maxVisible: number): void {
    this.autocompleteMaxVisible = Number.isFinite(maxVisible)
      ? Math.max(3, Math.min(20, Math.floor(maxVisible)))
      : 5;
  }

  getAutocompleteMaxVisible(): number {
    return this.autocompleteMaxVisible;
  }

  setMaxHeight(_maxHeight: number | undefined): void {
    // The inline editor renders no rows; the chat-history card owns height.
  }

  // Called by InteractiveMode.updateEditorTopBorder after a resize. We render
  // zero rows so any border content is visually irrelevant — accept and drop.
  setTopBorder(_content: unknown): void {
    // No-op: host resize-handler contract, not part of the PiEditorComponent shape.
  }

  // Called by InteractiveMode resize handler to size the status-line top border.
  // Our editor draws no chrome (no border glyphs, no padding), so the full
  // terminal width is available. Guard against non-finite/negative inputs.
  getTopBorderAvailableWidth(terminalWidth: number): number {
    // Host resize-handler contract, not part of the PiEditorComponent shape.
    return Number.isFinite(terminalWidth) ? Math.max(0, terminalWidth) : 0;
  }

  setHistoryStorage(_storage: object): void {
    // Field editing is transient and should not pollute prompt history.
  }

  setActionKeys(_action: string, _keys: readonly string[]): void {
    // App-level action key routing is intentionally bypassed during form input.
  }

  setCustomKeyHandler(key: string, handler: () => void): void {
    this.customKeyHandlers.set(key, handler);
  }

  removeCustomKeyHandler(key: string): void {
    this.customKeyHandlers.delete(key);
  }

  clearCustomKeyHandlers(): void {
    this.customKeyHandlers.clear();
  }

  setAutocompleteProvider(_provider: object): void {
    // Autocomplete belongs to the default chat editor, not the field router.
  }

  addToHistory(_text: string): void {
    // Field editing is transient and should not pollute prompt history.
  }

  insertTextAtCursor(text: string): void {
    this.handleInput(text);
  }

  getExpandedText(): string {
    return this.getText();
  }

  dispose?(): void {
    // No resources to release; present for host symmetry with visible editors.
  }

  render(_width: number): string[] {
    // Keep the replacement editor mounted only to receive keyboard input.
    // The inline chat card above is the canonical visual surface for field
    // focus, values, validation, and submission hints. Rendering zero rows
    // removes the duplicate bottom argument box shown by the old editor body.
    return [];
  }

  handleInput(data: string): void {
    const state = getForm(this.opts.formId);
    if (!state || state.status !== "editing") return;
    const consumed = this.routeKey(data, state);
    if (consumed) {
      touch(state);
      this.tui.requestRender?.();
    }
  }

  // ── Key routing ───────────────────────────────────────────────────────

  /**
   * Returns true when the key was meaningful (consumed) and the host
   * should re-render. False for unknown keys that we silently drop —
   * pi-tui has no parent editor to forward to, and the heavy default
   * editor's behaviours (autocomplete, kill-rings) aren't appropriate
   * for a typed-field form.
   */
  private routeKey(data: string, state: InlineFormState): boolean {
    // Globals first. matchesKey covers escape; ctrl+s / tab / shift+tab
    // aren't in the local matchesKey table so we still hit the raw bytes.
    if (matchesKey(data, "escape")) {
      this.opts.onExit("cancel");
      return true;
    }
    if (data === "\x13") {
      // ctrl+s — try to submit
      if (this.allValid(state)) this.opts.onExit("submit");
      return true;
    }
    if (data === "\t") {
      this.moveFocus(state, +1);
      return true;
    }
    if (data === "\x1b[Z") {
      this.moveFocus(state, -1);
      return true;
    }

    const field = state.fields[state.focusedIdx];
    if (!field) return false;

    if (field.type === "select") return this.handleSelect(data, field, state);
    if (field.type === "boolean") return this.handleBoolean(data, field, state);
    return this.handleText(data, field, state);
  }

  private handleSelect(
    data: string,
    field: WorkflowInputEntry,
    state: InlineFormState,
  ): boolean {
    const choices = field.choices ?? [];
    if (choices.length === 0) return false;
    const cur = state.rawText[field.name] ?? choices[0]!;
    const i = Math.max(0, choices.indexOf(cur));
    if (matchesKey(data, "left") || matchesKey(data, "h")) {
      state.rawText[field.name] = choices[(i - 1 + choices.length) % choices.length]!;
      return true;
    }
    if (matchesKey(data, "right") || matchesKey(data, "l") || data === " ") {
      state.rawText[field.name] = choices[(i + 1) % choices.length]!;
      return true;
    }
    if (matchesKey(data, "up")) { this.moveFocus(state, -1); return true; }
    if (matchesKey(data, "down") || matchesKey(data, "enter")) {
      this.moveFocus(state, +1);
      return true;
    }
    return false;
  }

  private handleBoolean(
    data: string,
    field: WorkflowInputEntry,
    state: InlineFormState,
  ): boolean {
    if (data === " " || matchesKey(data, "left") || matchesKey(data, "right")) {
      state.rawText[field.name] = state.rawText[field.name] === "true" ? "false" : "true";
      return true;
    }
    if (matchesKey(data, "up")) { this.moveFocus(state, -1); return true; }
    if (matchesKey(data, "down") || matchesKey(data, "enter")) {
      this.moveFocus(state, +1);
      return true;
    }
    return false;
  }

  private handleText(
    data: string,
    field: WorkflowInputEntry,
    state: InlineFormState,
  ): boolean {
    const name = field.name;
    const cur = state.rawText[name] ?? "";
    if (matchesKey(data, "up")) { this.moveFocus(state, -1); return true; }
    if (matchesKey(data, "down")) { this.moveFocus(state, +1); return true; }
    if (matchesKey(data, "left")) {
      state.caret = Math.max(0, state.caret - 1);
      return true;
    }
    if (matchesKey(data, "right")) {
      state.caret = Math.min(cur.length, state.caret + 1);
      return true;
    }
    if (data === "\x7f" || data === "\b") {
      if (state.caret > 0) {
        state.rawText[name] = cur.slice(0, state.caret - 1) + cur.slice(state.caret);
        state.caret -= 1;
      }
      return true;
    }
    if (matchesKey(data, "enter")) {
      if (field.type === "text") {
        state.rawText[name] = cur.slice(0, state.caret) + "\n" + cur.slice(state.caret);
        state.caret += 1;
      } else {
        this.moveFocus(state, +1);
      }
      return true;
    }
    if (data.length === 1 && data >= " " && data <= "~") {
      state.rawText[name] = cur.slice(0, state.caret) + data + cur.slice(state.caret);
      state.caret += 1;
      return true;
    }
    return false;
  }

  private moveFocus(state: InlineFormState, delta: number): void {
    const n = state.fields.length;
    state.focusedIdx = (state.focusedIdx + delta + n) % n;
    const next = state.fields[state.focusedIdx]!;
    state.caret = (state.rawText[next.name] ?? "").length;
  }

  private allValid(state: InlineFormState): boolean {
    for (const f of state.fields) {
      const v = state.rawText[f.name] ?? "";
      if (f.required && v.trim() === "") return false;
      if (
        (f.type === "number" || f.type === "integer") &&
        v !== "" &&
        !Number.isFinite(Number(v))
      ) {
        return false;
      }
      if (
        f.type === "select" &&
        f.choices &&
        v !== "" &&
        !f.choices.includes(v)
      ) {
        return false;
      }
    }
    return true;
  }
}

