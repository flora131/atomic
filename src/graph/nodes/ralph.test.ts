import { describe, expect, test } from "bun:test";
import {
  buildSpecToTasksPrompt,
  buildTaskListPreamble,
  buildWorkerAssignment,
  buildBootstrappedTaskContext,
  buildDagDispatchPrompt,
  buildReviewPrompt,
  parseReviewResult,
  buildFixSpecFromReview,
  type TaskItem,
  type ReviewResult,
} from "./ralph.ts";

describe("buildSpecToTasksPrompt", () => {
  test("includes spec content in the prompt", () => {
    const spec = "Implement user authentication";
    const prompt = buildSpecToTasksPrompt(spec);
    
    expect(prompt).toContain(spec);
    expect(prompt).toContain("<specification>");
    expect(prompt).toContain("</specification>");
  });

  test("includes JSON schema definition", () => {
    const prompt = buildSpecToTasksPrompt("test spec");
    
    expect(prompt).toContain("id");
    expect(prompt).toContain("content");
    expect(prompt).toContain("status");
    expect(prompt).toContain("activeForm");
    expect(prompt).toContain("blockedBy");
  });

  test("instructs to output only JSON", () => {
    const prompt = buildSpecToTasksPrompt("test spec");
    
    expect(prompt).toContain("Output ONLY the JSON array");
  });
});

describe("buildTaskListPreamble", () => {
  test("includes task list as JSON", () => {
    const tasks = [
      { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing task 1", blockedBy: [] },
      { id: "#2", content: "Task 2", status: "completed", activeForm: "Doing task 2" },
    ];
    
    const preamble = buildTaskListPreamble(tasks);
    
    expect(preamble).toContain('"id": "#1"');
    expect(preamble).toContain('"content": "Task 1"');
    expect(preamble).toContain('"status": "pending"');
  });

  test("instructs to call TodoWrite first", () => {
    const tasks = [{ id: "#1", content: "Test", status: "pending", activeForm: "Testing" }];
    const preamble = buildTaskListPreamble(tasks);
    
    expect(preamble).toContain("TodoWrite");
    expect(preamble).toContain("FIRST action MUST be");
  });

  test("handles empty task list", () => {
    const preamble = buildTaskListPreamble([]);
    
    expect(preamble).toContain("[]");
    expect(preamble).toContain("TodoWrite");
  });
});

describe("buildWorkerAssignment", () => {
  test("includes task ID and content", () => {
    const task: TaskItem = {
      id: "#3",
      content: "Implement login endpoint",
      status: "pending",
      activeForm: "Implementing login endpoint",
    };
    const allTasks: TaskItem[] = [task];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("#3");
    expect(prompt).toContain("Implement login endpoint");
  });

  test("handles task without ID", () => {
    const task: TaskItem = {
      content: "Fix bug",
      status: "pending",
      activeForm: "Fixing bug",
    };
    const allTasks: TaskItem[] = [task];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("unknown");
    expect(prompt).toContain("Fix bug");
  });

  test("includes dependency information when blockedBy is present", () => {
    const task: TaskItem = {
      id: "#3",
      content: "Write tests",
      status: "pending",
      activeForm: "Writing tests",
      blockedBy: ["#1", "#2"],
    };
    const allTasks: TaskItem[] = [
      { id: "#1", content: "Setup project", status: "completed", activeForm: "Setting up project" },
      { id: "#2", content: "Implement feature", status: "completed", activeForm: "Implementing feature" },
      task,
    ];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("Dependencies");
    expect(prompt).toContain("#1");
    expect(prompt).toContain("Setup project");
    expect(prompt).toContain("#2");
    expect(prompt).toContain("Implement feature");
  });

  test("does not include dependency section when blockedBy is empty", () => {
    const task: TaskItem = {
      id: "#1",
      content: "Independent task",
      status: "pending",
      activeForm: "Doing independent task",
      blockedBy: [],
    };
    const allTasks: TaskItem[] = [task];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).not.toContain("Dependencies");
  });

  test("does not include dependency section when blockedBy is undefined", () => {
    const task: TaskItem = {
      id: "#1",
      content: "Independent task",
      status: "pending",
      activeForm: "Doing independent task",
    };
    const allTasks: TaskItem[] = [task];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).not.toContain("Dependencies");
  });

  test("handles missing dependency task gracefully", () => {
    const task: TaskItem = {
      id: "#2",
      content: "Dependent task",
      status: "pending",
      activeForm: "Doing dependent task",
      blockedBy: ["#1", "#999"],
    };
    const allTasks: TaskItem[] = [
      { id: "#1", content: "First task", status: "completed", activeForm: "Doing first task" },
      task,
    ];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("#1");
    expect(prompt).toContain("First task");
    expect(prompt).toContain("#999");
    expect(prompt).toContain("(not found)");
  });

  test("includes completed tasks context when present", () => {
    const task: TaskItem = {
      id: "#3",
      content: "New task",
      status: "pending",
      activeForm: "Doing new task",
    };
    const allTasks: TaskItem[] = [
      { id: "#1", content: "First task", status: "completed", activeForm: "Doing first task" },
      { id: "#2", content: "Second task", status: "completed", activeForm: "Doing second task" },
      task,
    ];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("Completed Tasks");
    expect(prompt).toContain("#1");
    expect(prompt).toContain("First task");
    expect(prompt).toContain("#2");
    expect(prompt).toContain("Second task");
  });

  test("recognizes different completed status variants", () => {
    const task: TaskItem = {
      id: "#4",
      content: "New task",
      status: "pending",
      activeForm: "Doing new task",
    };
    const allTasks: TaskItem[] = [
      { id: "#1", content: "Task 1", status: "completed", activeForm: "Doing task 1" },
      { id: "#2", content: "Task 2", status: "complete", activeForm: "Doing task 2" },
      { id: "#3", content: "Task 3", status: "done", activeForm: "Doing task 3" },
      task,
    ];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("Completed Tasks");
    expect(prompt).toContain("#1");
    expect(prompt).toContain("#2");
    expect(prompt).toContain("#3");
  });

  test("does not include completed tasks section when none are completed", () => {
    const task: TaskItem = {
      id: "#1",
      content: "First task",
      status: "pending",
      activeForm: "Doing first task",
    };
    const allTasks: TaskItem[] = [
      task,
      { id: "#2", content: "Second task", status: "pending", activeForm: "Doing second task" },
    ];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).not.toContain("Completed Tasks");
  });

  test("includes both dependencies and completed tasks when applicable", () => {
    const task: TaskItem = {
      id: "#3",
      content: "Third task",
      status: "pending",
      activeForm: "Doing third task",
      blockedBy: ["#1"],
    };
    const allTasks: TaskItem[] = [
      { id: "#1", content: "First task", status: "completed", activeForm: "Doing first task" },
      { id: "#2", content: "Second task", status: "completed", activeForm: "Doing second task" },
      task,
    ];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("Dependencies");
    expect(prompt).toContain("Completed Tasks");
    expect(prompt).toContain("#1");
    expect(prompt).toContain("#2");
  });

  test("includes implementation instructions", () => {
    const task: TaskItem = {
      id: "#1",
      content: "Task",
      status: "pending",
      activeForm: "Doing task",
    };
    const allTasks: TaskItem[] = [task];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("Instructions");
    expect(prompt).toContain("Focus solely on this task");
    expect(prompt).toContain("complete and tested");
    expect(prompt).toContain("Begin implementation");
  });

  test("handles task without id in completed tasks list", () => {
    const task: TaskItem = {
      id: "#2",
      content: "New task",
      status: "pending",
      activeForm: "Doing new task",
    };
    const allTasks: TaskItem[] = [
      { content: "Unnamed task", status: "completed", activeForm: "Doing unnamed task" },
      task,
    ];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("Completed Tasks");
    expect(prompt).toContain("?");
    expect(prompt).toContain("Unnamed task");
  });

  test("produces deterministic output for same inputs", () => {
    const task: TaskItem = {
      id: "#1",
      content: "Test task",
      status: "pending",
      activeForm: "Testing",
      blockedBy: ["#0"],
    };
    const allTasks: TaskItem[] = [
      { id: "#0", content: "Setup", status: "completed", activeForm: "Setting up" },
      task,
    ];
    
    const prompt1 = buildWorkerAssignment(task, allTasks);
    const prompt2 = buildWorkerAssignment(task, allTasks);
    
    expect(prompt1).toBe(prompt2);
  });

  test("handles empty allTasks array", () => {
    const task: TaskItem = {
      id: "#1",
      content: "Standalone task",
      status: "pending",
      activeForm: "Doing standalone task",
    };
    const allTasks: TaskItem[] = [task];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("#1");
    expect(prompt).toContain("Standalone task");
    expect(prompt).not.toContain("Completed Tasks");
    expect(prompt).not.toContain("Dependencies");
  });

  test("handles multiple dependencies with mixed states", () => {
    const task: TaskItem = {
      id: "#5",
      content: "Complex task",
      status: "pending",
      activeForm: "Doing complex task",
      blockedBy: ["#1", "#2", "#3"],
    };
    const allTasks: TaskItem[] = [
      { id: "#1", content: "First dep", status: "completed", activeForm: "Doing first dep" },
      { id: "#2", content: "Second dep", status: "complete", activeForm: "Doing second dep" },
      { id: "#3", content: "Third dep", status: "done", activeForm: "Doing third dep" },
      { id: "#4", content: "Unrelated", status: "pending", activeForm: "Doing unrelated" },
      task,
    ];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("Dependencies");
    expect(prompt).toContain("#1");
    expect(prompt).toContain("First dep");
    expect(prompt).toContain("#2");
    expect(prompt).toContain("Second dep");
    expect(prompt).toContain("#3");
    expect(prompt).toContain("Third dep");
    expect(prompt).toContain("Completed Tasks");
  });

  test("formats prompt with proper sections and line breaks", () => {
    const task: TaskItem = {
      id: "#2",
      content: "Test formatting",
      status: "pending",
      activeForm: "Testing formatting",
      blockedBy: ["#1"],
    };
    const allTasks: TaskItem[] = [
      { id: "#1", content: "Setup", status: "completed", activeForm: "Setting up" },
      task,
    ];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("# Task Assignment");
    expect(prompt).toContain("**Task ID:**");
    expect(prompt).toContain("**Task:**");
    expect(prompt).toContain("# Dependencies");
    expect(prompt).toContain("# Completed Tasks");
    expect(prompt).toContain("# Instructions");
  });

  test("handles task content with special characters", () => {
    const task: TaskItem = {
      id: "#1",
      content: "Fix bug: handle \"quotes\" & <tags> properly",
      status: "pending",
      activeForm: "Fixing bug",
    };
    const allTasks: TaskItem[] = [task];
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("Fix bug: handle \"quotes\" & <tags> properly");
  });

  test("handles very long task lists efficiently", () => {
    const task: TaskItem = {
      id: "#100",
      content: "Final task",
      status: "pending",
      activeForm: "Doing final task",
      blockedBy: ["#50"],
    };
    
    const allTasks: TaskItem[] = [];
    for (let i = 1; i < 100; i++) {
      allTasks.push({
        id: `#${i}`,
        content: `Task ${i}`,
        status: i % 2 === 0 ? "completed" : "pending",
        activeForm: `Doing task ${i}`,
      });
    }
    allTasks.push(task);
    
    const prompt = buildWorkerAssignment(task, allTasks);
    
    expect(prompt).toContain("#100");
    expect(prompt).toContain("Final task");
    expect(prompt).toContain("Completed Tasks");
    expect(prompt).toContain("Dependencies");
    // Verify it includes many completed tasks
    const completedCount = prompt.split("- #").length - 1;
    expect(completedCount).toBeGreaterThan(40); // Should have ~50 completed tasks listed
  });
});

describe("buildBootstrappedTaskContext", () => {
  test("includes session ID", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing task 1" },
    ];
    const result = buildBootstrappedTaskContext(tasks, "abc-123");

    expect(result).toContain("abc-123");
  });

  test("includes task list as JSON", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Setup project", status: "pending", activeForm: "Setting up", blockedBy: [] },
      { id: "#2", content: "Add feature", status: "pending", activeForm: "Adding feature", blockedBy: ["#1"] },
    ];
    const result = buildBootstrappedTaskContext(tasks, "session-1");

    expect(result).toContain('"id": "#1"');
    expect(result).toContain('"content": "Setup project"');
    expect(result).toContain('"id": "#2"');
    expect(result).toContain('"blockedBy"');
  });

  test("includes implementation instructions", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Task", status: "pending", activeForm: "Doing" },
    ];
    const result = buildBootstrappedTaskContext(tasks, "session-1");

    expect(result).toContain("Instructions");
    expect(result).toContain("dependency order");
    expect(result).toContain("blockedBy");
  });

  test("handles empty task list", () => {
    const result = buildBootstrappedTaskContext([], "session-1");

    expect(result).toContain("[]");
    expect(result).toContain("session-1");
  });

  test("produces deterministic output", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Task 1", status: "pending", activeForm: "Doing 1" },
      { id: "#2", content: "Task 2", status: "pending", activeForm: "Doing 2", blockedBy: ["#1"] },
    ];
    const result1 = buildBootstrappedTaskContext(tasks, "session-x");
    const result2 = buildBootstrappedTaskContext(tasks, "session-x");

    expect(result1).toBe(result2);
  });
});

describe("buildReviewPrompt", () => {
  test("includes user prompt in review request", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Add login", status: "completed", activeForm: "Adding login" },
    ];
    const userPrompt = "Implement user authentication";
    const prompt = buildReviewPrompt(tasks, userPrompt);

    expect(prompt).toContain("Implement user authentication");
    expect(prompt).toContain("<user_request>");
    expect(prompt).toContain("</user_request>");
  });

  test("lists all completed tasks", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Setup DB", status: "completed", activeForm: "Setting up" },
      { id: "#2", content: "Add API", status: "completed", activeForm: "Adding API" },
      { id: "#3", content: "Not done yet", status: "pending", activeForm: "Working" },
    ];
    const prompt = buildReviewPrompt(tasks, "Build backend");

    expect(prompt).toContain("#1");
    expect(prompt).toContain("Setup DB");
    expect(prompt).toContain("#2");
    expect(prompt).toContain("Add API");
    expect(prompt).not.toContain("Not done yet");
  });

  test("includes review focus areas", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Task", status: "completed", activeForm: "Working" },
    ];
    const prompt = buildReviewPrompt(tasks, "Test");

    expect(prompt).toContain("Correctness of Logic");
    expect(prompt).toContain("Error Handling");
    expect(prompt).toContain("Edge Cases");
    expect(prompt).toContain("Security Concerns");
    expect(prompt).toContain("Performance Implications");
    expect(prompt).toContain("Test Coverage");
  });

  test("specifies JSON output format", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Task", status: "completed", activeForm: "Working" },
    ];
    const prompt = buildReviewPrompt(tasks, "Test");

    expect(prompt).toContain("findings");
    expect(prompt).toContain("overall_correctness");
    expect(prompt).toContain("overall_explanation");
    expect(prompt).toContain("confidence_score");
  });

  test("defines priority levels", () => {
    const tasks: TaskItem[] = [
      { id: "#1", content: "Task", status: "completed", activeForm: "Working" },
    ];
    const prompt = buildReviewPrompt(tasks, "Test");

    expect(prompt).toContain("P0");
    expect(prompt).toContain("P1");
    expect(prompt).toContain("P2");
    expect(prompt).toContain("P3");
    expect(prompt).toContain("Critical");
    expect(prompt).toContain("Important");
  });

  test("handles tasks without IDs", () => {
    const tasks: TaskItem[] = [
      { content: "Unnamed task", status: "completed", activeForm: "Working" },
    ];
    const prompt = buildReviewPrompt(tasks, "Test");

    expect(prompt).toContain("?");
    expect(prompt).toContain("Unnamed task");
  });
});

describe("parseReviewResult", () => {
  test("parses direct JSON", () => {
    const json = JSON.stringify({
      findings: [
        {
          title: "[P0] Critical bug",
          body: "Description",
          priority: 0,
          confidence_score: 0.95,
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Has bugs",
      overall_confidence_score: 0.9,
    });

    const result = parseReviewResult(json);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.title).toBe("[P0] Critical bug");
    expect(result?.overall_correctness).toBe("patch is incorrect");
  });

  test("parses JSON from markdown code fence", () => {
    const markdown = `Here's the review:

\`\`\`json
{
  "findings": [{"title": "[P1] Issue", "body": "Details", "priority": 1}],
  "overall_correctness": "patch is correct",
  "overall_explanation": "Looks good"
}
\`\`\`

End of review.`;

    const result = parseReviewResult(markdown);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(1);
    expect(result?.findings[0]?.title).toBe("[P1] Issue");
  });

  test("parses JSON from surrounding prose", () => {
    const prose = `After careful review, here are my findings: {"findings": [{"title": "[P2] Minor issue", "body": "Detail", "priority": 2}], "overall_correctness": "patch is correct", "overall_explanation": "Good work"} That completes the review.`;

    const result = parseReviewResult(prose);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(1);
  });

  test("filters out P3 (low priority) findings", () => {
    const json = JSON.stringify({
      findings: [
        { title: "[P0] Critical", body: "Must fix", priority: 0 },
        { title: "[P1] Important", body: "Should fix", priority: 1 },
        { title: "[P2] Moderate", body: "Could fix", priority: 2 },
        { title: "[P3] Minor", body: "Style nit", priority: 3 },
      ],
      overall_correctness: "patch is correct",
      overall_explanation: "Mostly good",
    });

    const result = parseReviewResult(json);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(3);
    expect(result?.findings.some((f) => f.priority === 3)).toBe(false);
  });

  test("handles findings without priority field", () => {
    const json = JSON.stringify({
      findings: [{ title: "Issue", body: "Details" }],
      overall_correctness: "patch is correct",
      overall_explanation: "OK",
    });

    const result = parseReviewResult(json);

    expect(result).not.toBeNull();
    expect(result?.findings).toHaveLength(1);
  });

  test("returns null for invalid JSON", () => {
    const result = parseReviewResult("This is not JSON at all");

    expect(result).toBeNull();
  });

  test("returns null for JSON without required fields", () => {
    const json = JSON.stringify({ some_field: "value" });

    const result = parseReviewResult(json);

    expect(result).toBeNull();
  });
});

describe("buildFixSpecFromReview", () => {
  test("returns empty string when no findings", () => {
    const review: ReviewResult = {
      findings: [],
      overall_correctness: "patch is correct",
      overall_explanation: "No issues found",
    };
    const tasks: TaskItem[] = [];
    const spec = buildFixSpecFromReview(review, tasks, "Original request");

    expect(spec).toBe("");
  });

  test("returns empty string when patch is correct with no findings", () => {
    const review: ReviewResult = {
      findings: [],
      overall_correctness: "patch is correct",
      overall_explanation: "All good",
    };
    const tasks: TaskItem[] = [];
    const spec = buildFixSpecFromReview(review, tasks, "Test");

    expect(spec).toBe("");
  });

  test("generates fix spec with single finding", () => {
    const review: ReviewResult = {
      findings: [
        {
          title: "[P0] Null pointer bug",
          body: "Code crashes on null input",
          priority: 0,
          confidence_score: 0.95,
          code_location: {
            absolute_file_path: "/path/to/file.ts",
            line_range: { start: 10, end: 15 },
          },
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Critical bug found",
    };
    const tasks: TaskItem[] = [];
    const spec = buildFixSpecFromReview(review, tasks, "Add feature X");

    expect(spec).toContain("# Review Fix Specification");
    expect(spec).toContain("Add feature X");
    expect(spec).toContain("patch is incorrect");
    expect(spec).toContain("Critical bug found");
    expect(spec).toContain("Finding 1");
    expect(spec).toContain("[P0] Null pointer bug");
    expect(spec).toContain("P0");
    expect(spec).toContain("/path/to/file.ts:10-15");
    expect(spec).toContain("Code crashes on null input");
  });

  test("sorts findings by priority", () => {
    const review: ReviewResult = {
      findings: [
        { title: "[P2] Moderate", body: "Issue 1", priority: 2 },
        { title: "[P0] Critical", body: "Issue 2", priority: 0 },
        { title: "[P1] Important", body: "Issue 3", priority: 1 },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Multiple issues",
    };
    const tasks: TaskItem[] = [];
    const spec = buildFixSpecFromReview(review, tasks, "Test");

    const p0Index = spec.indexOf("[P0] Critical");
    const p1Index = spec.indexOf("[P1] Important");
    const p2Index = spec.indexOf("[P2] Moderate");

    expect(p0Index).toBeLessThan(p1Index);
    expect(p1Index).toBeLessThan(p2Index);
  });

  test("handles findings without code location", () => {
    const review: ReviewResult = {
      findings: [
        {
          title: "[P1] General issue",
          body: "No specific location",
          priority: 1,
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Has issues",
    };
    const tasks: TaskItem[] = [];
    const spec = buildFixSpecFromReview(review, tasks, "Test");

    expect(spec).toContain("Location not specified");
  });

  test("handles findings without explicit priority", () => {
    const review: ReviewResult = {
      findings: [
        {
          title: "Issue without priority",
          body: "Details",
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Issue found",
    };
    const tasks: TaskItem[] = [];
    const spec = buildFixSpecFromReview(review, tasks, "Test");

    expect(spec).toContain("P2"); // Default priority
  });

  test("includes fix guidelines", () => {
    const review: ReviewResult = {
      findings: [
        {
          title: "[P0] Bug",
          body: "Fix this",
          priority: 0,
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Bug exists",
    };
    const tasks: TaskItem[] = [];
    const spec = buildFixSpecFromReview(review, tasks, "Test");

    expect(spec).toContain("Fix Guidelines");
    expect(spec).toContain("priority order");
    expect(spec).toContain("existing tests");
    expect(spec).toContain("minimal changes");
  });

  test("includes rubric for each finding", () => {
    const review: ReviewResult = {
      findings: [
        {
          title: "[P1] Issue",
          body: "Problem description",
          priority: 1,
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "Issue found",
    };
    const tasks: TaskItem[] = [];
    const spec = buildFixSpecFromReview(review, tasks, "Test");

    expect(spec).toContain("Rubric");
    expect(spec).toContain("fix is complete when");
  });
});

describe("buildDagDispatchPrompt", () => {
  test("includes session ID and progress", () => {
    const allTasks: TaskItem[] = [
      { id: "#1", content: "Task A", status: "completed", activeForm: "Working" },
      { id: "#2", content: "Task B", status: "pending", activeForm: "Working" },
    ];
    const readyTasks: TaskItem[] = [
      { id: "#2", content: "Task B", status: "pending", activeForm: "Working" },
    ];
    const prompt = buildDagDispatchPrompt(allTasks, readyTasks, "test-session");

    expect(prompt).toContain("test-session");
    expect(prompt).toContain("1/2 tasks completed");
  });

  test("lists all ready tasks explicitly", () => {
    const allTasks: TaskItem[] = [
      { id: "#1", content: "Task A", status: "pending", activeForm: "Doing A" },
      { id: "#2", content: "Task B", status: "pending", activeForm: "Doing B" },
      { id: "#3", content: "Task C", status: "pending", activeForm: "Doing C" },
    ];
    const readyTasks = allTasks;
    const prompt = buildDagDispatchPrompt(allTasks, readyTasks, "s1");

    expect(prompt).toContain("- #1: Task A");
    expect(prompt).toContain("- #2: Task B");
    expect(prompt).toContain("- #3: Task C");
    expect(prompt).toContain("3 task(s)");
  });

  test("instructs parallel dispatch", () => {
    const allTasks: TaskItem[] = [
      { id: "#1", content: "Task A", status: "pending", activeForm: "Working" },
    ];
    const prompt = buildDagDispatchPrompt(allTasks, allTasks, "s1");

    expect(prompt).toContain("parallel");
    expect(prompt).toContain("simultaneously");
  });

  test("handles empty ready tasks", () => {
    const allTasks: TaskItem[] = [
      { id: "#1", content: "Task A", status: "pending", activeForm: "Working", blockedBy: ["#2"] },
      { id: "#2", content: "Task B", status: "error", activeForm: "Working" },
    ];
    const prompt = buildDagDispatchPrompt(allTasks, [], "s1");

    expect(prompt).toContain("0 task(s)");
    expect(prompt).toContain("No tasks are currently ready");
  });

  test("includes task list JSON", () => {
    const allTasks: TaskItem[] = [
      { id: "#1", content: "Task A", status: "completed", activeForm: "Working" },
      { id: "#2", content: "Task B", status: "pending", activeForm: "Working" },
    ];
    const prompt = buildDagDispatchPrompt(allTasks, [allTasks[1]!], "s1");

    expect(prompt).toContain('"#1"');
    expect(prompt).toContain('"completed"');
    expect(prompt).toContain('"#2"');
    expect(prompt).toContain('"pending"');
  });

  test("only lists ready tasks in dispatch section, not all tasks", () => {
    const allTasks: TaskItem[] = [
      { id: "#1", content: "Done task", status: "completed", activeForm: "Done" },
      { id: "#2", content: "Ready task", status: "pending", activeForm: "Ready" },
      { id: "#3", content: "Blocked task", status: "pending", activeForm: "Blocked", blockedBy: ["#2"] },
    ];
    const readyTasks: TaskItem[] = [allTasks[1]!];
    const prompt = buildDagDispatchPrompt(allTasks, readyTasks, "s1");

    // Ready Tasks section should list #2 but not #1 or #3
    const readySection = prompt.split("# Ready Tasks")[1]?.split("# Instructions")[0] ?? "";
    expect(readySection).toContain("- #2: Ready task");
    expect(readySection).not.toContain("- #1:");
    expect(readySection).not.toContain("- #3:");
  });
});
