/**
 * Test Workflow: Comprehensive — All Node Types Combined
 *
 * Exercises every node type and DSL feature in a single realistic workflow:
 * - .stage() with and without agent
 * - .tool() for deterministic computation
 * - .askUserQuestion() with static and dynamic questions
 * - .if() / .elseIf() / .else() / .endIf() conditional branching
 * - .loop() / .break() / .endLoop() bounded iteration
 * - globalState with multiple reducers
 * - loopState for loop-scoped state
 * - sessionConfig with per-agent-type model/reasoningEffort
 * - .version() and .argumentHint() metadata
 * - reads/outputs data flow declarations
 */
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-comprehensive",
    description: "Exercises every node type and SDK feature in one workflow",
    globalState: {
      tasks: {
        default: () => [] as Array<{ id: string; description: string; status: string }>,
        reducer: "mergeById",
        key: "id",
      },
      reviewResult: { default: null as null | { allPassing: boolean; issues: string[] } },
      approvalStatus: { default: "" },
      strategy: { default: "balanced" },
      totalIterations: { default: 0, reducer: "sum" },
      allFindings: { default: () => [] as string[], reducer: "concat" },
    },
  })
  .version("1.0.0")
  .argumentHint('"<prompt-or-spec-path>"')
  // Step 1: Ask the user for strategy
  .askUserQuestion({
    name: "choose-strategy",
    description: "Select workflow strategy",
    question: {
      question: "How should this workflow approach the task?",
      header: "Strategy Selection",
      options: [
        { label: "Fast", description: "Quick implementation, minimal review" },
        { label: "Balanced", description: "Standard implementation with review" },
        { label: "Thorough", description: "Deep analysis, multiple review cycles" },
      ],
    },
    onAnswer: (answer) => ({ strategy: String(answer).toLowerCase() }),
    outputs: ["strategy"],
  })
  // Step 2: Plan the work
  .stage({
    name: "planner",
    agent: "planner",
    description: "⌕ PLANNER",
    outputs: ["tasks"],
    prompt: (ctx) => `Using "${ctx.state.strategy}" strategy, plan:\n${ctx.userPrompt}`,
    outputMapper: (response) => {
      try {
        return { tasks: JSON.parse(response) };
      } catch {
        return { tasks: [{ id: "1", description: response, status: "pending" }] };
      }
    },
    sessionConfig: {
      model: { claude: "claude-sonnet-4-5-20250514" },
      reasoningEffort: { claude: "medium" },
    },
  })
  // Step 3: Validate the plan with a tool node
  .tool({
    name: "validate-plan",
    description: "Validate task plan structure",
    outputs: ["allFindings"],
    execute: async (ctx) => {
      const tasks = ctx.state.tasks;
      const findings: string[] = [];
      if (!Array.isArray(tasks) || tasks.length === 0) {
        findings.push("No tasks generated");
      }
      for (const task of tasks) {
        if (!task.id) findings.push(`Task missing id: ${JSON.stringify(task)}`);
        if (!task.description) findings.push(`Task ${task.id} missing description`);
      }
      return { allFindings: findings };
    },
  })
  // Step 4: Ask user to approve the plan (dynamic question based on state)
  .askUserQuestion({
    name: "approve-plan",
    description: "User approves the generated plan",
    question: (state) => {
      const tasks = state.tasks;
      const findings = state.allFindings;
      const issueNote = findings.length > 0
        ? `\n⚠️ ${findings.length} validation issue(s) found.`
        : "";
      return {
        question: `Plan has ${tasks.length} tasks.${issueNote} Approve?`,
        header: "Plan Approval",
        options: [
          { label: "Approve", description: "Proceed with implementation" },
          { label: "Reject", description: "Cancel and stop" },
        ],
      };
    },
    onAnswer: (answer) => ({ approvalStatus: String(answer).toLowerCase() }),
    outputs: ["approvalStatus"],
  })
  // Step 5: Conditional — only implement if approved
  .if((ctx) => ctx.state.approvalStatus === "approve")
    // Step 5a: Execute implementation
    .stage({
      name: "implementer",
      description: "⚡ IMPLEMENTER",
      prompt: (ctx) => {
        const tasks = ctx.state.tasks;
        return `Implement:\n${tasks.map((t) => `- ${t.description}`).join("\n")}`;
      },
      outputMapper: () => ({}),
      sessionConfig: {
        permissionMode: "auto",
      },
    })
    // Step 5b: Review loop
    .loop({
      maxCycles: 3,
      loopState: {
        loopFindings: { default: () => [] as string[], reducer: "concat" },
      },
    })
      .stage({
        name: "reviewer",
        agent: "reviewer",
        description: "🔍 REVIEWER",
        outputs: ["reviewResult", "allFindings", "totalIterations", "loopFindings"],
        prompt: (ctx) => `Review the implementation against:\n${ctx.userPrompt}`,
        outputMapper: (response) => {
          try {
            const parsed = JSON.parse(response);
            return {
              reviewResult: parsed,
              allFindings: parsed.issues ?? [],
              totalIterations: 1,
              loopFindings: parsed.issues ?? [],
            };
          } catch {
            return {
              reviewResult: { allPassing: false, issues: [response] },
              allFindings: [response],
              totalIterations: 1,
              loopFindings: [response],
            };
          }
        },
        sessionConfig: {
          model: { claude: "claude-opus-4-20250514" },
          reasoningEffort: { claude: "high" },
          maxThinkingTokens: 16000,
        },
      })
      // Break when all passing
      .break(() => (state) => {
        const result = state.reviewResult;
        return result?.allPassing === true;
      })
      // Conditional fix: only fix if there are actionable issues
      .if((ctx) => {
        const result = ctx.state.reviewResult;
        return (result?.issues?.length ?? 0) > 0;
      })
        .stage({
          name: "debugger",
          agent: "fixer",
          description: "🔧 DEBUGGER",
          prompt: (ctx) => {
            const review = ctx.stageOutputs.get("reviewer")?.rawResponse ?? "";
            return `Fix the issues found:\n${review}`;
          },
          outputMapper: () => ({}),
        })
      .else()
        .tool({
          name: "no-fix-needed",
          description: "No-op when no fixes required",
          execute: async () => ({}),
        })
      .endIf()
    .endLoop()
  .else()
    // Plan was rejected
    .stage({
      name: "report-rejection",
      description: "📋 REJECTION REPORT",
      prompt: () => "Generate a summary of why the plan was rejected.",
      outputMapper: () => ({}),
    })
  .endIf()
  .compile();
