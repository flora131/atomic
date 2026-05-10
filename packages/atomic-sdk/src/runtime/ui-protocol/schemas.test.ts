import { test, expect, describe } from "bun:test";
import {
  AgentTypeSchema,
  WorkflowOverallStatusSchema,
  WorkflowStatusSnapshotSchema,
  WorkflowStatusSessionSchema,
  WorkflowStatusSnapshotOverallSchema,
  SavedMessageSchema,
  WorkflowDescriptorSchema,
  BrokenEntrySchema,
  RunInfoSchema,
  ProtocolGetVersionParamsSchema,
  ProtocolGetVersionResultSchema,
  ConnectParamsSchema,
  ConnectResultSchema,
  ProtocolSendTelemetryParamsSchema,
  WorkflowListParamsSchema,
  WorkflowListResultSchema,
  WorkflowRefreshParamsSchema,
  WorkflowRefreshResultSchema,
  WorkflowStartParamsSchema,
  WorkflowStartResultSchema,
  ChatStartParamsSchema,
  ChatStartResultSchema,
  RunListParamsSchema,
  RunListResultSchema,
  RunGetParamsSchema,
  RunGetResultSchema,
  RunStatusParamsSchema,
  RunStatusResultSchema,
  RunTranscriptParamsSchema,
  RunTranscriptResultSchema,
  RunStopParamsSchema,
  RunStopResultSchema,
  RunGetAttachInfoParamsSchema,
  RunGetAttachInfoResultSchema,
  RunSetForegroundParamsSchema,
  RunSetForegroundResultSchema,
  PaneSendInputParamsSchema,
  PaneSendInputResultSchema,
  PaneGetScrollbackParamsSchema,
  PaneGetScrollbackResultSchema,
  PanelGetParamsSchema,
  PanelGetResultSchema,
  PanelSubscribeParamsSchema,
  PanelSubscribeResultSchema,
  PanelUnsubscribeParamsSchema,
  PanelUnsubscribeResultSchema,
  AgentSpawnParamsSchema,
  AgentSpawnResultSchema,
  AgentKillParamsSchema,
  AgentKillResultSchema,
  PanelUpdateNotificationParamsSchema,
  PanelForegroundChangeNotificationParamsSchema,
  PaneOutputNotificationParamsSchema,
  PaneExitNotificationParamsSchema,
  RunStartedNotificationParamsSchema,
  RunEndedNotificationParamsSchema,
  ServerClosingNotificationParamsSchema,
  MethodSchemas,
  NotificationSchemas,
} from "./schemas";

describe("AgentTypeSchema", () => {
  test("accepts valid agent types", () => {
    expect(AgentTypeSchema.parse("claude")).toBe("claude");
    expect(AgentTypeSchema.parse("copilot")).toBe("copilot");
    expect(AgentTypeSchema.parse("opencode")).toBe("opencode");
  });

  test("rejects invalid agent type", () => {
    expect(() => AgentTypeSchema.parse("gpt")).toThrow();
  });
});

describe("WorkflowOverallStatusSchema", () => {
  test("accepts valid statuses", () => {
    expect(WorkflowOverallStatusSchema.parse("complete")).toBe("complete");
    expect(WorkflowOverallStatusSchema.parse("error")).toBe("error");
    expect(WorkflowOverallStatusSchema.parse("cancelled")).toBe("cancelled");
  });
});

describe("WorkflowStatusSnapshotOverallSchema", () => {
  test("accepts all valid overall statuses", () => {
    expect(WorkflowStatusSnapshotOverallSchema.parse("in_progress")).toBe("in_progress");
    expect(WorkflowStatusSnapshotOverallSchema.parse("error")).toBe("error");
    expect(WorkflowStatusSnapshotOverallSchema.parse("completed")).toBe("completed");
    expect(WorkflowStatusSnapshotOverallSchema.parse("needs_review")).toBe("needs_review");
  });

  test("rejects invalid overall status", () => {
    expect(() => WorkflowStatusSnapshotOverallSchema.parse("complete")).toThrow();
    expect(() => WorkflowStatusSnapshotOverallSchema.parse("unknown")).toThrow();
  });
});

describe("WorkflowStatusSessionSchema", () => {
  test("accepts minimal session entry", () => {
    const result = WorkflowStatusSessionSchema.parse({
      name: "orchestrator",
      status: "running",
      parents: [],
      startedAt: 1700000000000,
      endedAt: null,
    });
    expect(result.name).toBe("orchestrator");
    expect(result.status).toBe("running");
    expect(result.error).toBeUndefined();
  });

  test("accepts all valid session statuses", () => {
    const statuses = ["pending", "running", "complete", "error", "awaiting_input"] as const;
    for (const status of statuses) {
      expect(WorkflowStatusSessionSchema.parse({
        name: "s",
        status,
        parents: [],
        startedAt: null,
        endedAt: null,
      }).status).toBe(status);
    }
  });

  test("rejects invalid session status", () => {
    expect(() => WorkflowStatusSessionSchema.parse({
      name: "s",
      status: "unknown",
      parents: [],
      startedAt: null,
      endedAt: null,
    })).toThrow();
  });

  test("accepts optional error field", () => {
    const result = WorkflowStatusSessionSchema.parse({
      name: "s",
      status: "error",
      parents: ["root"],
      error: "timeout",
      startedAt: 100,
      endedAt: 200,
    });
    expect(result.error).toBe("timeout");
    expect(result.parents).toEqual(["root"]);
  });
});

describe("WorkflowStatusSnapshotSchema", () => {
  const validSnapshot = {
    schemaVersion: 1 as const,
    workflowRunId: "abc12345",
    tmuxSession: "atomic-wf-claude-main-abc12345",
    workflowName: "main",
    agent: "claude",
    prompt: "fix tests",
    overall: "in_progress" as const,
    completionReached: false,
    fatalError: null,
    updatedAt: "2024-01-01T00:00:00.000Z",
    sessions: [],
  };

  test("accepts valid snapshot with empty sessions", () => {
    const result = WorkflowStatusSnapshotSchema.parse(validSnapshot);
    expect(result.schemaVersion).toBe(1);
    expect(result.workflowRunId).toBe("abc12345");
    expect(result.overall).toBe("in_progress");
    expect(result.fatalError).toBeNull();
    expect(result.sessions).toEqual([]);
  });

  test("accepts snapshot with sessions", () => {
    const result = WorkflowStatusSnapshotSchema.parse({
      ...validSnapshot,
      overall: "completed",
      completionReached: true,
      sessions: [
        { name: "orchestrator", status: "complete", parents: [], startedAt: 100, endedAt: 200 },
      ],
    });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.name).toBe("orchestrator");
    expect(result.completionReached).toBe(true);
  });

  test("accepts fatalError string", () => {
    const result = WorkflowStatusSnapshotSchema.parse({
      ...validSnapshot,
      overall: "error",
      fatalError: "process crashed",
    });
    expect(result.fatalError).toBe("process crashed");
  });

  test("rejects missing required fields", () => {
    expect(() => WorkflowStatusSnapshotSchema.parse({ workflowRunId: "x" })).toThrow();
  });

  test("rejects wrong schemaVersion", () => {
    expect(() => WorkflowStatusSnapshotSchema.parse({ ...validSnapshot, schemaVersion: 2 })).toThrow();
  });

  test("rejects invalid overall value", () => {
    expect(() => WorkflowStatusSnapshotSchema.parse({ ...validSnapshot, overall: "complete" })).toThrow();
  });
});

describe("WorkflowDescriptorSchema", () => {
  test("accepts minimal descriptor", () => {
    const result = WorkflowDescriptorSchema.parse({
      name: "my-workflow",
      source: "/path/to/workflow.ts",
      agent: "claude",
    });
    expect(result.name).toBe("my-workflow");
    expect(result.displayName).toBeUndefined();
  });

  test("accepts full descriptor", () => {
    const input = { name: "env", type: "string" as const, required: true, description: "Env name" };
    const result = WorkflowDescriptorSchema.parse({
      name: "my-workflow",
      source: "/path/to/workflow.ts",
      agent: "copilot",
      displayName: "My Workflow",
      inputs: [input],
    });
    expect(result.displayName).toBe("My Workflow");
    expect(result.inputs).toEqual([input]);
  });
});

describe("protocol/getVersion", () => {
  test("params accepts empty object", () => {
    expect(ProtocolGetVersionParamsSchema.parse({})).toEqual({});
  });

  test("result validates version fields", () => {
    const result = ProtocolGetVersionResultSchema.parse({
      protocolVersion: "1.0.0",
      sdkVersion: "2.0.0",
      atomicVersion: "0.7.13",
    });
    expect(result.protocolVersion).toBe("1.0.0");
  });
});

describe("connect", () => {
  test("params requires clientName", () => {
    expect(() => ConnectParamsSchema.parse({})).toThrow();
    expect(ConnectParamsSchema.parse({ clientName: "my-client" })).toEqual({ clientName: "my-client" });
  });

  test("params accepts optional token", () => {
    const result = ConnectParamsSchema.parse({ clientName: "x", token: "abc" });
    expect(result.token).toBe("abc");
  });

  test("result must be { ok: true }", () => {
    expect(ConnectResultSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(() => ConnectResultSchema.parse({ ok: false })).toThrow();
  });
});

describe("protocol/sendTelemetry", () => {
  test("requires event field", () => {
    expect(() => ProtocolSendTelemetryParamsSchema.parse({})).toThrow();
    expect(ProtocolSendTelemetryParamsSchema.parse({ event: "pageview" })).toEqual({ event: "pageview" });
  });

  test("accepts optional payload", () => {
    const result = ProtocolSendTelemetryParamsSchema.parse({ event: "click", payload: { button: "ok" } });
    expect(result.payload).toEqual({ button: "ok" });
  });
});

describe("workflow/list", () => {
  test("params accepts empty object", () => {
    expect(WorkflowListParamsSchema.parse({})).toEqual({});
  });

  test("result is array of WorkflowDescriptor", () => {
    const result = WorkflowListResultSchema.parse([
      { name: "w1", source: "/w1.ts", agent: "claude" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.agent).toBe("claude");
  });
});

describe("workflow/refresh", () => {
  test("result has count and broken array", () => {
    const result = WorkflowRefreshResultSchema.parse({ count: 3, broken: [] });
    expect(result.count).toBe(3);
    expect(result.broken).toEqual([]);
  });

  test("broken entry has source and error", () => {
    const result = WorkflowRefreshResultSchema.parse({
      count: 1,
      broken: [{ source: "/bad.ts", error: "SyntaxError" }],
    });
    expect(result.broken[0]!.source).toBe("/bad.ts");
  });
});

describe("workflow/start", () => {
  test("params requires source, workflowName, agent, inputs", () => {
    expect(() => WorkflowStartParamsSchema.parse({})).toThrow();
    const result = WorkflowStartParamsSchema.parse({
      source: "/w.ts",
      workflowName: "main",
      agent: "opencode",
      inputs: {},
    });
    expect(result.source).toBe("/w.ts");
  });

  test("result has runId and attachable: true", () => {
    const result = WorkflowStartResultSchema.parse({ runId: "run-1", attachable: true });
    expect(result.runId).toBe("run-1");
    expect(result.attachable).toBe(true);
    expect(() => WorkflowStartResultSchema.parse({ runId: "x", attachable: false })).toThrow();
  });
});

describe("chat/start", () => {
  test("params accepts agent args env cwd and PTY dimensions", () => {
    const result = ChatStartParamsSchema.parse({
      agent: "claude",
      args: ["--help"],
      env: { FOO: "bar" },
      cwd: "/tmp/project",
      cols: 120,
      rows: 39,
    });
    expect(result.agent).toBe("claude");
    expect(result.args).toEqual(["--help"]);
    expect(result.cols).toBe(120);
    expect(result.rows).toBe(39);
  });

  test("result has runId and attachable true", () => {
    expect(ChatStartResultSchema.parse({ runId: "chat-1", attachable: true }).runId).toBe("chat-1");
  });
});

describe("run/list", () => {
  test("params accepts empty scope", () => {
    expect(RunListParamsSchema.parse({})).toEqual({});
  });

  test("params accepts valid scope values", () => {
    expect(RunListParamsSchema.parse({ scope: "active" })).toEqual({ scope: "active" });
    expect(RunListParamsSchema.parse({ scope: "completed" })).toEqual({ scope: "completed" });
    expect(RunListParamsSchema.parse({ scope: "all" })).toEqual({ scope: "all" });
    expect(() => RunListParamsSchema.parse({ scope: "invalid" })).toThrow();
  });
});

describe("run/get", () => {
  test("result can be null", () => {
    expect(RunGetResultSchema.parse(null)).toBeNull();
  });

  test("result can be RunInfo", () => {
    const result = RunGetResultSchema.parse({
      runId: "r1",
      workflowName: "wf",
      agent: "claude",
      status: "running",
      startedAt: "2026-01-01T00:00:00Z",
    });
    expect(result?.runId).toBe("r1");
  });
});

describe("run/status", () => {
  test("result can be null", () => {
    expect(RunStatusResultSchema.parse(null)).toBeNull();
  });

  test("result can be a typed WorkflowStatusSnapshot", () => {
    const snapshot = {
      schemaVersion: 1 as const,
      workflowRunId: "run-1",
      tmuxSession: "",
      workflowName: "main",
      agent: "claude",
      prompt: "",
      overall: "in_progress" as const,
      completionReached: false,
      fatalError: null,
      updatedAt: "2024-01-01T00:00:00.000Z",
      sessions: [],
    };
    const result = RunStatusResultSchema.parse(snapshot);
    expect(result?.workflowRunId).toBe("run-1");
    expect(result?.schemaVersion).toBe(1);
  });

  test("result rejects opaque arbitrary record", () => {
    expect(() => RunStatusResultSchema.parse({ stage: "main", progress: 50 })).toThrow();
  });
});

describe("run/getAttachInfo", () => {
  test("result has subscriptionId and nullable foregroundStage", () => {
    const result = RunGetAttachInfoResultSchema.parse({
      subscriptionId: "sub-1",
      foregroundStage: null,
    });
    expect(result.foregroundStage).toBeNull();

    const result2 = RunGetAttachInfoResultSchema.parse({
      subscriptionId: "sub-2",
      foregroundStage: "main",
    });
    expect(result2.foregroundStage).toBe("main");
  });
});

describe("pane/getScrollback", () => {
  test("result has data and headOffset", () => {
    const result = PaneGetScrollbackResultSchema.parse({ data: "output\n", headOffset: 42 });
    expect(result.data).toBe("output\n");
    expect(result.headOffset).toBe(42);
  });

  test("params fromOffset is optional", () => {
    expect(PaneGetScrollbackParamsSchema.parse({ runId: "r", stageName: "s" })).toEqual({
      runId: "r",
      stageName: "s",
    });
  });
});

describe("agent/spawn", () => {
  test("result has pid and scrollbackBytes: 0", () => {
    const result = AgentSpawnResultSchema.parse({ pid: 1234, scrollbackBytes: 0 });
    expect(result.pid).toBe(1234);
    expect(result.scrollbackBytes).toBe(0);
    expect(() => AgentSpawnResultSchema.parse({ pid: 1, scrollbackBytes: 1 })).toThrow();
  });
});

describe("agent/kill", () => {
  test("signal is optional", () => {
    expect(AgentKillParamsSchema.parse({ pid: 100 })).toEqual({ pid: 100 });
  });

  test("accepts SIGTERM and SIGKILL", () => {
    expect(AgentKillParamsSchema.parse({ pid: 1, signal: "SIGTERM" }).signal).toBe("SIGTERM");
    expect(AgentKillParamsSchema.parse({ pid: 1, signal: "SIGKILL" }).signal).toBe("SIGKILL");
    expect(() => AgentKillParamsSchema.parse({ pid: 1, signal: "SIGUSR1" })).toThrow();
  });
});

describe("Notifications", () => {
  test("panel/update has runId, snapshot, and version", () => {
    const result = PanelUpdateNotificationParamsSchema.parse({
      runId: "r1",
      snapshot: {
        schemaVersion: 1,
        workflowRunId: "r1",
        tmuxSession: "",
        workflowName: "main",
        agent: "claude",
        prompt: "",
        overall: "in_progress",
        completionReached: false,
        fatalError: null,
        updatedAt: "2024-01-01T00:00:00.000Z",
        sessions: [],
      },
      version: 3,
    });
    expect(result.runId).toBe("r1");
    expect(result.version).toBe(3);
  });

  test("panel/foregroundChange stageName is nullable", () => {
    expect(PanelForegroundChangeNotificationParamsSchema.parse({ runId: "r", stageName: null }).stageName).toBeNull();
    expect(PanelForegroundChangeNotificationParamsSchema.parse({ runId: "r", stageName: "main" }).stageName).toBe("main");
  });

  test("pane/output has offset", () => {
    const result = PaneOutputNotificationParamsSchema.parse({
      runId: "r",
      stageName: "s",
      data: "hello",
      offset: 5,
    });
    expect(result.offset).toBe(5);
  });

  test("pane/exit signal is optional", () => {
    expect(PaneExitNotificationParamsSchema.parse({ runId: "r", stageName: "s", exitCode: 0 }).signal).toBeUndefined();
  });

  test("run/ended overall uses WorkflowOverallStatus", () => {
    const result = RunEndedNotificationParamsSchema.parse({ runId: "r", overall: "complete" });
    expect(result.overall).toBe("complete");
    expect(() => RunEndedNotificationParamsSchema.parse({ runId: "r", overall: "unknown" })).toThrow();
  });

  test("server/closing reason is shutdown or fatal", () => {
    expect(ServerClosingNotificationParamsSchema.parse({ reason: "shutdown" }).reason).toBe("shutdown");
    expect(ServerClosingNotificationParamsSchema.parse({ reason: "fatal" }).reason).toBe("fatal");
    expect(() => ServerClosingNotificationParamsSchema.parse({ reason: "other" })).toThrow();
  });
});

describe("MethodSchemas registry", () => {
  const expectedMethods = [
    "protocol/getVersion",
    "connect",
    "protocol/sendTelemetry",
    "workflow/list",
    "workflow/refresh",
    "workflow/start",
    "chat/start",
    "run/list",
    "run/get",
    "run/status",
    "run/transcript",
    "run/stop",
    "run/getAttachInfo",
    "run/setForeground",
    "pane/sendInput",
    "pane/subscribeOutput",
    "pane/unsubscribeOutput",
    "pane/resize",
    "pane/getScrollback",
    "panel/get",
    "panel/subscribe",
    "panel/unsubscribe",
    "agent/spawn",
    "agent/kill",
  ];

  test("contains all 24 methods", () => {
    expect(Object.keys(MethodSchemas)).toHaveLength(24);
  });

  for (const method of expectedMethods) {
    test(`${method} has params and result schemas`, () => {
      const entry = MethodSchemas[method];
      expect(entry).toBeDefined();
      expect(entry!.params).toBeDefined();
      expect(entry!.result).toBeDefined();
    });
  }

  test("schemas can validate at runtime", () => {
    const entry = MethodSchemas["connect"]!;
    expect(entry.params.parse({ clientName: "test" })).toEqual({ clientName: "test" });
    expect(entry.result.parse({ ok: true })).toEqual({ ok: true });
  });
});

describe("NotificationSchemas registry", () => {
  const expectedNotifications = [
    "panel/update",
    "panel/foregroundChange",
    "pane/output",
    "pane/exit",
    "run/started",
    "run/ended",
    "server/closing",
  ];

  test("contains all 7 notifications", () => {
    expect(Object.keys(NotificationSchemas)).toHaveLength(7);
  });

  for (const notif of expectedNotifications) {
    test(`${notif} has params schema`, () => {
      expect(NotificationSchemas[notif]).toBeDefined();
    });
  }
});
