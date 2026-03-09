import { describe, expect, test } from "bun:test";
import {
  buildSpecToTasksPrompt,
  buildWorkerAssignment,
  type TaskItem,
} from "./ralph.test-support.ts";

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
    expect(buildSpecToTasksPrompt("test spec")).toContain(
      "Output ONLY the JSON array",
    );
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

    const prompt = buildWorkerAssignment(task, [task]);

    expect(prompt).toContain("#3");
    expect(prompt).toContain("Implement login endpoint");
  });

  test("handles task without ID", () => {
    const task: TaskItem = {
      content: "Fix bug",
      status: "pending",
      activeForm: "Fixing bug",
    };

    const prompt = buildWorkerAssignment(task, [task]);

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
      {
        id: "#1",
        content: "Setup project",
        status: "completed",
        activeForm: "Setting up project",
      },
      {
        id: "#2",
        content: "Implement feature",
        status: "completed",
        activeForm: "Implementing feature",
      },
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

    expect(buildWorkerAssignment(task, [task])).not.toContain("Dependencies");
  });

  test("does not include dependency section when blockedBy is undefined", () => {
    const task: TaskItem = {
      id: "#1",
      content: "Independent task",
      status: "pending",
      activeForm: "Doing independent task",
    };

    expect(buildWorkerAssignment(task, [task])).not.toContain("Dependencies");
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
      {
        id: "#1",
        content: "First task",
        status: "completed",
        activeForm: "Doing first task",
      },
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
      {
        id: "#1",
        content: "First task",
        status: "completed",
        activeForm: "Doing first task",
      },
      {
        id: "#2",
        content: "Second task",
        status: "completed",
        activeForm: "Doing second task",
      },
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
      {
        id: "#2",
        content: "Second task",
        status: "pending",
        activeForm: "Doing second task",
      },
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

    const prompt = buildWorkerAssignment(task, [task]);

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
      {
        content: "Unnamed task",
        status: "completed",
        activeForm: "Doing unnamed task",
      },
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

    const prompt = buildWorkerAssignment(task, [task]);

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
      content: 'Fix bug: handle "quotes" & <tags> properly',
      status: "pending",
      activeForm: "Fixing bug",
    };

    expect(buildWorkerAssignment(task, [task])).toContain(
      'Fix bug: handle "quotes" & <tags> properly',
    );
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
    for (let index = 1; index < 100; index += 1) {
      allTasks.push({
        id: `#${index}`,
        content: `Task ${index}`,
        status: index % 2 === 0 ? "completed" : "pending",
        activeForm: `Doing task ${index}`,
      });
    }
    allTasks.push(task);

    const prompt = buildWorkerAssignment(task, allTasks);

    expect(prompt).toContain("#100");
    expect(prompt).toContain("Final task");
    expect(prompt).toContain("Completed Tasks");
    expect(prompt).toContain("Dependencies");
    expect(prompt.split("- #").length - 1).toBeGreaterThan(40);
  });
});
