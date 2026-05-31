import { describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { OrchestrationContext } from "../src/core/extensions/types.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function plain(line: string): string {
	return line.replace(/\u001b\[[0-9;]*m/g, "");
}

const workflowContext: OrchestrationContext = {
	kind: "workflow-stage",
	workflowRunId: "run-1",
	workflowStageId: "stage-1",
	workflowStageName: "Stage 1",
	constraints: { disableWorkflowTool: true, maxSubagentDepth: 0 },
};

function sessionWithFastMode(chat: boolean, workflow = false, orchestrationContext?: OrchestrationContext): AgentSession {
	return {
		state: {
			model: { provider: "openai", id: "gpt-5.1-codex" },
			thinkingLevel: "off",
		},
		settingsManager: {
			getCodexFastModeSettings: () => ({ chat, workflow }),
		},
		orchestrationContext,
		sessionManager: {
			getCwd: () => "/tmp/project",
		},
		isStreaming: false,
	} as unknown as AgentSession;
}

const footerData = {
	getAvailableProviderCount: () => 1,
} as unknown as ReadonlyFooterDataProvider;

describe("FooterComponent Codex fast mode indicator", () => {
	it("shows fast after the model name when chat fast mode applies", () => {
		initTheme("dark");
		const footer = new FooterComponent(sessionWithFastMode(true), footerData);

		expect(plain(footer.render(120)[0])).toContain("gpt-5.1-codex fast");
	});

	it("omits fast when chat fast mode is disabled", () => {
		initTheme("dark");
		const footer = new FooterComponent(sessionWithFastMode(false), footerData);

		expect(plain(footer.render(120)[0])).toContain("gpt-5.1-codex •");
		expect(plain(footer.render(120)[0])).not.toContain("fast");
	});

	it("uses workflow scope for workflow-stage session footers", () => {
		initTheme("dark");
		const footer = new FooterComponent(sessionWithFastMode(false, true, workflowContext), footerData);

		expect(plain(footer.render(120)[0])).toContain("gpt-5.1-codex fast");
	});

	it("does not use chat scope for workflow-stage session footers", () => {
		initTheme("dark");
		const footer = new FooterComponent(sessionWithFastMode(true, false, workflowContext), footerData);

		expect(plain(footer.render(120)[0])).toContain("gpt-5.1-codex •");
		expect(plain(footer.render(120)[0])).not.toContain("fast");
	});
});
