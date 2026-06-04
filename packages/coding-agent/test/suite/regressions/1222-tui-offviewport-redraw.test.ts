import { afterEach, describe, expect, it } from "vitest";
import { type Component, type Terminal, TUI } from "@earendil-works/pi-tui";

const VIEWPORT_CLEAR_SEQUENCE = "\x1b[2J\x1b[H";
const SCROLLBACK_CLEAR_SEQUENCE = "\x1b[3J";
const VIEWPORT_AND_SCROLLBACK_CLEAR_SEQUENCE = `${VIEWPORT_CLEAR_SEQUENCE}${SCROLLBACK_CLEAR_SEQUENCE}`;
const OFFSCREEN_UPDATE = "line 55 offscreen update";
const VISIBLE_UPDATE = "line 75 visible update";
const ABOVE_VIEWPORT_INSERT = "line 69 inserted above viewport";
// Renders are throttled to TUI.MIN_RENDER_INTERVAL_MS (16ms): requestRender() defers through
// process.nextTick + setTimeout(max(0, 16 - elapsedSinceLastRender)), so a single non-force render
// can land up to ~16ms late. 35ms comfortably clears that throttle so one fixed wait reliably
// observes the throttled frame. (The sibling edit-tool-no-full-redraw test can use setTimeout(0)
// only because it polls render output inside a retry loop rather than waiting once.)
const RENDER_SETTLE_MS = 35;

class FakeTerminal implements Terminal {
	columns = 80;
	rows = 10;
	kittyProtocolActive = true;
	readonly writes: string[] = [];

	start(_onInput: (data: string) => void, _onResize: () => void): void {}
	stop(): void {}
	async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}
	write(data: string): void {
		this.writes.push(data);
	}
	moveBy(lines: number): void {
		if (lines > 0) {
			this.write(`\x1b[${lines}B`);
		} else if (lines < 0) {
			this.write(`\x1b[${-lines}A`);
		}
	}
	hideCursor(): void {
		this.write("\x1b[?25l");
	}
	showCursor(): void {
		this.write("\x1b[?25h");
	}
	clearLine(): void {
		this.write("\r\x1b[2K");
	}
	clearFromCursor(): void {
		this.write("\x1b[J");
	}
	clearScreen(): void {
		this.write(VIEWPORT_CLEAR_SEQUENCE);
	}
	setTitle(title: string): void {
		this.write(`\x1b]0;${title}\x07`);
	}
	setProgress(_active: boolean): void {}
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

	replaceLines(lines: string[]): void {
		this.lines.splice(0, this.lines.length, ...lines);
	}
}

type RenderBaseline = {
	fullRedraws: number;
	writeCount: number;
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
		writeCount: terminal.writes.length,
	};
}

function outputAfter(terminal: FakeTerminal, baseline: RenderBaseline): string {
	return terminal.writes.slice(baseline.writeCount).join("");
}

describe("pi-tui off-viewport redraw behavior", () => {
	it("writes zero bytes for strict off-viewport same-count changes", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(55, OFFSCREEN_UPDATE);
		await requestRenderAndWait(tui);

		const renderOutput = outputAfter(terminal, baseline);
		expect(tui.fullRedraws).toBe(baseline.fullRedraws);
		expect(terminal.writes).toHaveLength(baseline.writeCount);
		expect(renderOutput).toBe("");
		expect(renderOutput).not.toContain(VIEWPORT_CLEAR_SEQUENCE);
		expect(renderOutput).not.toContain(SCROLLBACK_CLEAR_SEQUENCE);
	});

	it("preserves scrollback for content-driven full redraws", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(55, OFFSCREEN_UPDATE);
		component.setLine(75, VISIBLE_UPDATE);
		await requestRenderAndWait(tui);

		const renderOutput = outputAfter(terminal, baseline);
		expect(tui.fullRedraws).toBe(baseline.fullRedraws + 1);
		expect(renderOutput).toContain(VIEWPORT_CLEAR_SEQUENCE);
		expect(renderOutput).not.toContain(SCROLLBACK_CLEAR_SEQUENCE);
		expect(renderOutput).toContain(VISIBLE_UPDATE);
	});

	it("wipes scrollback for terminal width changes", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		terminal.columns = 100;
		await requestRenderAndWait(tui);

		const renderOutput = outputAfter(terminal, baseline);
		expect(tui.fullRedraws).toBe(baseline.fullRedraws + 1);
		expect(renderOutput).toContain(VIEWPORT_AND_SCROLLBACK_CLEAR_SEQUENCE);
	});

	it("keeps pure visible changes on the differential path", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		component.setLine(75, VISIBLE_UPDATE);
		await requestRenderAndWait(tui);

		const renderOutput = outputAfter(terminal, baseline);
		expect(tui.fullRedraws).toBe(baseline.fullRedraws);
		expect(renderOutput).toContain(VISIBLE_UPDATE);
		expect(renderOutput).not.toContain(VIEWPORT_CLEAR_SEQUENCE);
		expect(renderOutput).not.toContain(SCROLLBACK_CLEAR_SEQUENCE);
	});

	it("does not repeatedly clear after clearOnShrink handles a shorter render", async () => {
		const component = new MutableLines(createLines(20));
		const { terminal, tui } = await startTui(component);
		tui.setClearOnShrink(true);
		const shrinkBaseline = captureRenderBaseline(tui, terminal);

		component.replaceLines(createLines(5));
		await requestRenderAndWait(tui);

		const shrinkOutput = outputAfter(terminal, shrinkBaseline);
		expect(tui.fullRedraws).toBe(shrinkBaseline.fullRedraws + 1);
		expect(shrinkOutput).toContain(VIEWPORT_CLEAR_SEQUENCE);
		expect(shrinkOutput).not.toContain(SCROLLBACK_CLEAR_SEQUENCE);

		const noopBaseline = captureRenderBaseline(tui, terminal);
		await requestRenderAndWait(tui);

		const noopOutput = outputAfter(terminal, noopBaseline);
		expect(tui.fullRedraws).toBe(noopBaseline.fullRedraws);
		expect(noopOutput).not.toContain(VIEWPORT_CLEAR_SEQUENCE);
		expect(noopOutput).not.toContain(SCROLLBACK_CLEAR_SEQUENCE);
	});

	it("render following a skipped off-viewport frame lands on the correct row", async () => {
		// 80-line buffer in a 10-row terminal => viewport is rows 70-79 (prevViewportTop = 70),
		// and the hardware cursor is parked on the bottom visible row (index 79) after baseline.
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);

		// Frame 1: a strictly off-viewport, same-line-count mutation hits the no-write skip.
		// commitState() advances cursorRow but intentionally does not move the hardware cursor.
		const skipBaseline = captureRenderBaseline(tui, terminal);
		component.setLine(55, OFFSCREEN_UPDATE);
		await requestRenderAndWait(tui);

		const skipOutput = outputAfter(terminal, skipBaseline);
		expect(tui.fullRedraws).toBe(skipBaseline.fullRedraws);
		expect(terminal.writes).toHaveLength(skipBaseline.writeCount);
		expect(skipOutput).toBe("");

		// Frame 2: a visible mutation immediately after the skipped frame must still land on the
		// correct row using the bookkeeping commitState() left behind. The bottom visible row is
		// index 79 (screen row 9); index 75 is screen row 5, so the differential repaint must move
		// the cursor up exactly 4 rows. A stale cursor would emit the wrong move count here.
		const followUpBaseline = captureRenderBaseline(tui, terminal);
		component.setLine(75, VISIBLE_UPDATE);
		await requestRenderAndWait(tui);

		const followUpOutput = outputAfter(terminal, followUpBaseline);
		expect(tui.fullRedraws).toBe(followUpBaseline.fullRedraws);
		expect(followUpOutput).toContain(VISIBLE_UPDATE);
		expect(followUpOutput).toContain("\x1b[4A"); // cursor up 4 rows: bottom row 79 -> visible row 75
		expect(followUpOutput).toContain("\x1b[2K"); // clear + repaint the targeted visible row
		expect(followUpOutput).not.toContain(VIEWPORT_CLEAR_SEQUENCE);
		expect(followUpOutput).not.toContain(SCROLLBACK_CLEAR_SEQUENCE);
	});

	it("insert immediately above the viewport plus a visible mutation conservatively repaints the viewport without wiping scrollback", async () => {
		const component = new MutableLines(createLines(80));
		const { terminal, tui } = await startTui(component);
		const baseline = captureRenderBaseline(tui, terminal);

		// Insert a line immediately above the viewport (index 69, prevViewportTop is 70) AND mutate a
		// now-visible row. firstChanged (69) is above the viewport and the line count grows (80 -> 81),
		// so this is NOT the strict same-count off-viewport skip. Ambiguous above-viewport growth must
		// fall through to the conservative fullRender(true): clear the viewport but preserve scrollback.
		const grown = createLines(80);
		grown.splice(69, 0, ABOVE_VIEWPORT_INSERT);
		grown[76] = VISIBLE_UPDATE; // within the new viewport (rows 71-80)
		component.replaceLines(grown);
		await requestRenderAndWait(tui);

		const renderOutput = outputAfter(terminal, baseline);
		expect(tui.fullRedraws).toBe(baseline.fullRedraws + 1);
		expect(renderOutput).toContain(VIEWPORT_CLEAR_SEQUENCE); // viewport cleared
		expect(renderOutput).not.toContain(SCROLLBACK_CLEAR_SEQUENCE); // scrollback preserved (no ESC[3J)
		expect(renderOutput).toContain(VISIBLE_UPDATE);
	});
});
