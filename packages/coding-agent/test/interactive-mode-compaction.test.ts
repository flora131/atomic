import { describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

describe("InteractiveMode compaction events", () => {
	test("shows overflow auto-compaction as a yellow warning", async () => {
		initTheme(undefined, false);
		const addedChildren: Array<{ render(width: number): string[]; stop(): void }> = [];
		const fakeThis = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			autoCompactionEscapeHandler: undefined as (() => void) | undefined,
			autoCompactionLoader: undefined,
			defaultEditor: {} as { onEscape?: () => void },
			statusContainer: {
				clear: vi.fn(),
				addChild: vi.fn((child: { render(width: number): string[]; stop(): void }) => {
					addedChildren.push(child);
				}),
			},
			session: { abortCompaction: vi.fn() },
			settingsManager: { getShowTerminalProgress: () => false },
			ui: { requestRender: vi.fn(), terminal: { setProgress: vi.fn() } },
		};

		const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
			this: typeof fakeThis,
			event: { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" },
		) => Promise<void>;

		await handleEvent.call(fakeThis, {
			type: "compaction_start",
			reason: "overflow",
		});

		expect(fakeThis.statusContainer.clear).toHaveBeenCalledTimes(1);
		expect(fakeThis.statusContainer.addChild).toHaveBeenCalledTimes(1);
		const [loader] = addedChildren;
		expect(loader).toBeDefined();
		const rendered = loader.render(120).join("\n");
		const warningPrefix = theme.fg("warning", "").replace("\x1b[39m", "");
		const errorPrefix = theme.fg("error", "").replace("\x1b[39m", "");
		expect(rendered).toContain(`${warningPrefix}Context overflow detected. Auto-compacting...`);
		expect(rendered).not.toContain(`${errorPrefix}Context overflow detected. Auto-compacting...`);
		loader.stop();
	});

	test("rebuilds chat and appends a synthetic compaction summary at the bottom", async () => {
		const fakeThis = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			autoCompactionEscapeHandler: undefined as (() => void) | undefined,
			autoCompactionLoader: undefined,
			defaultEditor: {},
			statusContainer: { clear: vi.fn() },
			chatContainer: { clear: vi.fn() },
			rebuildChatFromMessages: vi.fn(),
			addMessageToChat: vi.fn(),
			showError: vi.fn(),
			showStatus: vi.fn(),
			flushCompactionQueue: vi.fn().mockResolvedValue(undefined),
			settingsManager: { getShowTerminalProgress: () => false },
			ui: { requestRender: vi.fn(), terminal: { setProgress: vi.fn() } },
		};

		const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
			this: typeof fakeThis,
			event: {
				type: "compaction_end";
				reason: "manual" | "threshold" | "overflow";
				result: { tokensBefore: number; summary: string } | undefined;
				aborted: boolean;
				willRetry: boolean;
				errorMessage?: string;
			},
		) => Promise<void>;

		await handleEvent.call(fakeThis, {
			type: "compaction_end",
			reason: "manual",
			result: {
				tokensBefore: 123,
				summary: "summary",
			},
			aborted: false,
			willRetry: false,
		});

		expect(fakeThis.chatContainer.clear).toHaveBeenCalledTimes(1);
		expect(fakeThis.rebuildChatFromMessages).toHaveBeenCalledTimes(1);
		expect(fakeThis.addMessageToChat).toHaveBeenCalledTimes(1);
		expect(fakeThis.addMessageToChat).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "compactionSummary",
				tokensBefore: 123,
				summary: "summary",
			}),
		);
		expect(fakeThis.flushCompactionQueue).toHaveBeenCalledWith({ willRetry: false });
	});
});
