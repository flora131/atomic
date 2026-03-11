import { describe, expect, test } from "bun:test";

import { ClaudeAgentClient } from "@/services/agents/clients/index.ts";

describe("ClaudeAgentClient permissions and options", () => {
  test("normalizes AskUserQuestion permission events via v1 canUseTool", async () => {
    const client = new ClaudeAgentClient();
    const seenEvents: Array<{
      sessionId: string;
      options: string[];
    }> = [];

    const unsubscribe = client.on("human_input_required", (event) => {
      const data = event.data as {
        options?: Array<{ label: string }>;
        respond?: (answer: string | string[]) => void;
      };

      seenEvents.push({
        sessionId: event.sessionId,
        options: (data.options ?? []).map((option) => option.label),
      });
      data.respond?.("yes");
    });

    try {
      const privateClient = client as unknown as {
        buildSdkOptions: (
          config: Record<string, unknown>,
          sessionId?: string,
        ) => {
          canUseTool?: (
            toolName: string,
            toolInput: Record<string, unknown>,
            options: { signal: AbortSignal },
          ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
        };
      };

      const result = await privateClient
        .buildSdkOptions({}, "session-v1")
        .canUseTool?.(
          "AskUserQuestion",
          {
            questions: [{ question: "v1 question" }],
          },
          { signal: new AbortController().signal },
        );

      expect(result?.behavior).toBe("allow");
      expect((result?.updatedInput.answers as Record<string, string>)["v1 question"]).toBe("yes");
      expect(seenEvents).toEqual([
        {
          sessionId: "session-v1",
          options: ["Yes", "No"],
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("normalizes AskUserQuestion custom options and multiselect answers", async () => {
    const client = new ClaudeAgentClient();
    const seenEvents: Array<{ sessionId: string }> = [];

    const unsubscribe = client.on("human_input_required", (event) => {
      const data = event.data as {
        respond?: (answer: string | string[]) => void;
      };

      seenEvents.push({
        sessionId: event.sessionId,
      });
      data.respond?.(["alpha", "beta"]);
    });

    try {
      const privateClient = client as unknown as {
        buildSdkOptions: (
          config: Record<string, unknown>,
          sessionId?: string,
        ) => {
          canUseTool?: (
            toolName: string,
            toolInput: Record<string, unknown>,
            options: { signal: AbortSignal },
          ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
        };
      };

      const toolInput = {
        questions: [
          {
            question: "pick values",
            multiSelect: true,
            options: [{ label: "alpha" }, { label: "beta" }],
          },
        ],
      };

      const result = await privateClient
        .buildSdkOptions({}, "session-v1")
        .canUseTool?.("AskUserQuestion", toolInput, {
          signal: new AbortController().signal,
        });

      expect((result?.updatedInput.answers as Record<string, string>)["pick values"]).toBe(
        "alpha, beta",
      );
      expect(seenEvents).toEqual([{ sessionId: "session-v1" }]);
    } finally {
      unsubscribe();
    }
  });

  test("handles AskUserQuestion with empty question lists", async () => {
    const client = new ClaudeAgentClient();

    const privateClient = client as unknown as {
      buildSdkOptions: (
        config: Record<string, unknown>,
        sessionId?: string,
      ) => {
        canUseTool?: (
          toolName: string,
          toolInput: Record<string, unknown>,
          options: { signal: AbortSignal },
        ) => Promise<{ behavior: string; updatedInput: Record<string, unknown> }>;
      };
    };

    const input = { questions: [] as Array<{ question: string }> };

    const result = await privateClient
      .buildSdkOptions({}, "session-v1")
      .canUseTool?.("AskUserQuestion", input, {
        signal: new AbortController().signal,
      });

    expect(result).toEqual({
      behavior: "allow",
      updatedInput: input,
    });
  });

  test("builds v1 SDK options with allowed tools and claude_code system prompt", () => {
    const client = new ClaudeAgentClient();

    const privateClient = client as unknown as {
      buildSdkOptions: (
        config: Record<string, unknown>,
        sessionId?: string,
      ) => {
        allowedTools?: string[];
        systemPrompt?: unknown;
      };
    };

    const options = privateClient.buildSdkOptions({}, "session-v1");
    expect(options.allowedTools?.length).toBeGreaterThan(0);
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });

    const withPrompt = privateClient.buildSdkOptions(
      { additionalInstructions: "Extra system guidance" },
      "session-v1",
    );
    expect(withPrompt.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Extra system guidance",
    });
  });
});
