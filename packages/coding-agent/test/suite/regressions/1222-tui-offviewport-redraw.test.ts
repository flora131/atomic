import { afterEach, describe, expect, it } from "vitest";
import { type Component, type Terminal, TUI } from "@earendil-works/pi-tui";

const FULL_CLEAR_SEQUENCE = "\x1b[2J\x1b[H\x1b[3J";
const OFFSCREEN_UPDATE = "line 55 offscreen update";
const VISIBLE_UPDATE = "line 75 visible update";
const REPEATED_SEPARATOR_ROW = "------------------------------";
const RENDER_SETTLE_MS = 35;

class FakeTerminal implements Terminal {
	columns = 80;
	rows = 10;
	kittyProtocolActive = true;
	writes: string[] = [];

	start(): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.writes.push(data);
	}
	moveBy(_lines: number): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(_title: string): void {}
	setProgress(_active: boolean): void {}

	get fullClearCount(): number {
		return this.writes.filter((write) => write.includes(FULL_CLEAR_SEQUENCE)).length;
	}
}

class MutableLines implements Component {
	constructor(private readonly lines: string[]) {}

	render(_width: number): string[] {
		return [...this.lines];
	}

	invalidate(): void {}

	setLine(index: number, value: string): void {
		this.lines[index] = value;
	}

	appendLine(value: string): void {
		this.lines.push(value);
	}

	insertLine(index: number, value: string): void {
		this.lines.splice(index, 0, value);
	}

	removeLine(index: number): void {
		this.lines.splice(index, 1);
	}
}

type RenderBaseline = {
	fullRedraws: number;
	fullClearCount: number;
	writeStart: number;
};

const activeTuis: TUI[] = [];

afterEach(() => {
	for (const tui of activeTuis.splice(0)) {
		tui.stop();
	}
});

async function waitForRender(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));
}

async function requestRenderAndWait(tui: TUI): Promise<void> {
	tui.requestRender();
	await waitForRender();
}

function createLines(count: number): string[] {
	return Array.from({ length: count }, (_, index) => `line ${index.toString().padStart(2, "0")}`);
}

function createLinesWithRepeatedTail(repeatedTailStart: number, repeatedRow: string): string[] {
	const lines = createLines(80);
	for (let index = repeatedTailStart; index < lines.length; index += 1) {
		lines[index] = repeatedRow;
	}
	return lines;
}

async function startTui(component: Component, terminal = new FakeTerminal()): Promise<{ terminal: FakeTerminal; tui: TUI }> {
	const tui = new TUI(terminal);
	activeTuis.push(tui);
	tui.addChild(component);
	tui.start();
	await waitForRender();
	return { terminal, tui };
}

function captureRenderBaseline(tui: TUI, terminal: FakeTerminal): RenderBaseline {
	return {
		fullRedraws: tui.fullRedraws,
		fullClearCount: terminal.fullClearCount,
		writeStart: terminal.writes.length,
	};
}

function expectNoFullRedrawOrClear(tui: TUI, terminal: FakeTerminal, baseline: RenderBaseline): void {
	expect(tui.fullRedraws).toBe(baseline.fullRedraws);
	expect(terminal.fullClearCount).toBe(baseline.fullClearCount);
}

function expectOneFullRedrawAndClear(tui: TUI, terminal: FakeTerminal, baseline: RenderBaseline): void {
	expect(tui.fullRedraws).toBe(baseline.fullRedraws + 1);
	expect(terminal.fullClearCount).toBe(baseline.fullClearCount + 1);
}

function writesAfter(terminal: FakeTerminal, baseline: RenderBaseline): string {
	return terminal.writes.slice(baseline.writeStart).join("");
}

function expectDifferentialWrites(tui: TUI, terminal: FakeTerminal, baseline: RenderBaseline): string {
	const mutationWrites = writesAfter(terminal, baseline);
	expectNoFullRedrawOrClear(tui, terminal, baseline);
	expect(mutationWrites).not.toContain(FULL_CLEAR_SEQUENCE);
	return mutationWrites;
}

function expectFullClearWrites(tui: TUI, terminal: FakeTerminal, baseline: RenderBaseline): string {
	const mutationWrites = writesAfter(terminal, baseline);
	expectOneFullRedrawAndClear(tui, terminal, baseline);
	expect(mutationWrites).toContain(FULL_CLEAR_SEQUENCE);
	return mutationWrites;
}

describe("pi-tui off-viewport redraw behavior", () => {
	it("does not full-clear scrollback for an off-viewport same-shape text mutation", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(55, "line 55 updated");
		await requestRenderAndWait(tui);

		expectNoFullRedrawOrClear(tui, terminal, baseline);
	});

	it("renders append-only tail growth without full-clearing off-viewport text mutations", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(55, OFFSCREEN_UPDATE);
		component.appendLine("line 80 appended");
		await requestRenderAndWait(tui);

		const mutationWrites = expectDifferentialWrites(tui, terminal, baseline);
		expect(mutationWrites).toContain("line 80 appended");
		expect(mutationWrites).not.toContain(OFFSCREEN_UPDATE);
	});

	it("renders duplicate previous-tail append-only rows without full-clearing off-viewport text mutations", async () => {
		const lines = createLines(80);
		const duplicatedTail = lines[lines.length - 1];
		const component = new MutableLines(lines);
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(55, OFFSCREEN_UPDATE);
		component.appendLine(duplicatedTail);
		await requestRenderAndWait(tui);

		const mutationWrites = expectDifferentialWrites(tui, terminal, baseline);
		expect(mutationWrites).toContain(duplicatedTail);
		expect(mutationWrites).not.toContain(OFFSCREEN_UPDATE);
	});

	it("renders pure append-only separator growth without full-clearing a repeated tail", async () => {
		const component = new MutableLines(createLinesWithRepeatedTail(55, REPEATED_SEPARATOR_ROW));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.appendLine(REPEATED_SEPARATOR_ROW);
		await requestRenderAndWait(tui);

		const mutationWrites = expectDifferentialWrites(tui, terminal, baseline);
		expect(mutationWrites).toContain(REPEATED_SEPARATOR_ROW);
	});

	it("renders repeated-tail append after an off-viewport mutation when a unique same-index anchor proves append-only alignment", async () => {
		const component = new MutableLines(createLinesWithRepeatedTail(57, REPEATED_SEPARATOR_ROW));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(55, OFFSCREEN_UPDATE);
		component.appendLine(REPEATED_SEPARATOR_ROW);
		await requestRenderAndWait(tui);

		const mutationWrites = expectDifferentialWrites(tui, terminal, baseline);
		expect(mutationWrites).toContain(REPEATED_SEPARATOR_ROW);
		expect(mutationWrites).not.toContain(OFFSCREEN_UPDATE);
	});

	it("full-clears ambiguous repeated-tail growth after an off-viewport mutation", async () => {
		const component = new MutableLines(createLinesWithRepeatedTail(55, REPEATED_SEPARATOR_ROW));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		// Rendered text has no row identity here: this mutation plus append is
		// indistinguishable from a structural insertion into the repeated tail.
		component.setLine(60, "line 60 repeated-block update");
		component.appendLine(REPEATED_SEPARATOR_ROW);
		await requestRenderAndWait(tui);

		expectFullClearWrites(tui, terminal, baseline);
	});

	it("renders visible pre-existing mutations and append-only tail growth without full-clearing off-viewport text mutations", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(55, OFFSCREEN_UPDATE);
		component.setLine(75, VISIBLE_UPDATE);
		component.appendLine("line 80 appended");
		await requestRenderAndWait(tui);

		const mutationWrites = expectDifferentialWrites(tui, terminal, baseline);
		expect(mutationWrites).not.toContain(OFFSCREEN_UPDATE);
		expect(mutationWrites).toContain(VISIBLE_UPDATE);
		expect(mutationWrites).toContain("line 80 appended");
	});

	it("renders append-only growth after a boundary offscreen mutation when no shifted structural evidence exists", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		const boundaryUpdate = "line 69 offscreen boundary update";
		const appendedLine = "line 80 appended";
		component.setLine(69, boundaryUpdate);
		component.setLine(75, VISIBLE_UPDATE);
		component.appendLine(appendedLine);
		await requestRenderAndWait(tui);

		const mutationWrites = expectDifferentialWrites(tui, terminal, baseline);
		expect(mutationWrites).not.toContain(boundaryUpdate);
		expect(mutationWrites).toContain(VISIBLE_UPDATE);
		expect(mutationWrites).toContain(appendedLine);
	});

	it("full-clears structural insertion above the viewport even when visible mutations manufacture a same-index anchor", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.insertLine(69, "inserted structural row");
		component.setLine(79, "line 79");
		component.setLine(80, "changed shifted tail");
		await requestRenderAndWait(tui);

		const mutationWrites = expectFullClearWrites(tui, terminal, baseline);
		expect(mutationWrites).toContain("inserted structural row");
	});

	it("preserves full clear behavior for a later structural insertion after an off-viewport mutation", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(55, OFFSCREEN_UPDATE);
		component.insertLine(65, "inserted structural row");
		await requestRenderAndWait(tui);

		expectFullClearWrites(tui, terminal, baseline);
	});

	it("preserves full clear behavior for repeated-row structural insertion above the viewport", async () => {
		const lines = createLines(80);
		lines[59] = "repeated row";
		lines[60] = "repeated row";
		const component = new MutableLines(lines);
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.insertLine(55, "inserted structural row");
		await requestRenderAndWait(tui);

		expectFullClearWrites(tui, terminal, baseline);
	});

	it("preserves full clear behavior for structural insertion into a fully repeated tail above the viewport", async () => {
		const component = new MutableLines(createLinesWithRepeatedTail(55, REPEATED_SEPARATOR_ROW));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.insertLine(65, "inserted structural row");
		await requestRenderAndWait(tui);

		const mutationWrites = expectFullClearWrites(tui, terminal, baseline);
		expect(mutationWrites).toContain("inserted structural row");
	});

	it("preserves full clear behavior for off-viewport shrink/deletion", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.removeLine(55);
		await requestRenderAndWait(tui);

		expectOneFullRedrawAndClear(tui, terminal, baseline);
	});

	it("clamps mixed off-viewport and visible mutations to the visible viewport", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(55, OFFSCREEN_UPDATE);
		component.setLine(75, VISIBLE_UPDATE);
		await requestRenderAndWait(tui);

		const mutationWrites = expectDifferentialWrites(tui, terminal, baseline);
		expect(mutationWrites).not.toContain(OFFSCREEN_UPDATE);
		expect(mutationWrites).toContain(VISIBLE_UPDATE);
	});

	it("repaints visible mutations differentially", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(75, VISIBLE_UPDATE);
		await requestRenderAndWait(tui);

		const mutationWrites = expectDifferentialWrites(tui, terminal, baseline);
		expect(mutationWrites).toContain(VISIBLE_UPDATE);
	});

	it("preserves full clear behavior for terminal width changes", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		terminal.columns = 100;
		await requestRenderAndWait(tui);

		expectOneFullRedrawAndClear(tui, terminal, baseline);
	});
});
