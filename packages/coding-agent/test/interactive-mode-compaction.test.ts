import { describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

describe("InteractiveMode compaction events", () => {
	test("routes exact /context-compact to contextCompact and rejects trailing text", async () => {
		const submitHost = {
			defaultEditor: {} as { onSubmit?: (text: string) => Promise<void> },
			editor: { setText: vi.fn() },
			sessionManager: {
				getEntries: () => [
					{ type: "message", message: { role: "user", content: "task" } },
					{ type: "message", message: { role: "assistant", content: [] } },
				],
			},
			session: {
				contextCompact: vi.fn().mockResolvedValue({}),
				compact: vi.fn().mockResolvedValue({}),
				prompt: vi.fn(),
				isCompacting: false,
				isStreaming: false,
				isBashRunning: false,
			},
			statusContainer: { clear: vi.fn() },
			isBashMode: false,
			onInputCallback: undefined,
			flushPendingBashComponents: vi.fn(),
			updateEditorBorderColor: vi.fn(),
			showWarning: vi.fn(),
			handleContextCompactCommand: Reflect.get(InteractiveMode.prototype, "handleContextCompactCommand"),
			handleCompactCommand: vi.fn(),
		};
		const setupEditorSubmitHandler = Reflect.get(InteractiveMode.prototype, "setupEditorSubmitHandler") as (
			this: typeof submitHost,
		) => void;
		setupEditorSubmitHandler.call(submitHost);

		await submitHost.defaultEditor.onSubmit?.("/context-compact keep this");
		expect(submitHost.session.contextCompact).not.toHaveBeenCalled();
		expect(submitHost.showWarning).toHaveBeenCalledWith("Usage: /context-compact");

		await submitHost.defaultEditor.onSubmit?.("/context-compact\tkeep this");
		expect(submitHost.session.contextCompact).not.toHaveBeenCalled();
		expect(submitHost.showWarning).toHaveBeenCalledWith("Usage: /context-compact");

		await submitHost.defaultEditor.onSubmit?.("/context-compact");
		expect(submitHost.session.contextCompact).toHaveBeenCalledTimes(1);
		expect(submitHost.session.compact).not.toHaveBeenCalled();
	});

	test("keeps /compact custom instructions routing unchanged", async () => {
		const submitHost = {
			defaultEditor: {} as { onSubmit?: (text: string) => Promise<void> },
			editor: { setText: vi.fn() },
			session: { isCompacting: false, isStreaming: false, isBashRunning: false, prompt: vi.fn() },
			isBashMode: false,
			onInputCallback: undefined,
			flushPendingBashComponents: vi.fn(),
			updateEditorBorderColor: vi.fn(),
			handleCompactCommand: vi.fn().mockResolvedValue(undefined),
		};
		const setupEditorSubmitHandler = Reflect.get(InteractiveMode.prototype, "setupEditorSubmitHandler") as (
			this: typeof submitHost,
		) => void;
		setupEditorSubmitHandler.call(submitHost);

		await submitHost.defaultEditor.onSubmit?.("/compact preserve exact stack traces");

		expect(submitHost.handleCompactCommand).toHaveBeenCalledWith("preserve exact stack traces");
	});

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
