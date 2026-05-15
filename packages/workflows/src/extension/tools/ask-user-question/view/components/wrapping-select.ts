import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/**
 * Row-intent discriminated union. `kind` is the single discriminator —
 * pre-1.0.3 boolean flags have been removed (see `banned-flags.test.ts`).
 * Modeled after `QuestionnaireAction` (`key-router.ts:13-32`) and `Effect`
 * (`state-reducer.ts:26-32`) — pure literal-tagged variants, no shared base,
 * exhaustive-`switch` enforcement via non-`void` returns.
 *
 * Variant semantics:
 * - `option`: a regular author-defined option row.
 * - `other`: the inline free-text input row appended to single-select questions
 *   (label is "Type something."). Renders as inline `Input` when active.
 * - `chat`: the abandon-questionnaire escape-hatch row (label is "Chat about this").
 * - `next`: the explicit commit-and-advance row appended to multi-select questions
 *   (label is "Next"). Renders without a number / checkbox.
 */
export type WrappingSelectItem =
	| { kind: "option"; label: string; description?: string }
	| { kind: "other"; label: string; description?: string }
	| { kind: "chat"; label: string; description?: string }
	| { kind: "next"; label: string; description?: string };

export interface WrappingSelectTheme {
	selectedText: (text: string) => string;
	description: (text: string) => string;
	scrollInfo: (text: string) => string;
}

/**
 * Numbering controls.
 *
 * Use `numberStartOffset` + `totalItemsForNumbering` when a list is logically a slice of a
 * larger numbered sequence — e.g. the chat row lives in its own WrappingSelect but should
 * render as `(N+1).` where N is the previous list's item count, with the column padded as
 * if both lists were one continuous numbered sequence.
 */
export interface WrappingSelectOptions {
	/** Start numbering at this offset + 1 (default 0 → rows labeled 1, 2, 3 …). */
	numberStartOffset?: number;
	/** Override the total used to pad the number column (useful when items span multiple lists). */
	totalItemsForNumbering?: number;
}

export class WrappingSelect implements Component {
	private static readonly ACTIVE_POINTER = "❯ ";
	private static readonly INACTIVE_POINTER = "  ";
	private static readonly NUMBER_SEPARATOR = ". ";
	private static readonly INPUT_CURSOR = "▌";
	private static readonly CONFIRMED_MARK = " ✔";
	private static readonly MIN_CONTENT_WIDTH = 1;

	private readonly items: readonly WrappingSelectItem[];
	private readonly maxVisible: number;
	private readonly theme: WrappingSelectTheme;
	private numberStartOffset: number;
	private totalItemsForNumbering: number;

	private selectedIndex = 0;
	private focused = true;
	private inputBuffer = "";
	/**
	 * Index of the row that was previously confirmed for this list (e.g. the user's prior
	 * answer when re-entering a multi-question tab). Renders `<label> ✔` in the active-row
	 * styling but WITHOUT the `❯` pointer — pointer is reserved for the live cursor. When
	 * `selectedIndex === confirmedIndex && focused`, the active rendering wins (no double-mark).
	 */
	private confirmedIndex: number | undefined = undefined;
	/**
	 * When set together with `confirmedIndex`, replaces the row's static label at render time.
	 * Used for the `kind: "other"` sentinel — its label is "Type something." but if the user's
	 * prior answer was custom text, we render that text instead (e.g. `4. Hello ✔`).
	 */
	private confirmedLabelOverride: string | undefined = undefined;

	constructor(
		items: readonly WrappingSelectItem[],
		maxVisible: number,
		theme: WrappingSelectTheme,
		options: WrappingSelectOptions = {},
	) {
		this.items = items;
		this.maxVisible = Math.max(1, maxVisible);
		this.theme = theme;
		this.numberStartOffset = options.numberStartOffset ?? 0;
		this.totalItemsForNumbering = options.totalItemsForNumbering ?? items.length;
	}

	/**
	 * Update the numbering offset + total padding width without rebuilding the component.
	 * Used by the host to keep the chat-row WrappingSelect's number aligned with the active tab's
	 * options list when the user switches tabs (each tab can have a different items count).
	 */
	setNumbering(numberStartOffset: number, totalItemsForNumbering: number): void {
		this.numberStartOffset = numberStartOffset;
		this.totalItemsForNumbering = Math.max(1, totalItemsForNumbering);
	}

	setSelectedIndex(index: number): void {
		this.selectedIndex = Math.max(0, Math.min(index, this.items.length - 1));
	}

	setFocused(focused: boolean): void {
		this.focused = focused;
	}

	/**
	 * Mark a previously-confirmed row. Pass `undefined` to clear. `labelOverride` replaces
	 * the row's static `item.label` at render time — used for the `kind: "other"` sentinel so
	 * the row reads `Hello ✔` instead of `Type something. ✔` when the prior answer was custom
	 * text.
	 */
	setConfirmedIndex(index: number | undefined, labelOverride?: string): void {
		if (index === undefined) {
			this.confirmedIndex = undefined;
			this.confirmedLabelOverride = undefined;
			return;
		}
		this.confirmedIndex = Math.max(0, Math.min(index, this.items.length - 1));
		this.confirmedLabelOverride = labelOverride;
	}

	setInputBuffer(text: string): void {
		this.inputBuffer = text;
	}

	/** Intentionally empty — input is routed at the container level. */
	handleInput(_data: string): void {}

	invalidate(): void {}

	render(width: number): string[] {
		if (this.items.length === 0) return [];

		const { startIndex, endIndex } = this.computeVisibleWindow();
		const numberWidth = String(Math.max(1, this.totalItemsForNumbering)).length;
		const lines: string[] = [];

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.items[i];
			if (!item) continue;
			const isActive = i === this.selectedIndex && this.focused;
			lines.push(...this.renderItem(item, i, isActive, width, numberWidth));
		}

		if (this.hasItemsOutsideWindow(startIndex, endIndex)) {
			lines.push(this.theme.scrollInfo(`  (${this.selectedIndex + 1}/${this.items.length})`));
		}
		return lines;
	}

	private computeVisibleWindow(): { startIndex: number; endIndex: number } {
		const half = Math.floor(this.maxVisible / 2);
		const startIndex = Math.max(0, Math.min(this.selectedIndex - half, this.items.length - this.maxVisible));
		const endIndex = Math.min(startIndex + this.maxVisible, this.items.length);
		return { startIndex, endIndex };
	}

	private hasItemsOutsideWindow(startIndex: number, endIndex: number): boolean {
		return startIndex > 0 || endIndex < this.items.length;
	}

	private renderItem(
		item: WrappingSelectItem,
		index: number,
		isActive: boolean,
		width: number,
		numberWidth: number,
	): string[] {
		const rowPrefix = this.buildRowPrefix(index, isActive, numberWidth);
		const continuationPrefix = " ".repeat(visibleWidth(rowPrefix));
		const contentWidth = Math.max(WrappingSelect.MIN_CONTENT_WIDTH, width - visibleWidth(rowPrefix));

		if (this.shouldRenderAsInlineInput(item, isActive)) {
			return this.renderInlineInputRow(rowPrefix, continuationPrefix, contentWidth);
		}

		// Confirmed row gets a trailing ` ✔` and accent+bold styling; pointer is independent
		// (still ❯ when active). When `index === confirmedIndex` AND `isActive`, both `❯` and
		// `✔` appear on the same row — load-bearing for the case where the prior answer was
		// row 0 (cursor resets to 0 on tab-back, so the confirmed row IS the active row).
		// Optional `confirmedLabelOverride` replaces the static label (used for `kind: "other"`
		// + `kind: "custom"` answer); the inline-input branch above still wins for `kind: "other" + isActive`.
		const isConfirmed = index === this.confirmedIndex;
		const label = isConfirmed
			? `${this.confirmedLabelOverride ?? item.label}${WrappingSelect.CONFIRMED_MARK}`
			: item.label;
		const applySelectedStyle = isActive || isConfirmed;

		return [
			...this.renderLabelBlock(label, rowPrefix, continuationPrefix, contentWidth, applySelectedStyle),
			...this.renderDescriptionBlock(item.description, continuationPrefix, contentWidth),
		];
	}

	private buildRowPrefix(index: number, isActive: boolean, numberWidth: number): string {
		const pointer = isActive ? WrappingSelect.ACTIVE_POINTER : WrappingSelect.INACTIVE_POINTER;
		const displayNumber = this.numberStartOffset + index + 1;
		const paddedNumber = String(displayNumber).padStart(numberWidth, " ");
		return `${pointer}${paddedNumber}${WrappingSelect.NUMBER_SEPARATOR}`;
	}

	private shouldRenderAsInlineInput(item: WrappingSelectItem, isActive: boolean): boolean {
		return item.kind === "other" && isActive;
	}

	/**
	 * Render the inline input row across one or more lines, wrapping at `contentWidth`
	 * so long input doesn't run off the right edge or trip the parent renderer's
	 * width invariant. Mirrors `renderLabelBlock`'s contract: first line carries
	 * `rowPrefix`, continuation lines carry `continuationPrefix` (spaces), and every
	 * emitted line passes through `theme.selectedText`. The trailing cursor glyph
	 * `▌` is appended to the buffer pre-wrap so it lands at the visual end of the
	 * input — `Input` only exposes `getValue()` (cursor offset is private), so
	 * cursor-mid-string is intentionally not rendered here; that would require
	 * either an `Input.getCursorOffset()` API or delegating to `Input.render`.
	 */
	private renderInlineInputRow(rowPrefix: string, continuationPrefix: string, contentWidth: number): string[] {
		const raw = `${this.inputBuffer}${WrappingSelect.INPUT_CURSOR}`;
		const wrapped = wrapTextWithAnsi(raw, contentWidth);
		return wrapped.map((segment, index) => {
			const prefix = index === 0 ? rowPrefix : continuationPrefix;
			return this.theme.selectedText(`${prefix}${segment}`);
		});
	}

	private renderLabelBlock(
		label: string,
		rowPrefix: string,
		continuationPrefix: string,
		contentWidth: number,
		applySelectedStyle: boolean,
	): string[] {
		const wrapped = wrapTextWithAnsi(label, contentWidth);
		return wrapped.map((segment, index) => {
			const prefix = index === 0 ? rowPrefix : continuationPrefix;
			const line = `${prefix}${segment}`;
			return applySelectedStyle ? this.theme.selectedText(line) : line;
		});
	}

	private renderDescriptionBlock(
		description: string | undefined,
		continuationPrefix: string,
		contentWidth: number,
	): string[] {
		if (!description) return [];
		const wrapped = wrapTextWithAnsi(description, contentWidth);
		return wrapped.map((segment) => `${continuationPrefix}${this.theme.description(segment)}`);
	}
}
