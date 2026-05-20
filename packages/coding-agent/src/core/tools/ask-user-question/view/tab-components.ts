import type { MultiSelectViewProps } from "./components/multi-select-view.ts";
import type { OptionListViewProps } from "./components/option-list-view.ts";
import type { PreviewPane } from "./components/preview/preview-pane.ts";
import type { StatefulView } from "./stateful-view.ts";

export interface TabBodyHeights {
	current: number;
	max: number;
}

export interface TabComponents {
	optionList: StatefulView<OptionListViewProps>;
	preview: PreviewPane;
	multiSelect?: StatefulView<MultiSelectViewProps>;
	bodyHeights: (width: number) => TabBodyHeights;
}
