import type { QuestionData } from "../../tool/types.js";
import type { PreviewPaneProps } from "../../view/components/preview/preview-pane.js";
import type { WrappingSelectItem } from "../../view/components/wrapping-select.js";
import type { ActiveView, StatefulView } from "../../view/stateful-view.js";
import type { TabComponents } from "../../view/tab-components.js";
import type { QuestionnaireState } from "../state.js";

export interface BindingContext {
	readonly questions: readonly QuestionData[];
	readonly itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>;
	readonly totalQuestions: number;
	readonly activeView: ActiveView;
	readonly inputBuffer: string;
	readonly activePreviewPane: StatefulView<PreviewPaneProps>;
}

export interface PerTabBindingContext extends BindingContext {
	readonly tab: TabComponents;
	readonly i: number;
}

export type GlobalSelector<P> = (state: QuestionnaireState, ctx: BindingContext) => P;
export type PerTabSelector<P> = (state: QuestionnaireState, ctx: PerTabBindingContext) => P;
