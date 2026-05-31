import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  HIL_ANSWER_NOTICE_CUSTOM_TYPE,
  installWorkflowHilAnswerNotifications,
  type WorkflowHilAnswerNoticeDetails,
} from "../../packages/workflows/src/extension/hil-answer-notifications.js";
import { StageUiBroker } from "../../packages/workflows/src/shared/stage-ui-broker.js";
import { buildStagePromptAdapter } from "../../packages/workflows/src/shared/stage-prompt.js";
import { createStore } from "../../packages/workflows/src/shared/store.js";
import type { PendingPrompt, StageSnapshot } from "../../packages/workflows/src/shared/store-types.js";

interface SentMessage {
  readonly customType: string;
  readonly content?: string;
  readonly display?: boolean;
  readonly details?: WorkflowHilAnswerNoticeDetails;
}

type SendOptions = {
  readonly triggerTurn?: boolean;
  readonly deliverAs?: "steer" | "followUp" | "nextTurn" | "interrupt";
  readonly interruptAbortMessage?: string;
};

const COLOR_ARGS = {
  questions: [
    {
      question: "What color?",
      options: [{ label: "Red" }, { label: "Blue" }],
    },
  ],
};

function runningStage(overrides: Partial<StageSnapshot> = {}): StageSnapshot {
  return {
    id: "stage-1",
    name: "review",
    status: "running",
    parentIds: [],
    toolEvents: [],
    ...overrides,
  };
}

function pendingPrompt(overrides: Partial<PendingPrompt> = {}): PendingPrompt {
  return {
    id: "prompt-1",
    kind: "input",
    message: "Secret passphrase?",
    createdAt: 10,
    ...overrides,
  };
}

function setup() {
  const store = createStore();
  const broker = new StageUiBroker(store);
  const sent: SentMessage[] = [];
  const options: SendOptions[] = [];
  const unsubscribe = installWorkflowHilAnswerNotifications({
    store,
    stageUiBroker: broker,
    sendMessage(message, sendOptions) {
      sent.push(message as SentMessage);
      options.push(sendOptions ?? {});
    },
  });
  store.recordRunStart({ id: "run-1", name: "release", inputs: {}, status: "running", stages: [], startedAt: 1 });
  store.recordStageStart("run-1", runningStage());
  return { store, broker, sent, options, unsubscribe };
}

describe("installWorkflowHilAnswerNotifications", () => {
  test("emits one interrupt notice when a simple stage prompt is answered", () => {
    const { store, sent, options, unsubscribe } = setup();

    assert.equal(store.recordStagePendingPrompt("run-1", "stage-1", pendingPrompt()), true);
    assert.equal(store.resolveStagePendingPrompt("run-1", "stage-1", "prompt-1", "swordfish"), true);
    store.recordNotice({ id: "tick", level: "info", message: "force notify", createdAt: 20 });
    store.clearStagePromptAnswer("run-1", "stage-1");

    assert.equal(sent.length, 1);
    assert.equal(options[0]?.triggerTurn, true);
    assert.equal(options[0]?.deliverAs, "interrupt");
    assert.match(options[0]?.interruptAbortMessage ?? "", /main-chat question was dismissed/);
    assert.match(options[0]?.interruptAbortMessage ?? "", /User responded with: swordfish/);
    assert.doesNotMatch(options[0]?.interruptAbortMessage ?? "", /^Operation aborted$/);
    assert.equal(sent[0]?.customType, HIL_ANSWER_NOTICE_CUSTOM_TYPE);
    assert.equal(sent[0]?.display, true);
    assert.equal(sent[0]?.details?.kind, "hil_answered");
    assert.equal(sent[0]?.details?.scope, "stage");
    assert.equal(sent[0]?.details?.runId, "run-1");
    assert.equal(sent[0]?.details?.workflowName, "release");
    assert.equal(sent[0]?.details?.stageId, "stage-1");
    assert.equal(sent[0]?.details?.stageName, "review");
    assert.equal(sent[0]?.details?.promptId, "prompt-1");
    assert.equal(sent[0]?.details?.promptKind, "input");
    assert.equal(sent[0]?.details?.answerAvailable, true);
    assert.equal(sent[0]?.details?.answerIncluded, true);
    assert.equal(sent[0]?.details?.answerSummary, "swordfish");
    assert.equal(sent[0]?.details?.promptMessage, "Secret passphrase?");
    assert.equal(typeof sent[0]?.details?.answeredAt, "number");
    assert.match(sent[0]?.content ?? "", /received the user's response/);
    assert.match(sent[0]?.content ?? "", /User responded with: swordfish/);
    assert.match(sent[0]?.content ?? "", /Do not ask the same question again/);
    unsubscribe();
  });

  test("does not notify when a simple prompt is cleared without recording an answer", () => {
    const { store, sent, unsubscribe } = setup();

    assert.equal(store.recordStagePendingPrompt("run-1", "stage-1", pendingPrompt()), true);
    assert.equal(
      store.resolveStagePendingPrompt("run-1", "stage-1", "prompt-1", "discarded", { recordAnswer: false }),
      true,
    );

    assert.deepEqual(sent, []);
    unsubscribe();
  });

  test("does not notify when a simple prompt is answered by the workflow tool", () => {
    const { store, sent, unsubscribe } = setup();

    assert.equal(store.recordStagePendingPrompt("run-1", "stage-1", pendingPrompt()), true);
    assert.equal(
      store.resolveStagePendingPrompt("run-1", "stage-1", "prompt-1", "from tool", { answerSource: "workflow_tool" }),
      true,
    );
    store.recordNotice({ id: "tick", level: "info", message: "force notify", createdAt: 20 });

    assert.deepEqual(sent, []);
    unsubscribe();
  });

  test("emits an interrupt notice when a brokered structured prompt is answered", async () => {
    const { broker, sent, options, unsubscribe } = setup();
    const adapter = buildStagePromptAdapter("ask-1", "ask_user_question", COLOR_ARGS, 1)!;
    broker.provideStagePrompt("run-1", "stage-1", adapter);

    const pending = broker.requestCustomUi("run-1", "stage-1", () => ({
      render: () => [],
      invalidate: () => {},
    }));

    assert.equal(broker.answerStagePrompt("run-1", "stage-1", { text: "Blue" }), true);
    await pending;

    assert.equal(sent.length, 1);
    assert.equal(options[0]?.triggerTurn, true);
    assert.equal(options[0]?.deliverAs, "interrupt");
    assert.match(options[0]?.interruptAbortMessage ?? "", /User responded with: What color\? → Blue/);
    assert.equal(sent[0]?.customType, HIL_ANSWER_NOTICE_CUSTOM_TYPE);
    assert.equal(sent[0]?.details?.promptId, "ask-1");
    assert.equal(sent[0]?.details?.promptKind, "ask_user_question");
    assert.equal(sent[0]?.details?.answerAvailable, true);
    assert.equal(sent[0]?.details?.answerIncluded, true);
    assert.equal(sent[0]?.details?.answerSummary, "What color? → Blue");
    assert.equal(sent[0]?.details?.promptMessage, "What color?");
    assert.match(sent[0]?.content ?? "", /User responded with: What color\? → Blue/);
    assert.match(sent[0]?.content ?? "", /stage has already received the user's response/);
    unsubscribe();
  });

  test("does not notify when a brokered structured prompt is answered by the workflow tool", async () => {
    const { broker, sent, unsubscribe } = setup();
    const adapter = buildStagePromptAdapter("ask-1", "ask_user_question", COLOR_ARGS, 1)!;
    broker.provideStagePrompt("run-1", "stage-1", adapter);

    const pending = broker.requestCustomUi("run-1", "stage-1", () => ({
      render: () => [],
      invalidate: () => {},
    }));

    assert.equal(broker.answerStagePrompt("run-1", "stage-1", { text: "Blue" }, { answerSource: "workflow_tool" }), true);
    await pending;

    assert.deepEqual(sent, []);
    unsubscribe();
  });
});
