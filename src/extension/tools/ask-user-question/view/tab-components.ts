import type { MultiSelectViewProps } from "./components/multi-select-view.js";
import type { OptionListViewProps } from "./components/option-list-view.js";
import type { PreviewPane } from "./components/preview/preview-pane.js";
import type { StatefulView } from "./stateful-view.js";

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
