import type {
	BindingContext,
	GlobalSelector,
	PerTabBindingContext,
	PerTabSelector,
} from "../state/selectors/contract.js";
import type { QuestionnaireState } from "../state/state.js";
import type { StatefulView } from "./stateful-view.js";
import type { TabComponents } from "./tab-components.js";

export interface ComponentBinding<P> {
	readonly component: StatefulView<P>;
	readonly select: GlobalSelector<P>;
}

export interface PerTabBinding<P> {
	readonly resolve: (tab: TabComponents) => StatefulView<P> | undefined;
	readonly select: PerTabSelector<P>;
	readonly predicate?: PerTabSelector<boolean>;
}

export interface BoundGlobalBinding {
	apply(state: QuestionnaireState, ctx: BindingContext): void;
	invalidate(): void;
}

export interface BoundPerTabBinding {
	apply(state: QuestionnaireState, ctx: PerTabBindingContext): void;
}

export function globalBinding<P>(spec: ComponentBinding<P>): BoundGlobalBinding {
	return {
		apply: (state, ctx) => spec.component.setProps(spec.select(state, ctx)),
		invalidate: () => spec.component.invalidate(),
	};
}

export function perTabBinding<P>(spec: PerTabBinding<P>): BoundPerTabBinding {
	return {
		apply: (state, ctx) => {
			if (spec.predicate && !spec.predicate(state, ctx)) return;
			spec.resolve(ctx.tab)?.setProps(spec.select(state, ctx));
		},
	};
}
