import { describe, expect, test } from "bun:test";
import { parseTasks } from "./workflow-commands.ts";

describe("parseTasks", () => {
  test("parses valid task JSON", () => {
    const tasks = parseTasks(
      JSON.stringify([
        {
          id: "#1",
          content: "Implement parsing",
          status: "pending",
          activeForm: "Implementing parsing",
          blockedBy: [],
        },
      ]),
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("#1");
    expect(tasks[0]?.status).toBe("pending");
  });

  test("rejects invalid range IDs", () => {
    const tasks = parseTasks(
      JSON.stringify([
        {
          id: "#2-#11",
          content: "Invalid id",
          status: "pending",
          activeForm: "Working",
        },
      ]),
    );

    expect(tasks).toEqual([]);
  });

  test("rejects duplicate task IDs", () => {
    const tasks = parseTasks(
      JSON.stringify([
        {
          id: "#1",
          content: "A",
          status: "pending",
          activeForm: "Working A",
        },
        {
          id: "#1",
          content: "B",
          status: "pending",
          activeForm: "Working B",
        },
      ]),
    );

    expect(tasks).toEqual([]);
  });

  test("rejects blockedBy IDs outside #N format", () => {
    const tasks = parseTasks(
      JSON.stringify([
        {
          id: "#1",
          content: "A",
          status: "pending",
          activeForm: "Working A",
          blockedBy: ["1"],
        },
      ]),
    );

    expect(tasks).toEqual([]);
  });

  test("rejects decomposition tasks with error status", () => {
    const tasks = parseTasks(
      JSON.stringify([
        {
          id: "#1",
          content: "A",
          status: "error",
          activeForm: "Working A",
        },
      ]),
    );

    expect(tasks).toEqual([]);
  });
});
