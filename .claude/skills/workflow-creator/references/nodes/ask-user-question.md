# `.askUserQuestion()` — Human-in-the-Loop Prompts

`.askUserQuestion()` pauses workflow execution and presents an interactive question dialog to the user. The user's answer is mapped into workflow state so downstream stages can branch on or consume it.

Reuses the existing HITL UI (`UserQuestionDialog`) and event pipeline.

## Usage

```ts
.askUserQuestion({
  name: "confirm-deploy",
  description: "Ask user to confirm deployment",
  question: {
    question: "Ready to deploy to production?",
    header: "Deployment Confirmation",
    options: [
      { label: "Yes", description: "Deploy now" },
      { label: "No", description: "Cancel deployment" },
    ],
  },
  outputMapper: (answer) => ({ deployConfirmed: answer === "Yes" }),
})
```

## Static vs Dynamic Questions

The `question` field accepts either a static config object or a function that builds the config from current workflow state:

### Static question

```ts
.askUserQuestion({
  name: "pick-strategy",
  question: {
    question: "Which implementation strategy should we use?",
    options: [
      { label: "Conservative", description: "Minimal changes" },
      { label: "Aggressive", description: "Full refactor" },
    ],
  },
  outputMapper: (answer) => ({ strategy: answer }),
})
```

### Dynamic question (state-dependent)

```ts
import type { BaseState } from "@bastani/atomic-workflows";

// ...
.askUserQuestion({
  name: "review-tasks",
  question: (state: BaseState) => ({
    question: `Found ${state.tasks.length} tasks. Proceed with implementation?`,
    header: "Task Review",
    options: [
      { label: "Proceed" },
      { label: "Revise", description: "Go back and re-plan" },
    ],
  }),
  outputMapper: (answer) => ({ userApproved: answer === "Proceed" }),
})
```

## Multi-select

Set `multiSelect: true` to show checkboxes. The answer passed to `outputMapper` becomes a `string[]`:

```ts
.askUserQuestion({
  name: "select-fixes",
  question: {
    question: "Which issues should we fix?",
    header: "Issue Selection",
    options: [
      { label: "Bug #1", description: "Null pointer in parser" },
      { label: "Bug #2", description: "Off-by-one in loop" },
      { label: "Bug #3", description: "Missing validation" },
    ],
    multiSelect: true,
  },
  outputMapper: (answers) => ({ selectedFixes: answers }),
})
```

## Free-text input

Omit `options` to present a free-text input field instead of predefined choices:

```ts
.askUserQuestion({
  name: "get-feedback",
  question: {
    question: "Any additional instructions for the implementation?",
    header: "User Feedback",
  },
  outputMapper: (answer) => ({ userFeedback: answer }),
})
```

## Conditional branching on answers

Combine with `.if()` to route execution based on the user's response:

```ts
.askUserQuestion({
  name: "approve-plan",
  question: {
    question: "Approve this implementation plan?",
    options: [
      { label: "Approve" },
      { label: "Reject" },
    ],
  },
  outputMapper: (answer) => ({ planApproved: answer === "Approve" }),
})
.if((ctx) => ctx.state.planApproved === true)
  .stage({ name: "implement", agent: "implementer", ... })
.else()
  .stage({ name: "re-plan", agent: "planner", ... })
.endIf()
```

## Handling user decline (ESC / Ctrl+C)

When the user presses ESC or Ctrl+C instead of answering, the workflow does **not** crash — it continues to the next step with a decline sentinel. Import `USER_DECLINED_ANSWER` to detect this:

```ts
import { defineWorkflow, USER_DECLINED_ANSWER } from "@bastani/atomic-workflows";

// ...
.askUserQuestion({
  name: "confirm-deploy",
  question: {
    question: "Ready to deploy to production?",
    options: [{ label: "Yes" }, { label: "No" }],
  },
  outputMapper: (answer) => ({
    deployConfirmed: answer !== USER_DECLINED_ANSWER && answer === "Yes",
  }),
})
```

When the user declines:
- `outputMapper` receives `USER_DECLINED_ANSWER` (`"__user_declined_to_respond__"`) as the answer
- `__userDeclined` is set to `true` **automatically** by the compiler — you do **not** need to set this yourself in `outputMapper`
- `__waitingForInput` is set to `false` so the workflow proceeds
- On a normal answer, `__userDeclined` is automatically reset to `false`

Use `.if()` to branch on declines:

```ts
.askUserQuestion({
  name: "confirm",
  question: { question: "Continue?", options: [{ label: "Yes" }, { label: "No" }] },
  outputMapper: (answer) => ({
    confirmed: answer !== USER_DECLINED_ANSWER && answer === "Yes",
  }),
})
.if((ctx) => ctx.state.__userDeclined === true)
  .stage({ name: "handle-cancel", agent: null, ... })
.elseIf((ctx) => ctx.state.confirmed === true)
  .stage({ name: "proceed", agent: null, ... })
.else()
  .stage({ name: "handle-no", agent: null, ... })
.endIf()
```

## `outputMapper` behavior

When `outputMapper` is provided, the node blocks execution until the user responds (or declines). The returned record is merged into workflow state.

When `outputMapper` is omitted, the raw answer is stored in `state.outputs[nodeId]` and the workflow continues after the user responds.

## `AskUserQuestionOptions` reference

| Field          | Type                                                                     | Required | Description                                                        |
| -------------- | ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------ |
| `name`         | `string`                                                                 | yes      | Unique node identifier (also used in logging)                      |
| `question`     | `AskUserQuestionConfig \| (state: BaseState) => AskUserQuestionConfig`   | yes      | Static config or state-dependent factory for the question dialog   |
| `description`  | `string`                                                                 | no       | Description of what this question node does                        |
| `outputMapper` | `(answer: string \| string[]) => Record<string, JsonValue>`                | no       | Maps the user's answer into state updates                          |

## `AskUserQuestionConfig` reference

| Field         | Type                                              | Required | Description                                                          |
| ------------- | ------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `question`    | `string`                                          | yes      | The question text displayed to the user (supports markdown)          |
| `header`      | `string`                                          | no       | Optional header badge text (e.g., "Review Required")                 |
| `options`     | `{ label: string; description?: string }[]`       | no       | Predefined answer options. Omit for free-text input only             |
| `multiSelect` | `boolean`                                         | no       | Show checkboxes for multiple selections (default: `false`)           |
