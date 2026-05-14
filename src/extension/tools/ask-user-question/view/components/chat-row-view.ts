import type { Component } from "@earendil-works/pi-tui";
import type { StatefulView } from "../stateful-view.js";
import { WrappingSelect, type WrappingSelectItem, type WrappingSelectTheme } from "./wrapping-select.js";

/**
 * Per-tick projection of chat-row state. The chat row is a single-item
 * `WrappingSelect` rendered in the question-tab footer; it owns no per-tab
 * state — only `focused` (whether the chat row is the active focus target)
 * and `numbering` (display number aligned with the active tab's items).
 */
export interface ChatRowViewProps {
	focused: boolean;
	numbering: { offset: number; total: number };
}

export interface ChatRowViewConfig {
	/** The single chat sentinel row — `{kind: "chat", label: SENTINEL_LABELS.chat}`. */
	item: WrappingSelectItem;
	theme: WrappingSelectTheme;
}

/**
 * Typed wrapper around the chat-row `WrappingSelect`. Replaces the prior
 * raw-primitive consumption at `props-adapter.ts:106, :120` and removes the
 * accidental surface area (8 unused `WrappingSelect` setters) noted in
 * research Q4.
 *
 * Pattern modeled after `OptionListView` (`option-list-view.ts:27-93`):
 * mirror-then-delegate `setProps`; render is pure delegation; `Component`
 * triplet forwards.
 */
export class ChatRowView implements StatefulView<ChatRowViewProps>, Component {
	private readonly select: WrappingSelect;

	constructor(config: ChatRowViewConfig) {
		this.select = new WrappingSelect([config.item], 1, config.theme, {
			numberStartOffset: 0,
			totalItemsForNumbering: 1,
		});
	}

	setProps(props: ChatRowViewProps): void {
		this.select.setFocused(props.focused);
		this.select.setNumbering(props.numbering.offset, props.numbering.total);
	}

	handleInput(_data: string): void {}

	invalidate(): void {
		this.select.invalidate();
	}

	render(width: number): string[] {
		return this.select.render(width);
	}
}
