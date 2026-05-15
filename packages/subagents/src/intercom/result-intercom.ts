import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import {
	type Details,
	type IntercomEventBus,
	type SingleResult,
	type SubagentResultIntercomChild,
	type SubagentResultIntercomPayload,
	type SubagentResultStatus,
	type SubagentRunMode,
	SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT,
	SUBAGENT_RESULT_INTERCOM_EVENT,
} from "../shared/types.ts";

export function resolveSubagentResultStatus(input: {
	exitCode?: number;
	success?: boolean;
	state?: string;
	interrupted?: boolean;
	detached?: boolean;
}): SubagentResultStatus {
	if (input.detached) return "detached";
	if (input.interrupted || input.state === "paused") return "paused";
	if (typeof input.success === "boolean") return input.success ? "completed" : "failed";
	if (input.state === "complete") return "completed";
	if (input.state === "failed") return "failed";
	if (typeof input.exitCode === "number") return input.exitCode === 0 ? "completed" : "failed";
	return "failed";
}

function countStatuses(children: SubagentResultIntercomChild[]): Record<SubagentResultStatus, number> {
	const counts: Record<SubagentResultStatus, number> = {
		completed: 0,
		failed: 0,
		paused: 0,
		detached: 0,
	};
	for (const child of children) {
		counts[child.status] += 1;
	}
	return counts;
}

function formatStatusCounts(counts: Record<SubagentResultStatus, number>): string {
	const parts = [
		counts.completed ? `${counts.completed} completed` : undefined,
		counts.failed ? `${counts.failed} failed` : undefined,
		counts.paused ? `${counts.paused} paused` : undefined,
		counts.detached ? `${counts.detached} detached` : undefined,
	].filter((part): part is string => Boolean(part));
	return parts.length ? parts.join(", ") : "0 results";
}

function resolveGroupedStatus(children: SubagentResultIntercomChild[]): SubagentResultStatus {
	const counts = countStatuses(children);
	if (counts.failed > 0) return "failed";
	if (counts.paused > 0) return "paused";
	if (counts.completed > 0) return "completed";
	if (counts.detached > 0) return "detached";
	return "failed";
}

interface GroupedResultIntercomMessageInput {
	to: string;
	runId: string;
	mode: SubagentRunMode;
	source: "foreground" | "async";
	children: SubagentResultIntercomChild[];
	asyncId?: string;
	asyncDir?: string;
	chainSteps?: number;
}

function asyncResumeGuidance(input: {
	source: "foreground" | "async";
	children: SubagentResultIntercomChild[];
	asyncId?: string;
}): string | undefined {
	if (input.source !== "async" || !input.asyncId) return undefined;
	const resumable = input.children.filter((child) => typeof child.sessionPath === "string" && fs.existsSync(child.sessionPath));
	if (input.children.length === 1 && resumable.length === 1) {
		return `Revive: subagent({ action: "resume", id: "${input.asyncId}", message: "..." })`;
	}
	if (resumable.length > 0) {
		const firstIndex = resumable[0]?.index ?? input.children.indexOf(resumable[0]!);
		return `Revive child: subagent({ action: "resume", id: "${input.asyncId}", index: ${firstIndex}, message: "..." })`;
	}
	return "Resume: unavailable; no child session file was persisted.";
}

function formatSubagentResultIntercomMessage(input: {
	runId: string;
	mode: SubagentRunMode;
	status: SubagentResultStatus;
	source: "foreground" | "async";
	children: SubagentResultIntercomChild[];
	asyncId?: string;
	asyncDir?: string;
	chainSteps?: number;
}): string {
	const counts = countStatuses(input.children);
	const lines: string[] = [
		"subagent results",
		"",
		`Run: ${input.runId}`,
		`Mode: ${input.mode}`,
		`Status: ${input.status}`,
		`Children: ${formatStatusCounts(counts)}`,
	];
	if (input.mode === "chain" && typeof input.chainSteps === "number") {
		lines.push(`Chain steps: ${input.chainSteps}`);
	}
	if (input.asyncId) lines.push(`Async id: ${input.asyncId}`);
	if (input.asyncDir) lines.push(`Async dir: ${input.asyncDir}`);
	const resumeGuidance = asyncResumeGuidance(input);
	if (resumeGuidance) lines.push(resumeGuidance);
	if (input.children.some((child) => child.intercomTarget)) {
		lines.push("");
		lines.push(input.source === "async"
			? "Previous intercom targets below identify child sessions used while they were running. Inspect artifacts or session logs if resume is unavailable."
			: "Intercom targets below identify child sessions used while they were running; completed child sessions may no longer be reachable. Inspect artifacts or session logs for follow-up.");
	}

	for (let index = 0; index < input.children.length; index++) {
		const child = input.children[index]!;
		lines.push("");
		lines.push(`${index + 1}. ${child.agent} — ${child.status}`);
		if (child.intercomTarget) lines.push(`${input.source === "async" ? "Previous intercom target" : "Run intercom target"}: ${child.intercomTarget}`);
		if (child.artifactPath) lines.push(`Output artifact: ${child.artifactPath}`);
		if (child.sessionPath) lines.push(`Session: ${child.sessionPath}`);
		lines.push("Summary:");
		lines.push(child.summary);
	}

	return lines.join("\n");
}

export function buildSubagentResultIntercomPayload(input: GroupedResultIntercomMessageInput): SubagentResultIntercomPayload {
	const children = input.children.map((child) => ({
		...child,
		summary: child.summary.trim() || "(no output)",
	}));
	const status = resolveGroupedStatus(children);
	const summary = formatStatusCounts(countStatuses(children));
	const firstChild = children[0];
	const payload: SubagentResultIntercomPayload = {
		to: input.to,
		runId: input.runId,
		mode: input.mode,
		status,
		summary,
		source: input.source,
		children,
		...(input.asyncId ? { asyncId: input.asyncId } : {}),
		...(input.asyncDir ? { asyncDir: input.asyncDir } : {}),
		...(typeof input.chainSteps === "number" ? { chainSteps: input.chainSteps } : {}),
		...(firstChild?.agent ? { agent: firstChild.agent } : {}),
		...(firstChild?.index !== undefined ? { index: firstChild.index } : {}),
		...(firstChild?.artifactPath ? { artifactPath: firstChild.artifactPath } : {}),
		...(firstChild?.sessionPath ? { sessionPath: firstChild.sessionPath } : {}),
		message: "",
	};
	payload.message = formatSubagentResultIntercomMessage(payload);
	return payload;
}

export async function deliverSubagentResultIntercomEvent(
	events: IntercomEventBus,
	payload: SubagentResultIntercomPayload,
	timeoutMs = 500,
): Promise<boolean> {
	return deliverSubagentIntercomMessageEvent(events, payload.to, payload.message, timeoutMs, payload);
}

export async function deliverSubagentIntercomMessageEvent(
	events: IntercomEventBus,
	to: string,
	message: string,
	timeoutMs = 500,
	extra: Record<string, unknown> = {},
): Promise<boolean> {
	if (typeof events.on !== "function" || typeof events.emit !== "function") return false;
	const requestId = typeof extra.requestId === "string" ? extra.requestId : randomUUID();
	return new Promise((resolve) => {
		let settled = false;
		let unsubscribe: (() => void) | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (delivered: boolean) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			unsubscribe?.();
			resolve(delivered);
		};
		unsubscribe = events.on(SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT, (data) => {
			if (!data || typeof data !== "object") return;
			const delivery = data as { requestId?: unknown; delivered?: unknown };
			if (delivery.requestId !== requestId) return;
			finish(delivery.delivered === true);
		});
		timer = setTimeout(() => finish(false), timeoutMs);
		try {
			events.emit(SUBAGENT_RESULT_INTERCOM_EVENT, { ...extra, to, message, requestId });
		} catch {
			finish(false);
		}
	});
}

function stripSingleResultOutputs(result: SingleResult): SingleResult {
	return {
		...result,
		messages: undefined,
		finalOutput: undefined,
		truncation: undefined,
	};
}

export function stripDetailsOutputsForIntercomReceipt(details: Details): Details {
	return {
		...details,
		results: details.results.map(stripSingleResultOutputs),
	};
}

export function formatSubagentResultReceipt(input: {
	mode: SubagentRunMode;
	runId: string;
	payload: SubagentResultIntercomPayload;
}): string {
	const counts = countStatuses(input.payload.children);
	const modeLabel = input.mode === "single"
		? "single subagent result"
		: input.mode === "parallel"
			? "parallel subagent results"
			: "chain subagent results";
	const lines = [
		`Delivered ${modeLabel} via intercom.`,
		`Run: ${input.runId}`,
		`Children: ${formatStatusCounts(counts)}`,
	];

	const artifacts = input.payload.children.filter((child) => typeof child.artifactPath === "string");
	if (artifacts.length > 0) {
		lines.push("Artifacts:");
		for (const child of artifacts) {
			lines.push(`- ${child.agent} [${child.status}]: ${child.artifactPath}`);
		}
	}

	const intercomTargets = input.payload.children.filter((child) => typeof child.intercomTarget === "string");
	if (intercomTargets.length > 0) {
		lines.push("Run intercom targets (may be inactive after completion):");
		for (const child of intercomTargets) {
			lines.push(`- ${child.agent} [${child.status}]: ${child.intercomTarget}`);
		}
	}

	const sessions = input.payload.children.filter((child) => typeof child.sessionPath === "string");
	if (sessions.length > 0) {
		lines.push("Sessions:");
		for (const child of sessions) {
			lines.push(`- ${child.agent} [${child.status}]: ${child.sessionPath}`);
		}
	}

	lines.push("Full grouped output was sent over intercom.");
	return lines.join("\n");
}
