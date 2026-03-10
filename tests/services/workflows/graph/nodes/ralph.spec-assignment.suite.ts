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
    expect(prompt).toContain("description");
    expect(prompt).toContain("status");
    expect(prompt).toContain("summary");
    expect(prompt).toContain("blockedBy");
  });

  test("instructs to output only JSON", () => {
    expect(buildSpecToTasksPrompt("test spec")).toContain(
      "Output ONLY the raw JSON array",
    );
  });
});

describe("buildWorkerAssignment", () => {
  test("includes task ID and content", () => {
    const task: TaskItem = {
      id: "#3",
      description: "Implement login endpoint",
      status: "pending",
      summary: "Implementing login endpoint",
    };

    const prompt = buildWorkerAssignment(task, [task]);

    expect(prompt).toContain("#3");
    expect(prompt).toContain("Implement login endpoint");
  });

  test("handles task without ID", () => {
    const task: TaskItem = {
      description: "Fix bug",
      status: "pending",
      summary: "Fixing bug",
    };

    const prompt = buildWorkerAssignment(task, [task]);

    expect(prompt).toContain("unknown");
    expect(prompt).toContain("Fix bug");
  });

  test("includes dependency information when blockedBy is present", () => {
    const task: TaskItem = {
      id: "#3",
      description: "Write tests",
      status: "pending",
      summary: "Writing tests",
      blockedBy: ["#1", "#2"],
    };
    const allTasks: TaskItem[] = [
      {
        id: "#1",
        description: "Setup project",
        status: "completed",
        summary: "Setting up project",
      },
      {
        id: "#2",
        description: "Implement feature",
        status: "completed",
        summary: "Implementing feature",
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
      description: "Independent task",
      status: "pending",
      summary: "Doing independent task",
      blockedBy: [],
    };

    expect(buildWorkerAssignment(task, [task])).not.toContain("Dependencies");
  });

  test("does not include dependency section when blockedBy is undefined", () => {
    const task: TaskItem = {
      id: "#1",
      description: "Independent task",
      status: "pending",
      summary: "Doing independent task",
    };

    expect(buildWorkerAssignment(task, [task])).not.toContain("Dependencies");
  });

  test("handles missing dependency task gracefully", () => {
    const task: TaskItem = {
      id: "#2",
      description: "Dependent task",
      status: "pending",
      summary: "Doing dependent task",
      blockedBy: ["#1", "#999"],
    };
    const allTasks: TaskItem[] = [
      {
        id: "#1",
        description: "First task",
        status: "completed",
        summary: "Doing first task",
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
      description: "New task",
      status: "pending",
      summary: "Doing new task",
    };
    const allTasks: TaskItem[] = [
      {
        id: "#1",
        description: "First task",
        status: "completed",
        summary: "Doing first task",
      },
      {
        id: "#2",
        description: "Second task",
        status: "completed",
        summary: "Doing second task",
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
      description: "New task",
      status: "pending",
      summary: "Doing new task",
    };
    const allTasks: TaskItem[] = [
      { id: "#1", description: "Task 1", status: "completed", summary: "Doing task 1" },
      { id: "#2", description: "Task 2", status: "complete", summary: "Doing task 2" },
      { id: "#3", description: "Task 3", status: "done", summary: "Doing task 3" },
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
      description: "First task",
      status: "pending",
      summary: "Doing first task",
    };
    const allTasks: TaskItem[] = [
      task,
      {
        id: "#2",
        description: "Second task",
        status: "pending",
        summary: "Doing second task",
      },
    ];

    const prompt = buildWorkerAssignment(task, allTasks);

    expect(prompt).not.toContain("Completed Tasks");
  });

  test("includes both dependencies and completed tasks when applicable", () => {
    const task: TaskItem = {
      id: "#3",
      description: "Third task",
      status: "pending",
      summary: "Doing third task",
      blockedBy: ["#1"],
    };
    const allTasks: TaskItem[] = [
      { id: "#1", description: "First task", status: "completed", summary: "Doing first task" },
      { id: "#2", description: "Second task", status: "completed", summary: "Doing second task" },
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
      description: "Task",
      status: "pending",
      summary: "Doing task",
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
      description: "New task",
      status: "pending",
      summary: "Doing new task",
    };
    const allTasks: TaskItem[] = [
      {
        description: "Unnamed task",
        status: "completed",
        summary: "Doing unnamed task",
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
      description: "Test task",
      status: "pending",
      summary: "Testing",
      blockedBy: ["#0"],
    };
    const allTasks: TaskItem[] = [
      { id: "#0", description: "Setup", status: "completed", summary: "Setting up" },
      task,
    ];

    const prompt1 = buildWorkerAssignment(task, allTasks);
    const prompt2 = buildWorkerAssignment(task, allTasks);

    expect(prompt1).toBe(prompt2);
  });

  test("handles empty allTasks array", () => {
    const task: TaskItem = {
      id: "#1",
      description: "Standalone task",
      status: "pending",
      summary: "Doing standalone task",
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
      description: "Complex task",
      status: "pending",
      summary: "Doing complex task",
      blockedBy: ["#1", "#2", "#3"],
    };
    const allTasks: TaskItem[] = [
      { id: "#1", description: "First dep", status: "completed", summary: "Doing first dep" },
      { id: "#2", description: "Second dep", status: "complete", summary: "Doing second dep" },
      { id: "#3", description: "Third dep", status: "done", summary: "Doing third dep" },
      { id: "#4", description: "Unrelated", status: "pending", summary: "Doing unrelated" },
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
      description: "Test formatting",
      status: "pending",
      summary: "Testing formatting",
      blockedBy: ["#1"],
    };
    const allTasks: TaskItem[] = [
      { id: "#1", description: "Setup", status: "completed", summary: "Setting up" },
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
      description: 'Fix bug: handle "quotes" & <tags> properly',
      status: "pending",
      summary: "Fixing bug",
    };

    expect(buildWorkerAssignment(task, [task])).toContain(
      'Fix bug: handle "quotes" & <tags> properly',
    );
  });

  test("handles very long task lists efficiently", () => {
    const task: TaskItem = {
      id: "#100",
      description: "Final task",
      status: "pending",
      summary: "Doing final task",
      blockedBy: ["#50"],
    };

    const allTasks: TaskItem[] = [];
    for (let index = 1; index < 100; index += 1) {
      allTasks.push({
        id: `#${index}`,
        description: `Task ${index}`,
        status: index % 2 === 0 ? "completed" : "pending",
        summary: `Doing task ${index}`,
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
