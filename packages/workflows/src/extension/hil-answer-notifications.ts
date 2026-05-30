import type {
  ExtensionAPI,
  PiMessageRenderComponent,
  PiMessageRendererResult,
} from "./index.js";
import type { Store } from "../shared/store.js";
import type {
  PendingPrompt,
  PromptKind,
  RunSnapshot,
  StageInputKind,
  StageInputRequest,
  StageSnapshot,
  StoreSnapshot,
} from "../shared/store-types.js";
import type { StageUiBroker } from "../shared/stage-ui-broker.js";
import { wrapPlainText } from "../tui/text-helpers.js";

export const HIL_ANSWER_NOTICE_CUSTOM_TYPE = "workflows:hil-answer-notice";

export type WorkflowHilAnswerPromptKind = PromptKind | StageInputKind;

export interface WorkflowHilAnswerNoticeDetails {
  readonly kind: "hil_answered";
  readonly scope: "stage";
  readonly runId: string;
  readonly workflowName: string;
  readonly stageId: string;
  readonly stageName?: string;
  readonly promptId?: string;
  readonly promptKind?: WorkflowHilAnswerPromptKind;
  readonly answeredAt: number;
  readonly answerAvailable: true;
  readonly answerIncluded: false;
}

export interface WorkflowHilAnswerNotificationState {
  readonly deliveredAnswerPrompts: Set<string>;
}

export interface WorkflowHilAnswerNotificationOptions {
  readonly store: Store;
  readonly stageUiBroker?: Pick<StageUiBroker, "onStagePromptResolved">;
  readonly sendMessage?: ExtensionAPI["sendMessage"];
  readonly registerMessageRenderer?: ExtensionAPI["registerMessageRenderer"];
  readonly rendererHost?: object;
  readonly state?: WorkflowHilAnswerNotificationState;
}

type RawRenderer = (payload: unknown) => PiMessageRendererResult;

const rendererRegisteredHosts = new WeakSet<object>();

export function createWorkflowHilAnswerNotificationState(): WorkflowHilAnswerNotificationState {
  return {
    deliveredAnswerPrompts: new Set<string>(),
  };
}

export function resetWorkflowHilAnswerNotificationState(
  state: WorkflowHilAnswerNotificationState,
): void {
  state.deliveredAnswerPrompts.clear();
}

export function installWorkflowHilAnswerNotifications(
  options: WorkflowHilAnswerNotificationOptions,
): () => void {
  registerHilAnswerNoticeRenderer(options);

  const send = options.sendMessage;
  if (typeof send !== "function") return () => undefined;

  const state = options.state ?? createWorkflowHilAnswerNotificationState();
  let previousSnapshot = options.store.snapshot();

  const emitOnce = (details: WorkflowHilAnswerNoticeDetails): void => {
    const key = answerNoticeKey(details.runId, details.stageId, details.promptId, details.promptKind);
    if (state.deliveredAnswerPrompts.has(key)) return;

    state.deliveredAnswerPrompts.add(key);
    const content = formatWorkflowHilAnswerNoticeText(details);
    try {
      void Promise.resolve(
        send(
          {
            customType: HIL_ANSWER_NOTICE_CUSTOM_TYPE,
            content,
            display: true,
            details,
          },
          { triggerTurn: true, deliverAs: "interrupt" },
        ),
      ).catch((error: unknown) => warnHilAnswerSendFailure(error));
    } catch (error) {
      warnHilAnswerSendFailure(error);
    }
  };

  const inspectSimplePromptAnswers = (snapshot: StoreSnapshot): void => {
    for (const previousRun of previousSnapshot.runs) {
      const currentRun = snapshot.runs.find((run) => run.id === previousRun.id);
      if (currentRun === undefined) continue;

      for (const previousStage of previousRun.stages) {
        const prompt = previousStage.pendingPrompt;
        if (prompt === undefined) continue;

        const currentStage = currentRun.stages.find((stage) => stage.id === previousStage.id);
        if (currentStage === undefined) continue;
        if (currentStage.pendingPrompt !== undefined) continue;
        if (currentStage.promptAnswerState !== "available") continue;

        emitOnce(makeSimplePromptAnswerNotice(currentRun, currentStage, prompt));
      }
    }
    previousSnapshot = snapshot;
  };

  const unsubscribeStore = options.store.subscribe(inspectSimplePromptAnswers);
  const unsubscribeBroker = options.stageUiBroker?.onStagePromptResolved((event) => {
    const snapshot = options.store.snapshot();
    const run = snapshot.runs.find((candidate) => candidate.id === event.runId);
    if (run === undefined) return;
    const stage = run.stages.find((candidate) => candidate.id === event.stageId);
    if (stage === undefined) return;

    emitOnce(makeBrokerPromptAnswerNotice(run, stage, event.prompt, event.answeredAt));
  });

  return () => {
    unsubscribeStore();
    unsubscribeBroker?.();
  };
}

export function registerHilAnswerNoticeRenderer(
  options: Pick<WorkflowHilAnswerNotificationOptions, "registerMessageRenderer" | "rendererHost">,
): void {
  const register = options.registerMessageRenderer;
  if (typeof register !== "function") return;

  const host = options.rendererHost ?? register;
  if (rendererRegisteredHosts.has(host)) return;

  const renderer: RawRenderer = (raw) => {
    const message = raw as { details?: WorkflowHilAnswerNoticeDetails };
    if (!message.details) return undefined;
    return makeNoticeComponent(message.details);
  };

  register(HIL_ANSWER_NOTICE_CUSTOM_TYPE, renderer);
  rendererRegisteredHosts.add(host);
}

export function formatWorkflowHilAnswerNoticeText(details: WorkflowHilAnswerNoticeDetails): string {
  const workflowName = escapeQuotedText(details.workflowName);
  const stage = details.stageName ?? details.stageId;
  const prompt = details.promptId ? `, prompt ${details.promptId}` : "";
  return `✅ Workflow "${workflowName}" received the answer for its pending human-in-the-loop prompt (run ${details.runId}, stage ${stage}${prompt}). Do not ask the same question again. Continue the workflow; the stage has already received the user's response.`;
}

function makeSimplePromptAnswerNotice(
  run: RunSnapshot,
  stage: StageSnapshot,
  prompt: PendingPrompt,
): WorkflowHilAnswerNoticeDetails {
  return {
    kind: "hil_answered",
    scope: "stage",
    runId: run.id,
    workflowName: run.name,
    stageId: stage.id,
    stageName: stage.name,
    promptId: prompt.id,
    promptKind: prompt.kind,
    answeredAt: Date.now(),
    answerAvailable: true,
    answerIncluded: false,
  };
}

function makeBrokerPromptAnswerNotice(
  run: RunSnapshot,
  stage: StageSnapshot,
  prompt: StageInputRequest,
  answeredAt: number,
): WorkflowHilAnswerNoticeDetails {
  return {
    kind: "hil_answered",
    scope: "stage",
    runId: run.id,
    workflowName: run.name,
    stageId: stage.id,
    stageName: stage.name,
    promptId: prompt.id,
    promptKind: prompt.kind,
    answeredAt,
    answerAvailable: true,
    answerIncluded: false,
  };
}

function answerNoticeKey(
  runId: string,
  stageId: string,
  promptId: string | undefined,
  promptKind: WorkflowHilAnswerPromptKind | undefined,
): string {
  return `hil_answered:${runId}:stage:${stageId}:${promptKind ?? "unknown"}:${promptId ?? "unknown"}`;
}

function warnHilAnswerSendFailure(error: unknown): void {
  if (process.env.ATOMIC_WORKFLOW_DEBUG !== "1") return;
  const message = error instanceof Error ? error.message : String(error);
  console.warn("[workflows] workflow HiL answer notice send failed", message);
}

function escapeQuotedText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function makeNoticeComponent(details: WorkflowHilAnswerNoticeDetails): PiMessageRenderComponent {
  const text = formatWorkflowHilAnswerNoticeText(details);
  return {
    render(width: number): string[] {
      return wrapPlainText(text, width);
    },
    invalidate() {
      /* stored HiL-answer notices are immutable */
    },
  };
}
