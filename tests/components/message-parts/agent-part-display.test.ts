import { describe, expect, test } from "bun:test";
import { AgentPartDisplay } from "@/components/message-parts/agent-part-display.tsx";
import type { AgentPart } from "@/state/parts/types.ts";

function createAgentPart(agents: AgentPart["agents"]): AgentPart {
  return {
    id: "agent-part-1",
    type: "agent",
    createdAt: "2026-01-01T00:00:00.000Z",
    agents,
  };
}

describe("AgentPartDisplay", () => {
  test("returns a renderable node when no agents are present", () => {
    const node = AgentPartDisplay({
      part: createAgentPart([]),
      isLast: true,
    });
    expect(node).toBeTruthy();
  });

  test("returns a renderable node when agents are present", () => {
    const node = AgentPartDisplay({
      part: createAgentPart([
        {
          id: "agent-1",
          name: "codebase-analyzer",
          task: "Inspect auth flow",
          status: "running",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
      isLast: true,
    });
    expect(node).toBeTruthy();
  });
});
