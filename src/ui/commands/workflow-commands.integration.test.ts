import { describe, expect, test } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";
import type { CommandContext } from "./registry.ts";
import { getWorkflowCommands } from "./workflow-commands.ts";

function createMockContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "" }),
    streamAndWait: async () => ({ content: "", wasInterrupted: false, wasCancelled: false }),
    waitForUserInput: async () => "",
    clearContext: async () => {},
    setTodoItems: () => {},
    setRalphSessionDir: () => {},
    setRalphSessionId: () => {},
    setRalphTaskIds: () => {},
    updateWorkflowState: () => {},
    ...overrides,
  };
}

describe("/ralph integration", () => {
  test("persists tasks.json and completes full cycle", async () => {
    let sessionDir: string | null = null;

    const context = createMockContext({
      streamAndWait: async () => ({
        content: JSON.stringify([
          {
            id: "#1",
            content: "First task",
            status: "pending",
            activeForm: "Doing first task",
            blockedBy: [],
          },
          {
            id: "#2",
            content: "Second task",
            status: "pending",
            activeForm: "Doing second task",
            blockedBy: ["#1"],
          },
        ]),
        wasInterrupted: false,
        wasCancelled: false,
      }),
      spawnSubagent: async ({ name }) => {
        if (name === "reviewer") {
          return {
            success: true,
            output: JSON.stringify({
              findings: [],
              overall_correctness: "patch is correct",
              overall_explanation: "No findings",
              overall_confidence_score: 0.92,
            }),
          };
        }

        return {
          success: true,
          output: "worker done",
        };
      },
      setRalphSessionDir: (dir) => {
        sessionDir = dir;
      },
    });

    const command = getWorkflowCommands().find((candidate) => candidate.name === "ralph");
    expect(command).toBeDefined();

    const result = await command!.execute("Implement workflow", context);
    expect(result.success).toBe(true);
    expect(sessionDir).not.toBeNull();
    const workflowPhases = result.workflowPhases ?? [];
    expect(workflowPhases.length).toBeGreaterThan(0);
    expect(workflowPhases.some((phase) => phase.phaseName === "Task Decomposition")).toBe(true);
    expect(workflowPhases.some((phase) => phase.phaseName === "Implementation")).toBe(true);
    expect(workflowPhases.some((phase) => phase.phaseName === "Code Review")).toBe(true);
    expect(workflowPhases.some((phase) => phase.events.length > 0)).toBe(true);

    const allowedEventTypes = new Set([
      "tool_call",
      "tool_result",
      "text",
      "agent_spawn",
      "agent_complete",
      "error",
      "progress",
    ]);
    for (const phase of workflowPhases) {
      expect(phase.phaseName.length).toBeGreaterThan(0);
      expect(phase.message.length).toBeGreaterThan(0);
      const startedAtMs = Date.parse(phase.startedAt);
      const completedAtMs = Date.parse(phase.completedAt ?? "");
      expect(Number.isNaN(startedAtMs)).toBe(false);
      expect(Number.isNaN(completedAtMs)).toBe(false);
      expect(completedAtMs).toBeGreaterThanOrEqual(startedAtMs);
      expect(phase.durationMs).toBe(completedAtMs - startedAtMs);
      expect(phase.status).toBe("completed");
      for (const event of phase.events) {
        expect(allowedEventTypes.has(event.type)).toBe(true);
        expect(event.content.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
      }
    }

    if (!sessionDir) {
      throw new Error("sessionDir was not set");
    }

    const tasksPath = join(sessionDir, "tasks.json");
    const saved = JSON.parse(await readFile(tasksPath, "utf-8")) as Array<{
      id: string;
      status: string;
    }>;

    expect(saved).toHaveLength(2);
    expect(saved.every((task) => task.status === "completed")).toBe(true);
  });

  test("phase timing captures phase start before delayed stream output", async () => {
    const context = createMockContext({
      streamAndWait: async () => {
        await Bun.sleep(35);
        return {
          content: JSON.stringify([
            {
              id: "#1",
              content: "Delayed task",
              status: "pending",
              activeForm: "Doing delayed task",
              blockedBy: [],
            },
          ]),
          wasInterrupted: false,
          wasCancelled: false,
        };
      },
      spawnSubagent: async ({ name }) => {
        await Bun.sleep(35);
        if (name === "reviewer") {
          return {
            success: true,
            output: JSON.stringify({
              findings: [],
              overall_correctness: "patch is correct",
              overall_explanation: "No findings",
              overall_confidence_score: 0.92,
            }),
          };
        }
        return { success: true, output: "worker done" };
      },
    });

    const command = getWorkflowCommands().find((candidate) => candidate.name === "ralph");
    expect(command).toBeDefined();
    const result = await command!.execute("Inspect phase timing", context);
    expect(result.success).toBe(true);

    const workflowPhases = result.workflowPhases ?? [];
    const agentPhase = workflowPhases.find((phase) =>
      phase.events.some((event) => event.type === "agent_spawn"),
    );
    expect(agentPhase).toBeDefined();

    const startedAtMs = Date.parse(agentPhase!.startedAt);
    const completedAtMs = Date.parse(agentPhase!.completedAt ?? "");
    expect(Number.isNaN(startedAtMs)).toBe(false);
    expect(Number.isNaN(completedAtMs)).toBe(false);
    expect(agentPhase!.durationMs).toBe(completedAtMs - startedAtMs);
    expect((agentPhase!.durationMs ?? 0)).toBeGreaterThanOrEqual(30);
    expect((agentPhase!.durationMs ?? 0)).toBeLessThanOrEqual(completedAtMs - startedAtMs);

    const streamedPhase = workflowPhases.find((phase) =>
      phase.events.some((event) => event.type === "text"),
    );
    expect(streamedPhase).toBeDefined();
    const firstTextEvent = streamedPhase!.events.find((event) => event.type === "text");
    expect(firstTextEvent).toBeDefined();
    const streamedStartMs = Date.parse(streamedPhase!.startedAt);
    const streamedCompletedAtMs = Date.parse(streamedPhase!.completedAt ?? "");
    const firstTextEventMs = Date.parse(firstTextEvent!.timestamp);
    expect(Number.isNaN(streamedCompletedAtMs)).toBe(false);
    expect(streamedPhase!.durationMs).toBe(streamedCompletedAtMs - streamedStartMs);
    expect(streamedStartMs).toBeLessThan(firstTextEventMs);
    expect(streamedPhase!.durationMs ?? 0).toBeGreaterThanOrEqual(firstTextEventMs - streamedStartMs);
  });

  test("phase timing uses execution bounds instead of slow task list rendering", async () => {
    let firstTodoUpdateStartedAt: number | undefined;
    let firstTodoUpdateFinishedAt: number | undefined;

    const context = createMockContext({
      streamAndWait: async () => ({
        content: JSON.stringify([
          {
            id: "#1",
            content: "Task with slow UI update",
            status: "pending",
            activeForm: "Doing task with slow UI update",
            blockedBy: [],
          },
        ]),
        wasInterrupted: false,
        wasCancelled: false,
      }),
      spawnSubagent: async ({ name }) => {
        if (name === "reviewer") {
          return {
            success: true,
            output: JSON.stringify({
              findings: [],
              overall_correctness: "patch is correct",
              overall_explanation: "No findings",
              overall_confidence_score: 0.92,
            }),
          };
        }
        return { success: true, output: "worker done" };
      },
      setTodoItems: () => {
        if (firstTodoUpdateStartedAt != null) return;
        firstTodoUpdateStartedAt = Date.now();
        const endMs = firstTodoUpdateStartedAt + 120;
        while (Date.now() < endMs) {
          // Busy wait to simulate slow synchronous UI update.
        }
        firstTodoUpdateFinishedAt = Date.now();
      },
    });

    const command = getWorkflowCommands().find((candidate) => candidate.name === "ralph");
    expect(command).toBeDefined();
    const result = await command!.execute("Inspect phase timing bounds", context);
    expect(result.success).toBe(true);

    const taskDecompositionPhase = (result.workflowPhases ?? []).find(
      (phase) => phase.phaseName === "Task Decomposition",
    );
    expect(taskDecompositionPhase).toBeDefined();
    expect(firstTodoUpdateStartedAt).toBeDefined();
    expect(firstTodoUpdateFinishedAt).toBeDefined();

    const completedAtMs = Date.parse(taskDecompositionPhase!.completedAt ?? "");
    const startedAtMs = Date.parse(taskDecompositionPhase!.startedAt);
    expect(Number.isNaN(startedAtMs)).toBe(false);
    expect(Number.isNaN(completedAtMs)).toBe(false);
    expect(taskDecompositionPhase!.durationMs).toBe(completedAtMs - startedAtMs);
    expect(completedAtMs).toBeLessThanOrEqual(firstTodoUpdateStartedAt!);
    expect(taskDecompositionPhase!.durationMs ?? 0).toBeLessThan(
      firstTodoUpdateFinishedAt! - firstTodoUpdateStartedAt!,
    );
  });
});
