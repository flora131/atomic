import { describe, expect, mock, test, beforeEach } from "bun:test";
import type { AskUserQuestionEventData } from "@/services/workflows/graph/index.ts";

/**
 * Mirrors the handleAskUserQuestion callback in use-workflow-hitl.ts.
 *
 * Extracted to test the dslAskUser bypass and multiSelect passthrough logic
 * without needing the full React hook infrastructure.
 */

interface WorkflowState {
  workflowActive: boolean;
}

interface UserQuestion {
  header: string;
  question: string;
  options: Array<{ label: string; value: string; description?: string }>;
  multiSelect: boolean;
}

interface HitlRequestPayload {
  requestId: string;
  header: string;
  question: string;
  options: Array<{ label: string; value: string; description?: string }>;
  multiSelect: boolean;
}

interface HandleAskUserResult {
  autoAnswered: boolean;
  autoAnswer?: string;
  userQuestion?: UserQuestion;
  hitlPayload?: HitlRequestPayload;
}

/**
 * Simulates handleAskUserQuestion logic, returning what path was taken.
 */
function handleAskUserQuestion(
  eventData: AskUserQuestionEventData,
  workflowState: WorkflowState,
  onWorkflowResumeWithAnswer?: (requestId: string, answer: string | string[]) => void,
): HandleAskUserResult {
  // Auto-answer path: active workflow AND not a DSL ask-user node
  if (workflowState.workflowActive && !eventData.dslAskUser) {
    const autoAnswer = eventData.options?.[0]?.label ?? "continue";
    if (eventData.respond) {
      eventData.respond(autoAnswer);
    } else if (onWorkflowResumeWithAnswer && eventData.requestId) {
      onWorkflowResumeWithAnswer(eventData.requestId, autoAnswer);
    }
    return { autoAnswered: true, autoAnswer };
  }

  // Fall-through path: build UserQuestion and HitlRequestPayload
  const mappedOptions = eventData.options?.map((option) => ({
    label: option.label,
    value: option.label,
    description: option.description,
  })) || [];

  const userQuestion: UserQuestion = {
    header: eventData.header || "Question",
    question: eventData.question,
    options: mappedOptions,
    multiSelect: eventData.multiSelect ?? false,
  };

  const respond = eventData.respond ?? (() => {});
  const hitlPayload: HitlRequestPayload = {
    requestId: eventData.requestId,
    header: eventData.header || "Question",
    question: eventData.question,
    options: mappedOptions,
    multiSelect: eventData.multiSelect ?? false,
  };

  return { autoAnswered: false, userQuestion, hitlPayload };
}

describe("handleAskUserQuestion dslAskUser bypass", () => {
  let respondMock: ReturnType<typeof mock>;
  let onWorkflowResumeMock: ReturnType<typeof mock>;

  beforeEach(() => {
    respondMock = mock();
    onWorkflowResumeMock = mock();
  });

  const baseEventData: AskUserQuestionEventData = {
    requestId: "req-1",
    question: "Pick a color",
    header: "Color Choice",
    nodeId: "node-1",
    options: [
      { label: "Red", description: "Primary color" },
      { label: "Blue", description: "Cool color" },
    ],
  };

  test("auto-answers when workflow is active and dslAskUser is not set", () => {
    const result = handleAskUserQuestion(
      { ...baseEventData, respond: respondMock },
      { workflowActive: true },
    );

    expect(result.autoAnswered).toBe(true);
    expect(result.autoAnswer).toBe("Red");
    expect(respondMock).toHaveBeenCalledWith("Red");
  });

  test("auto-answers when workflow is active and dslAskUser is false", () => {
    const result = handleAskUserQuestion(
      { ...baseEventData, dslAskUser: false, respond: respondMock },
      { workflowActive: true },
    );

    expect(result.autoAnswered).toBe(true);
    expect(result.autoAnswer).toBe("Red");
    expect(respondMock).toHaveBeenCalledWith("Red");
  });

  test("auto-answers with 'continue' when no options are provided", () => {
    const result = handleAskUserQuestion(
      { ...baseEventData, options: undefined, respond: respondMock },
      { workflowActive: true },
    );

    expect(result.autoAnswered).toBe(true);
    expect(result.autoAnswer).toBe("continue");
    expect(respondMock).toHaveBeenCalledWith("continue");
  });

  test("uses onWorkflowResumeWithAnswer when respond is not set", () => {
    const result = handleAskUserQuestion(
      { ...baseEventData, respond: undefined },
      { workflowActive: true },
      onWorkflowResumeMock,
    );

    expect(result.autoAnswered).toBe(true);
    expect(onWorkflowResumeMock).toHaveBeenCalledWith("req-1", "Red");
  });

  test("bypasses auto-answer when dslAskUser is true", () => {
    const result = handleAskUserQuestion(
      { ...baseEventData, dslAskUser: true, respond: respondMock },
      { workflowActive: true },
    );

    expect(result.autoAnswered).toBe(false);
    expect(respondMock).not.toHaveBeenCalled();
    expect(result.userQuestion).toBeDefined();
    expect(result.hitlPayload).toBeDefined();
  });

  test("falls through to question display when workflow is not active", () => {
    const result = handleAskUserQuestion(
      { ...baseEventData, respond: respondMock },
      { workflowActive: false },
    );

    expect(result.autoAnswered).toBe(false);
    expect(respondMock).not.toHaveBeenCalled();
    expect(result.userQuestion).toBeDefined();
  });
});

describe("handleAskUserQuestion multiSelect passthrough", () => {
  const baseEventData: AskUserQuestionEventData = {
    requestId: "req-2",
    question: "Select colors",
    header: "Multi-Select",
    nodeId: "node-2",
    options: [
      { label: "Red" },
      { label: "Blue" },
      { label: "Green" },
    ],
  };

  test("defaults multiSelect to false when not specified in event data", () => {
    const result = handleAskUserQuestion(
      baseEventData,
      { workflowActive: false },
    );

    expect(result.userQuestion?.multiSelect).toBe(false);
    expect(result.hitlPayload?.multiSelect).toBe(false);
  });

  test("passes multiSelect: true from event data to UserQuestion and payload", () => {
    const result = handleAskUserQuestion(
      { ...baseEventData, multiSelect: true },
      { workflowActive: false },
    );

    expect(result.userQuestion?.multiSelect).toBe(true);
    expect(result.hitlPayload?.multiSelect).toBe(true);
  });

  test("passes multiSelect: false explicitly from event data", () => {
    const result = handleAskUserQuestion(
      { ...baseEventData, multiSelect: false },
      { workflowActive: false },
    );

    expect(result.userQuestion?.multiSelect).toBe(false);
    expect(result.hitlPayload?.multiSelect).toBe(false);
  });

  test("passes multiSelect through for dslAskUser nodes during active workflow", () => {
    const result = handleAskUserQuestion(
      { ...baseEventData, dslAskUser: true, multiSelect: true },
      { workflowActive: true },
    );

    expect(result.autoAnswered).toBe(false);
    expect(result.userQuestion?.multiSelect).toBe(true);
    expect(result.hitlPayload?.multiSelect).toBe(true);
  });
});

describe("handleAskUserQuestion option mapping", () => {
  test("maps option labels to both label and value fields", () => {
    const result = handleAskUserQuestion(
      {
        requestId: "req-3",
        question: "Pick one",
        nodeId: "node-3",
        options: [
          { label: "Option A", description: "Desc A" },
          { label: "Option B" },
        ],
      },
      { workflowActive: false },
    );

    expect(result.userQuestion?.options).toEqual([
      { label: "Option A", value: "Option A", description: "Desc A" },
      { label: "Option B", value: "Option B", description: undefined },
    ]);
  });

  test("produces empty options array when options is undefined", () => {
    const result = handleAskUserQuestion(
      {
        requestId: "req-4",
        question: "Open question",
        nodeId: "node-4",
        options: undefined,
      },
      { workflowActive: false },
    );

    expect(result.userQuestion?.options).toEqual([]);
    expect(result.hitlPayload?.options).toEqual([]);
  });

  test("uses default header when header is not provided", () => {
    const result = handleAskUserQuestion(
      {
        requestId: "req-5",
        question: "Some question",
        nodeId: "node-5",
      },
      { workflowActive: false },
    );

    expect(result.userQuestion?.header).toBe("Question");
    expect(result.hitlPayload?.header).toBe("Question");
  });
});
