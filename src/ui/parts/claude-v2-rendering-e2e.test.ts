import { beforeEach, describe, expect, test } from "bun:test";
import { ClaudeAgentClient } from "../../sdk/clients/index.ts";
import { createPartId, _resetPartCounter } from "./id.ts";
import { upsertPart } from "./store.ts";
import type { AgentPart, Part, ToolPart } from "./types.ts";
import type { ChatMessage } from "../chat.tsx";

function createMockMessage(): ChatMessage {
  return {
    id: "msg-claude-v2",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    parts: [],
    streaming: true,
  };
}

function createRunningToolPart(toolCallId: string, toolName: string): ToolPart {
  return {
    id: createPartId(),
    type: "tool",
    toolCallId,
    toolName,
    input: { command: "pwd" },
    state: { status: "running", startedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  };
}

describe("Claude v2-first TUI E2E parity", () => {
  beforeEach(() => {
    _resetPartCounter();
  });

  test("renders tool, subagent, and permission flow in one Claude v2-first conversation", async () => {
    const client = new ClaudeAgentClient();
    const sessionId = "claude-v2-flow";
    const toolCallId = "tool-flow-1";

    const decision = (
      client as unknown as {
        resolveRuntimeDecision: (
          operation: "create" | "resume" | "send" | "stream" | "summarize",
          config: Record<string, unknown>,
        ) => { mode: "v2" | "v1_fallback"; fallbackReason: string | null };
      }
    ).resolveRuntimeDecision("stream", {});

    expect(decision.mode).toBe("v2");
    expect(decision.fallbackReason).toBeNull();

    let msg = createMockMessage();
    const seen: string[] = [];

    const offTool = client.on("tool.start", (event) => {
      if (event.sessionId !== sessionId) return;
      seen.push(event.type);

      const data = event.data as {
        toolUseID?: string;
        toolName?: string;
      };
      const part = createRunningToolPart(
        data.toolUseID ?? toolCallId,
        data.toolName ?? "Bash",
      );
      msg.parts = upsertPart(msg.parts ?? [], part);
    });

    const offPermission = client.on("permission.requested", (event) => {
      if (event.sessionId !== sessionId) return;
      seen.push(event.type);

      const data = event.data as {
        requestId?: string;
        toolName?: string;
        question?: string;
        options?: Array<{ label: string; value: string; description?: string }>;
        multiSelect?: boolean;
        respond?: (answer: string | string[]) => void;
      };

      const latestTool = [...(msg.parts ?? [])]
        .reverse()
        .find((part): part is ToolPart => part.type === "tool");
      if (!latestTool) return;

      const withQuestion: ToolPart = {
        ...latestTool,
        pendingQuestion: {
          requestId: data.requestId ?? "req-1",
          header: data.toolName ?? "AskUserQuestion",
          question: data.question ?? "Continue?",
          options: data.options ?? [{ label: "Yes", value: "yes" }],
          multiSelect: data.multiSelect ?? false,
          respond: data.respond ?? (() => {}),
        },
      };
      msg.parts = upsertPart(msg.parts ?? [], withQuestion);

      data.respond?.("yes");
      msg.parts = upsertPart(msg.parts ?? [], {
        ...withQuestion,
        pendingQuestion: undefined,
        hitlResponse: {
          cancelled: false,
          responseMode: "option",
          answerText: "yes",
          displayText: 'User answered: "yes"',
        },
      });
    });

    const offSubagent = client.on("subagent.start", (event) => {
      if (event.sessionId !== sessionId) return;
      seen.push(event.type);

      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
      };

      const latestTool = [...(msg.parts ?? [])]
        .reverse()
        .find((part): part is ToolPart => part.type === "tool");

      const agentPart: AgentPart = {
        id: createPartId(),
        type: "agent",
        agents: [
          {
            id: data.subagentId ?? "agent-1",
            taskToolCallId: latestTool?.toolCallId,
            name: data.subagentType ?? "codebase-analyzer",
            task: "Analyze repository",
            status: "running",
            startedAt: new Date().toISOString(),
            background: false,
          },
        ],
        parentToolPartId: latestTool?.id,
        createdAt: new Date().toISOString(),
      };

      msg.parts = upsertPart(msg.parts ?? [], agentPart);
    });

    try {
      (
        client as unknown as {
          emitEvent: (
            type: "tool.start" | "subagent.start",
            eventSessionId: string,
            data: Record<string, unknown>,
          ) => void;
        }
      ).emitEvent("tool.start", sessionId, {
        toolUseID: toolCallId,
        toolName: "Bash",
      });

      const permissionResult = await (
        client as unknown as {
          buildV2SessionOptions: (
            config: Record<string, unknown>,
            eventSessionId: string,
          ) => {
            canUseTool?: (
              toolName: string,
              toolInput: Record<string, unknown>,
            ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
          };
        }
      )
        .buildV2SessionOptions({}, sessionId)
        .canUseTool?.("AskUserQuestion", {
          questions: [{ question: "continue?" }],
        });

      (
        client as unknown as {
          emitEvent: (
            type: "tool.start" | "subagent.start",
            eventSessionId: string,
            data: Record<string, unknown>,
          ) => void;
        }
      ).emitEvent("subagent.start", sessionId, {
        subagentId: "agent-flow-1",
        subagentType: "codebase-analyzer",
      });

      expect(permissionResult?.behavior).toBe("allow");
      expect(
        (permissionResult?.updatedInput.answers as Record<string, string>)["continue?"],
      ).toBe("yes");

      expect(seen).toEqual([
        "tool.start",
        "permission.requested",
        "subagent.start",
      ]);

      const parts = msg.parts as Part[];
      expect(parts).toHaveLength(2);
      expect(parts[0]?.type).toBe("tool");
      expect(parts[1]?.type).toBe("agent");

      const tool = parts[0] as ToolPart;
      const agent = parts[1] as AgentPart;

      expect(tool.toolCallId).toBe(toolCallId);
      expect(tool.hitlResponse?.answerText).toBe("yes");
      expect(tool.pendingQuestion).toBeUndefined();

      expect(agent.parentToolPartId).toBe(tool.id);
      expect(agent.agents[0]?.taskToolCallId).toBe(toolCallId);
      expect(agent.agents[0]?.name).toBe("codebase-analyzer");
    } finally {
      offTool();
      offPermission();
      offSubagent();
    }
  });

  test("resumes Claude workflow state after restart-style rehydrate", async () => {
    const firstClient = new ClaudeAgentClient();
    const secondClient = new ClaudeAgentClient();
    const sessionId = "claude-restart-resume";

    (firstClient as unknown as { isRunning: boolean }).isRunning = true;
    (
      firstClient as unknown as {
        wrapQuery: (
          queryInstance: null,
          wrappedSessionId: string,
          config: Record<string, unknown>,
          runtime: {
            runtimeMode: "v2";
            fallbackReason: null;
            capabilities: {
              supportsV2SendStream: boolean;
              supportsV2Resume: boolean;
              supportsForkSession: boolean;
              supportsAdvancedInput: boolean;
            };
            sdkSessionId: string;
            inputTokens: number;
            outputTokens: number;
          },
        ) => { destroy: () => Promise<void> };
      }
    ).wrapQuery(null, sessionId, {}, {
      runtimeMode: "v2",
      fallbackReason: null,
      capabilities: {
        supportsV2SendStream: true,
        supportsV2Resume: true,
        supportsForkSession: false,
        supportsAdvancedInput: true,
      },
      sdkSessionId: "sdk-claude-restart-resume",
      inputTokens: 11,
      outputTokens: 29,
    });

    const persisted = (
      firstClient as unknown as {
        sessions: Map<string, Record<string, unknown>>;
      }
    ).sessions.get(sessionId);
    expect(persisted).toBeDefined();

    (secondClient as unknown as { isRunning: boolean }).isRunning = true;
    (
      secondClient as unknown as {
        sessions: Map<string, Record<string, unknown>>;
      }
    ).sessions.set(sessionId, {
      ...(persisted ?? {}),
      isClosed: false,
    });

    const resumed = await secondClient.resumeSession(sessionId);
    expect(resumed).not.toBeNull();

    const resumedState = (
      secondClient as unknown as {
        sessions: Map<
          string,
          {
            runtimeMode: "v2" | "v1_fallback";
            fallbackReason: string | null;
            sdkSessionId: string | null;
            inputTokens: number;
            outputTokens: number;
          }
        >;
      }
    ).sessions.get(sessionId);

    expect(resumedState).toMatchObject({
      runtimeMode: "v2",
      fallbackReason: null,
      sdkSessionId: "sdk-claude-restart-resume",
      inputTokens: 11,
      outputTokens: 29,
    });

    const resumeDecision = (
      secondClient as unknown as {
        resolveRuntimeDecision: (
          operation: "create" | "resume" | "send" | "stream" | "summarize",
          config: Record<string, unknown>,
        ) => { mode: "v2" | "v1_fallback"; fallbackReason: string | null };
      }
    ).resolveRuntimeDecision("resume", { sessionId });
    expect(resumeDecision.mode).toBe("v2");
    expect(resumeDecision.fallbackReason).toBeNull();

    await resumed?.destroy();
  });
});
