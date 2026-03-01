import { describe, expect, test } from "bun:test";
import { OpenCodeClient } from "./opencode.ts";

describe("OpenCodeClient event mapping", () => {
  test("defaults directory to process.cwd() for project-scoped agent resolution", () => {
    const client = new OpenCodeClient();
    const options = client as unknown as { clientOptions?: { directory?: string } };
    expect(options.clientOptions?.directory).toBe(process.cwd());
  });

  test("maps session.created info.id to session.start sessionId", () => {
    const client = new OpenCodeClient();
    const sessionStarts: string[] = [];

    const unsubscribe = client.on("session.start", (event) => {
      sessionStarts.push(event.sessionId);
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.created",
      properties: {
        info: { id: "ses_test_created" },
      },
    });

    unsubscribe();

    expect(sessionStarts).toEqual(["ses_test_created"]);
  });

  test("maps session.status idle payloads to session.idle", () => {
    const client = new OpenCodeClient();
    const idles: string[] = [];

    const unsubscribe = client.on("session.idle", (event) => {
      idles.push(event.sessionId);
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.status",
      properties: {
        sessionID: "ses_status_string",
        status: "idle",
      },
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.status",
      properties: {
        info: { id: "ses_status_structured" },
        status: { type: "idle" },
      },
    });

    unsubscribe();

    expect(idles).toEqual(["ses_status_string", "ses_status_structured"]);
  });

  test("maps session.idle info.id payloads to session.idle", () => {
    const client = new OpenCodeClient();
    const idles: string[] = [];

    const unsubscribe = client.on("session.idle", (event) => {
      idles.push(event.sessionId);
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.idle",
      properties: {
        info: { id: "ses_idle_info" },
      },
    });

    unsubscribe();

    expect(idles).toEqual(["ses_idle_info"]);
  });

  test("stream resolves even when no terminal idle event arrives", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_no_idle";

    // Avoid provider metadata lookups in wrapSession().
    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          prompt: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
      };
    }).sdkClient = {
      session: {
        prompt: async () => ({
          data: {
            parts: [
              {
                id: "task_tool_1",
                type: "tool",
                tool: "task",
                state: {
                  status: "running",
                  input: { description: "Investigate hang" },
                },
              },
            ],
            info: {
              tokens: { input: 5, output: 0 },
            },
          },
        }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession(sessionId, {});

    const chunks: Array<{ type: string; content: unknown }> = [];
    const consumePromise = (async () => {
      for await (const chunk of session.stream("run worker", { agent: "worker" })) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream timed out")), 2500);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    expect(chunks.some((chunk) => chunk.type === "tool_use")).toBe(true);
  });

  test("stream drains late tool events when idle arrives before prompt settles", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_idle_before_prompt_settle";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    let resolvePrompt!: (value: {
      data: { parts: unknown[]; info: { tokens: { input: number; output: number } } };
    }) => void;
    const pendingPrompt = new Promise<{
      data: { parts: unknown[]; info: { tokens: { input: number; output: number } } };
    }>((resolve) => {
      resolvePrompt = resolve;
    });

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as {
      sdkClient: {
        session: {
          prompt: (params: Record<string, unknown>) => Promise<{
            data: { parts: unknown[]; info: { tokens: { input: number; output: number } } };
          }>;
        };
      };
    }).sdkClient = {
      session: {
        prompt: async () => pendingPrompt,
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession(sessionId, {});

    const chunks: Array<{ type: string; content: unknown }> = [];
    const consumePromise = (async () => {
      for await (const chunk of session.stream("run task", { agent: "worker" })) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    const idleTimer = setTimeout(() => {
      handle({
        type: "session.status",
        properties: {
          sessionID: sessionId,
          status: "idle",
        },
      });
    }, 20);

    const toolTimer = setTimeout(() => {
      handle({
        type: "message.part.updated",
        properties: {
          sessionID: sessionId,
          part: {
            id: "tool_late_1",
            callID: "call_late_1",
            sessionID: sessionId,
            messageID: "msg_late_1",
            type: "tool",
            tool: "Read",
            state: {
              status: "pending",
              input: { filePath: "src/index.ts" },
            },
          },
        },
      });
    }, 120);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream did not complete")), 2000);
        }),
      ]);
    } finally {
      clearTimeout(idleTimer);
      clearTimeout(toolTimer);
      if (timeoutId) clearTimeout(timeoutId);
      resolvePrompt({
        data: {
          parts: [],
          info: { tokens: { input: 0, output: 0 } },
        },
      });
    }

    expect(chunks.some((chunk) => {
      if (chunk.type !== "tool_use") return false;
      const content = chunk.content as { name?: string };
      return content.name === "Read";
    })).toBe(true);
  });

  test("stream keeps child-session progress isolated when currentSessionId points to another session", async () => {
    const client = new OpenCodeClient();

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as {
      sdkClient: {
        session: {
          prompt: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
      };
    }).sdkClient = {
      session: {
        prompt: async (params) => {
          const sid = params.sessionID as string;
          const childSid = `${sid}_child`;

          handle({
            type: "message.part.updated",
            properties: {
              sessionID: sid,
              part: {
                id: `agent_${sid}`,
                sessionID: sid,
                messageID: `msg_${sid}_1`,
                type: "agent",
                name: "worker",
              },
            },
          });

          handle({
            type: "message.part.updated",
            properties: {
              sessionID: sid,
              part: {
                id: `tool_${sid}`,
                sessionID: childSid,
                messageID: `msg_${sid}_2`,
                type: "tool",
                tool: "Read",
                callID: `call_${sid}`,
                state: {
                  status: "pending",
                  input: { filePath: "src/index.ts" },
                },
              },
            },
          });

          // Fire the idle event AFTER prompt resolution so it arrives during
          // the post-prompt drain window (the drain resets stale terminal
          // state from before prompt resolution).
          setTimeout(() => {
            handle({
              type: "session.status",
              properties: {
                sessionID: sid,
                status: "idle",
              },
            });
          }, 50);

          return {
            data: {
              parts: [],
              info: {
                tokens: { input: 1, output: 0 },
              },
            },
          };
        },
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession("ses_A", {});

    // Simulate another parallel session being marked current.
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_B";

    const chunks: Array<{ type: string; content: unknown }> = [];
    for await (const chunk of session.stream("run task", { agent: "worker" })) {
      chunks.push({ type: chunk.type, content: chunk.content });
    }

    expect(chunks.some((chunk) => {
      if (chunk.type !== "tool_use") return false;
      const content = chunk.content as { name?: string };
      return content.name === "Read";
    })).toBe(true);
  });

  test("stream completes when terminal session event arrives before prompt resolves", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_terminal_before_prompt";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    let resolvePrompt!: (value: {
      data: { parts: unknown[]; info: { tokens: { input: number; output: number } } };
    }) => void;
    const pendingPrompt = new Promise<{
      data: { parts: unknown[]; info: { tokens: { input: number; output: number } } };
    }>((resolve) => {
      resolvePrompt = resolve;
    });

    (client as unknown as {
      sdkClient: {
        session: {
          prompt: (params: Record<string, unknown>) => Promise<{
            data: { parts: unknown[]; info: { tokens: { input: number; output: number } } };
          }>;
        };
      };
    }).sdkClient = {
      session: {
        prompt: async () => pendingPrompt,
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession(sessionId, {});

    const consumePromise = (async () => {
      for await (const _chunk of session.stream("run task", { agent: "worker" })) {
        // No-op: this regression only verifies completion.
      }
    })();

    setTimeout(() => {
      (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
        type: "session.status",
        properties: {
          sessionID: sessionId,
          status: "idle",
        },
      });
    }, 20);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream did not complete")), 1000);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      resolvePrompt({
        data: {
          parts: [],
          info: { tokens: { input: 0, output: 0 } },
        },
      });
    }
  });

  test("non-subagent stream ignores early idle and waits for prompt result", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_non_subagent_early_idle";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    let resolvePrompt!: (value: {
      data: {
        parts: Array<{ type: string; text?: string }>;
        info: { tokens: { input: number; output: number } };
      };
    }) => void;
    const pendingPrompt = new Promise<{
      data: {
        parts: Array<{ type: string; text?: string }>;
        info: { tokens: { input: number; output: number } };
      };
    }>((resolve) => {
      resolvePrompt = resolve;
    });

    (client as unknown as {
      sdkClient: {
        session: {
          prompt: (params: Record<string, unknown>) => Promise<{
            data: {
              parts: Array<{ type: string; text?: string }>;
              info: { tokens: { input: number; output: number } };
            };
          }>;
        };
      };
    }).sdkClient = {
      session: {
        prompt: async () => pendingPrompt,
      },
    };

    const session = await (client as unknown as {
      wrapSession: (sid: string, config: Record<string, unknown>) => Promise<{
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      }>;
    }).wrapSession(sessionId, {});

    const chunks: Array<{ type: string; content: unknown }> = [];
    const consumePromise = (async () => {
      for await (const chunk of session.stream("plain prompt")) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }
    })();

    setTimeout(() => {
      (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
        type: "session.status",
        properties: {
          sessionID: sessionId,
          status: "idle",
        },
      });
    }, 20);

    setTimeout(() => {
      resolvePrompt({
        data: {
          parts: [{ type: "text", text: "final response" }],
          info: { tokens: { input: 3, output: 5 } },
        },
      });
    }, 80);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        consumePromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream did not finish")), 1000);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    expect(
      chunks.some((chunk) => chunk.type === "text" && chunk.content === "final response")
    ).toBe(true);
  });

  test("maps tool part updates using part.sessionID when properties.sessionID is absent", () => {
    const client = new OpenCodeClient();
    const starts: Array<{ sessionId: string; toolName?: string; toolCallId?: string }> = [];
    const completes: Array<{ sessionId: string; toolName?: string; toolCallId?: string }> = [];

    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      starts.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        toolCallId: data.toolCallId,
      });
    });
    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      completes.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        toolCallId: data.toolCallId,
      });
    });

    const basePart = {
      id: "prt_tool_1",
      callID: "call_tool_1",
      sessionID: "ses_part_session",
      messageID: "msg_1",
      type: "tool",
      tool: "bash",
    };

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          ...basePart,
          state: {
            status: "running",
            input: { command: "pwd" },
          },
        },
      },
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          ...basePart,
          state: {
            status: "completed",
            input: { command: "pwd" },
            output: "/tmp",
          },
        },
      },
    });

    unsubStart();
    unsubComplete();

    expect(starts).toEqual([
      {
        sessionId: "ses_part_session",
        toolName: "bash",
        toolCallId: "call_tool_1",
      },
    ]);
    expect(completes).toEqual([
      {
        sessionId: "ses_part_session",
        toolName: "bash",
        toolCallId: "call_tool_1",
      },
    ]);
  });

  test("emits task tool lifecycle for parent-session task parts", () => {
    const client = new OpenCodeClient();
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ toolName?: string; toolCallId?: string }> = [];
    const completes: Array<{ toolName?: string; toolCallId?: string }> = [];

    const unsubStart = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      starts.push({ toolName: data.toolName, toolCallId: data.toolCallId });
    });

    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as { toolName?: string; toolCallId?: string };
      completes.push({ toolName: data.toolName, toolCallId: data.toolCallId });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_parent",
          callID: "call_task_parent",
          sessionID: "ses_parent",
          messageID: "msg_task_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
              description: "debug stream ordering",
            },
          },
        },
      },
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_parent",
          callID: "call_task_parent",
          sessionID: "ses_parent",
          messageID: "msg_task_1",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              subagent_type: "debugger",
              description: "debug stream ordering",
            },
            output: "done",
          },
        },
      },
    });

    unsubStart();
    unsubComplete();

    expect(starts).toEqual([{ toolName: "task", toolCallId: "call_task_parent" }]);
    expect(completes).toEqual([{ toolName: "task", toolCallId: "call_task_parent" }]);
  });

  test("maps subtask parts to subagent.start with agent name and task", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentType?: string;
      task?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        task?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        task: data.task,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "subtask",
          prompt: "Research Rust TUI stacks",
          description: "Research the best technology stacks in Rust for terminal games",
          agent: "codebase-online-researcher",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_parent",
        subagentId: "subtask_1",
        subagentType: "codebase-online-researcher",
        task: "Research the best technology stacks in Rust for terminal games",
      },
    ]);
  });

  test("emits thinking source identity for reasoning deltas", () => {
    const client = new OpenCodeClient();
    const deltas: Array<{
      sessionId: string;
      delta?: string;
      contentType?: string;
      thinkingSourceKey?: string;
    }> = [];

    const unsubscribe = client.on("message.delta", (event) => {
      const data = event.data as {
        delta?: string;
        contentType?: string;
        thinkingSourceKey?: string;
      };
      deltas.push({
        sessionId: event.sessionId,
        delta: data.delta,
        contentType: data.contentType,
        thinkingSourceKey: data.thinkingSourceKey,
      });
    });

    // First, register the reasoning part via message.part.updated
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning_part_1",
          sessionID: "ses_reasoning",
          messageID: "msg_reasoning",
          type: "reasoning",
        },
      },
    });

    // Then, send the delta via message.part.delta (v2)
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.delta",
      properties: {
        partID: "reasoning_part_1",
        sessionID: "ses_reasoning",
        delta: "inspect constraints",
      },
    });

    unsubscribe();

    expect(deltas).toEqual([
      {
        sessionId: "ses_reasoning",
        delta: "inspect constraints",
        contentType: "thinking",
        thinkingSourceKey: "reasoning_part_1",
      },
    ]);
  });

  test("maps agent part to subagent.start with toolCallId from callID", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent-1",
          sessionID: "ses_agent",
          messageID: "msg_1",
          type: "agent",
          name: "explorer",
          callID: "call-123",
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_agent",
        subagentId: "agent-1",
        subagentType: "explorer",
        toolCallId: "call-123",
      },
    ]);
  });

  test("maps agent part to subagent.start with toolCallId fallback to id when callID is missing", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentType?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        toolCallId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        toolCallId: data.toolCallId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent-2",
          sessionID: "ses_agent_no_callid",
          messageID: "msg_2",
          type: "agent",
          name: "worker",
          // callID is missing/undefined
        },
      },
    });

    unsubStart();

    expect(starts).toEqual([
      {
        sessionId: "ses_agent_no_callid",
        subagentId: "agent-2",
        subagentType: "worker",
        toolCallId: "agent-2", // Falls back to id
      },
    ]);
  });

  test("uses preceding task tool part id as correlation for subsequent agent part", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      subagentId?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        toolCallId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        toolCallId: data.toolCallId,
      });
    });

    // Task tool part arrives first.
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_1",
          callID: "task_call_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "pending",
            input: {
              subagent_type: "debugger",
              description: "Inspect workflow stream issues",
            },
          },
        },
      },
    });

    // Agent part should correlate to task_tool_1 (not callID fallback).
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_from_task",
          callID: "call_agent_1",
          sessionID: "ses_parent",
          messageID: "msg_2",
          type: "agent",
          name: "debugger",
        },
      },
    });

    unsubStart();

    const mappedAgentStart = starts.find((entry) => entry.subagentId === "agent_from_task");
    expect(mappedAgentStart?.toolCallId).toBe("task_tool_1");
  });

  test("does not leak completed synthesized task correlation into later agent parts", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      subagentId?: string;
      toolCallId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; toolCallId?: string };
      starts.push({
        subagentId: data.subagentId,
        toolCallId: data.toolCallId,
      });
    });

    // Task tool starts + completes without any agent/subtask part.
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_stale",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
              description: "initial task",
            },
          },
        },
      },
    });
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_tool_stale",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              subagent_type: "debugger",
              description: "initial task",
            },
          },
        },
      },
    });

    // Later unrelated agent part should not consume stale task_tool_stale.
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_after_task",
          callID: "call_after_task",
          sessionID: "ses_parent",
          messageID: "msg_2",
          type: "agent",
          name: "worker",
        },
      },
    });

    unsubStart();

    const start = starts.find((entry) => entry.subagentId === "agent_after_task");
    expect(start?.toolCallId).toBe("call_after_task");
  });

  test("emits tool.complete when tool status is completed but output is undefined", () => {
    // Uses a non-Task tool to validate the generic tool.complete path.
    const client = new OpenCodeClient();
    const completes: Array<{
      sessionId: string;
      toolName?: string;
      toolResult?: unknown;
      success?: boolean;
    }> = [];

    const unsubComplete = client.on("tool.complete", (event) => {
      const data = event.data as {
        toolName?: string;
        toolResult?: unknown;
        success?: boolean;
      };
      completes.push({
        sessionId: event.sessionId,
        toolName: data.toolName,
        toolResult: data.toolResult,
        success: data.success,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_bash_1",
          callID: "call_bash_1",
          sessionID: "ses_task",
          messageID: "msg_1",
          type: "tool",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "echo hello" },
            // output is intentionally omitted (undefined)
          },
        },
      },
    });

    unsubComplete();

    expect(completes).toHaveLength(1);
    expect(completes[0]!.sessionId).toBe("ses_task");
    expect(completes[0]!.toolName).toBe("bash");
    expect(completes[0]!.toolResult).toBeUndefined();
    expect(completes[0]!.success).toBe(true);
  });

  test("maps step-finish part to subagent.complete", () => {
    const client = new OpenCodeClient();
    const completes: Array<{
      sessionId: string;
      subagentId?: string;
      success?: boolean;
      result?: string;
    }> = [];

    const unsubComplete = client.on("subagent.complete", (event) => {
      const data = event.data as {
        subagentId?: string;
        success?: boolean;
        result?: string;
      };
      completes.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        success: data.success,
        result: data.result,
      });
    });

    // Test successful completion
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-1",
          sessionID: "ses_step",
          messageID: "msg_step",
          type: "step-finish",
          reason: "success",
        },
      },
    });

    // Test error completion
    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-2",
          sessionID: "ses_step",
          messageID: "msg_step_2",
          type: "step-finish",
          reason: "error",
        },
      },
    });

    unsubComplete();

    expect(completes).toEqual([
      {
        sessionId: "ses_step",
        subagentId: "step-1",
        success: true,
        result: "success",
      },
      {
        sessionId: "ses_step",
        subagentId: "step-2",
        success: false,
        result: "error",
      },
    ]);
  });

  test("omits subagentSessionId from initial agent part subagent.start (parent session != child)", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentSessionId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "agent_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "agent",
          name: "explore",
          callID: "call_1",
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(1);
    expect(starts[0]!.sessionId).toBe("ses_parent");
    expect(starts[0]!.subagentId).toBe("agent_1");
    // subagentSessionId is intentionally omitted from the initial emission
    // because AgentPart.sessionID is the parent session, not the child.
    expect(starts[0]!.subagentSessionId).toBeUndefined();
  });

  test("omits subagentSessionId from initial subtask part subagent.start", () => {
    const client = new OpenCodeClient();
    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentSessionId?: string;
      };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask_2",
          sessionID: "ses_subtask_session",
          messageID: "msg_1",
          type: "subtask",
          prompt: "Find files",
          description: "Locate relevant source files",
          agent: "codebase-locator",
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(1);
    expect(starts[0]!.subagentId).toBe("subtask_2");
    // subagentSessionId intentionally omitted — see AgentPart comment.
    expect(starts[0]!.subagentSessionId).toBeUndefined();
  });

  test("discovers child session from tool part and re-emits subagent.start with correct subagentSessionId", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    // Set currentSessionId so the client knows the parent session.
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];
    const toolStarts: Array<{
      sessionId: string;
      toolName?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });
    const unsubTool = client.on("tool.start", (event) => {
      const data = event.data as { toolName?: string };
      toolStarts.push({ sessionId: event.sessionId, toolName: data.toolName });
    });

    // 1. Agent part arrives (parent session)
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: {
          id: "agent_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "agent",
          name: "explore",
        },
      },
    });

    // Initial subagent.start without subagentSessionId
    expect(starts).toHaveLength(1);
    expect(starts[0]!.subagentId).toBe("agent_1");
    expect(starts[0]!.subagentSessionId).toBeUndefined();

    // 2. First tool from child session arrives
    handle({
      type: "message.part.updated",
      properties: {
        // OpenCode can keep the parent session ID at the envelope level
        // while the part itself belongs to the child session.
        sessionID: "ses_parent",
        part: {
          id: "tool_child_1",
          sessionID: "ses_child",
          messageID: "msg_child_1",
          type: "tool",
          tool: "Read",
          callID: "call_child_1",
          state: { status: "pending", input: { file: "foo.ts" } },
        },
      },
    });

    unsubStart();
    unsubTool();

    // Re-emitted subagent.start with correct child session ID
    expect(starts).toHaveLength(2);
    expect(starts[1]!.subagentId).toBe("agent_1");
    expect(starts[1]!.subagentSessionId).toBe("ses_child");

    // Tool event emitted on the child session
    expect(toolStarts).toHaveLength(1);
    expect(toolStarts[0]!.sessionId).toBe("ses_child");
    expect(toolStarts[0]!.toolName).toBe("Read");
  });

  test("routes child-session discovery to envelope parent session during parallel runs", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    // Simulate another session becoming "current" while session A events arrive.
    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parallel_other";

    const starts: Array<{
      sessionId: string;
      subagentId?: string;
      subagentSessionId?: string;
    }> = [];

    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({
        sessionId: event.sessionId,
        subagentId: data.subagentId,
        subagentSessionId: data.subagentSessionId,
      });
    });

    // Parent session A agent start
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_A",
        part: {
          id: "agent_A",
          sessionID: "ses_A",
          messageID: "msg_A_1",
          type: "agent",
          name: "worker",
        },
      },
    });

    // Child tool event for session A
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_A",
        part: {
          id: "tool_child_A",
          sessionID: "ses_child_A",
          messageID: "msg_A_2",
          type: "tool",
          tool: "Read",
          state: {
            status: "pending",
            input: { filePath: "src/a.ts" },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(2);
    expect(starts[0]!.sessionId).toBe("ses_A");
    expect(starts[0]!.subagentId).toBe("agent_A");
    expect(starts[1]!.sessionId).toBe("ses_A");
    expect(starts[1]!.subagentId).toBe("agent_A");
    expect(starts[1]!.subagentSessionId).toBe("ses_child_A");
  });

  test("does not re-emit subagent.start for subsequent tool events on same child session", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ subagentId?: string; subagentSessionId?: string }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as { subagentId?: string; subagentSessionId?: string };
      starts.push({ subagentId: data.subagentId, subagentSessionId: data.subagentSessionId });
    });

    // Agent part
    handle({
      type: "message.part.updated",
      properties: {
        sessionID: "ses_parent",
        part: { id: "agent_1", sessionID: "ses_parent", messageID: "msg_1", type: "agent", name: "explore" },
      },
    });

    // First child tool → triggers re-emit
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_1", sessionID: "ses_child", messageID: "msg_c1", type: "tool",
          tool: "Read", state: { status: "pending", input: {} },
        },
      },
    });

    // Second child tool → should NOT re-emit
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_2", sessionID: "ses_child", messageID: "msg_c2", type: "tool",
          tool: "Write", state: { status: "pending", input: {} },
        },
      },
    });

    unsubStart();

    // Only 2 subagent.start events: initial + one re-emit
    expect(starts).toHaveLength(2);
  });

  test("does not synthesize nested task tool events from child sessions", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{ subagentId?: string; subagentType?: string; subagentSessionId?: string }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        subagentSessionId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        subagentSessionId: data.subagentSessionId,
      });
    });

    // Seed a pending agent and discover its child session.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "agent_debugger",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "agent",
          name: "debugger",
        },
      },
    });
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool_read_1",
          sessionID: "ses_child_debugger",
          messageID: "msg_child_1",
          type: "tool",
          tool: "Read",
          callID: "call_read_1",
          state: { status: "pending", input: { file: "src/index.ts" } },
        },
      },
    });

    const beforeNestedTask = starts.length;
    // Nested task tool under child session should NOT synthesize a new top-level task-agent row.
    handle({
      type: "message.part.updated",
      properties: {
        // Regression guard: envelope may still report the parent session.
        sessionID: "ses_parent",
        part: {
          id: "nested_task_1",
          sessionID: "ses_child_debugger",
          messageID: "msg_child_2",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "worker",
              description: "Debug message routing",
            },
          },
        },
      },
    });

    unsubStart();

    expect(starts).toHaveLength(beforeNestedTask);
    expect(starts.find((entry) => entry.subagentId === "task-agent-nested_task_1")).toBeUndefined();
  });

  test("keeps synthesized task subagent type stable across running and completion updates", () => {
    const client = new OpenCodeClient();
    const handle = (event: Record<string, unknown>) =>
      (client as unknown as { handleSdkEvent: (e: Record<string, unknown>) => void }).handleSdkEvent(event);

    (client as unknown as { currentSessionId: string | null }).currentSessionId = "ses_parent";

    const starts: Array<{
      subagentId?: string;
      subagentType?: string;
      task?: string;
      subagentSessionId?: string;
    }> = [];
    const unsubStart = client.on("subagent.start", (event) => {
      const data = event.data as {
        subagentId?: string;
        subagentType?: string;
        task?: string;
        subagentSessionId?: string;
      };
      starts.push({
        subagentId: data.subagentId,
        subagentType: data.subagentType,
        task: data.task,
        subagentSessionId: data.subagentSessionId,
      });
    });

    // First running event has type but no task text yet.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_debugger_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              subagent_type: "debugger",
            },
          },
        },
      },
    });

    // Second running event provides task text but omits subagent_type.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_debugger_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "running",
            input: {
              description: "Inspect workflow stream issues",
            },
          },
        },
      },
    });

    // Completion re-emits subagent.start with child session registration.
    handle({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task_debugger_1",
          sessionID: "ses_parent",
          messageID: "msg_1",
          type: "tool",
          tool: "task",
          state: {
            status: "completed",
            input: {
              description: "Inspect workflow stream issues",
            },
            metadata: {
              sessionId: "ses_child_debugger",
            },
          },
        },
      },
    });

    unsubStart();

    const debuggerStarts = starts.filter((entry) => entry.subagentId === "task-agent-task_debugger_1");
    expect(debuggerStarts).toHaveLength(3);
    expect(debuggerStarts[0]?.subagentType).toBe("debugger");
    expect(debuggerStarts[1]?.subagentType).toBe("debugger");
    expect(debuggerStarts[2]?.subagentType).toBe("debugger");
    expect(debuggerStarts[2]?.subagentSessionId).toBe("ses_child_debugger");
  });

  test("maps structured session.error payloads to readable error strings", () => {
    const client = new OpenCodeClient();
    const errors: Array<{ sessionId: string; error: unknown }> = [];

    const unsubscribe = client.on("session.error", (event) => {
      errors.push({
        sessionId: event.sessionId,
        error: (event.data as { error?: unknown }).error,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.error",
      properties: {
        sessionID: "ses_structured_error",
        error: {
          message: "Rate limit exceeded",
          code: "RATE_LIMIT",
        },
      },
    });

    unsubscribe();

    expect(errors).toEqual([
      {
        sessionId: "ses_structured_error",
        error: "Rate limit exceeded",
      },
    ]);
  });

  test("maps session.error info.id payloads and extracts top-level stderr text", () => {
    const client = new OpenCodeClient();
    const errors: Array<{ sessionId: string; error: unknown }> = [];

    const unsubscribe = client.on("session.error", (event) => {
      errors.push({
        sessionId: event.sessionId,
        error: (event.data as { error?: unknown }).error,
      });
    });

    (client as unknown as { handleSdkEvent: (event: Record<string, unknown>) => void }).handleSdkEvent({
      type: "session.error",
      error: {
        stderr: "OpenCode process exited with code 1",
      },
      properties: {
        info: { id: "ses_error_info_id" },
      },
    });

    unsubscribe();

    expect(errors).toEqual([
      {
        sessionId: "ses_error_info_id",
        error: "OpenCode process exited with code 1",
      },
    ]);
  });

  test("stream throws prompt errors instead of yielding assistant error text", async () => {
    const client = new OpenCodeClient();
    const sessionId = "ses_stream_error";

    (client as unknown as {
      resolveModelContextWindow: (modelHint?: string) => Promise<number>;
    }).resolveModelContextWindow = async () => 200_000;

    (client as unknown as {
      sdkClient: {
        session: {
          prompt: () => Promise<Record<string, unknown>>;
        };
      };
    }).sdkClient = {
      session: {
        prompt: async () => ({
          error: {
            message: "OpenCode quota exceeded",
          },
        }),
      },
    };

    const session = await (client as unknown as {
      wrapSession: (
        sid: string,
        config: Record<string, unknown>,
      ) => Promise<{
        stream: (message: string) => AsyncIterable<unknown>;
      }>;
    }).wrapSession(sessionId, {});

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("trigger")) {
        // stream should throw before yielding error text chunks
      }
    };

    await expect(consumeStream()).rejects.toThrow("OpenCode quota exceeded");
  });
});
