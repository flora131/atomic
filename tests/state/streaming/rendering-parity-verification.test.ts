/**
 * Rendering parity verification tests (§5.16).
 *
 * Verifies that all workflow stage content flows through the full event
 * pipeline (SDK → Adapter → BusEvent → Pipeline → Parts → React) using
 * PART_REGISTRY dispatch — with no bespoke rendering paths for stages.
 *
 * Key architecture assertions:
 * 1. Workflow stages render through the same `applyStreamPartEvent` reducer
 *    as the main chat (text, tools, thinking, workflow-step, task-list).
 * 2. Sub-agents within sessions use `routeToAgentInlineParts` → AgentPart →
 *    PART_REGISTRY["agent"] → ParallelAgentsTree → PART_REGISTRY[part.type].
 * 3. There are NO bespoke rendering paths (AgentInlineText, AgentInlineTool)
 *    that bypass PART_REGISTRY.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { applyStreamPartEvent } from "@/state/streaming/pipeline.ts";
import { PART_REGISTRY } from "@/components/message-parts/registry.tsx";
import { _resetPartCounter, createPartId } from "@/state/parts/id.ts";
import type { ChatMessage } from "@/types/chat.ts";
import type { Part, WorkflowStepPart, TaskListPart, TextPart, ToolPart, AgentPart } from "@/state/parts/types.ts";
import type { StreamPartEvent } from "@/state/streaming/pipeline-types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createAssistantMessage(parts: Part[] = []): ChatMessage {
  return {
    id: "msg-test",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    streaming: true,
    parts,
  };
}

// ---------------------------------------------------------------------------
// §5.16 Rendering Parity Tests
// ---------------------------------------------------------------------------

describe("§5.16 Rendering parity verification", () => {
  beforeEach(() => {
    _resetPartCounter();
  });

  // -----------------------------------------------------------------------
  // 1. PART_REGISTRY completeness
  // -----------------------------------------------------------------------

  describe("PART_REGISTRY covers all workflow part types", () => {
    test("workflow-step type has a registered renderer", () => {
      expect(PART_REGISTRY["workflow-step"]).toBeDefined();
      expect(typeof PART_REGISTRY["workflow-step"]).toBe("function");
    });

    test("task-list type has a registered renderer", () => {
      expect(PART_REGISTRY["task-list"]).toBeDefined();
      expect(typeof PART_REGISTRY["task-list"]).toBe("function");
    });

    test("task-result type has a registered renderer", () => {
      expect(PART_REGISTRY["task-result"]).toBeDefined();
      expect(typeof PART_REGISTRY["task-result"]).toBe("function");
    });

    test("agent type has a registered renderer (for sub-agent inline parts)", () => {
      expect(PART_REGISTRY["agent"]).toBeDefined();
      expect(typeof PART_REGISTRY["agent"]).toBe("function");
    });

    test("all standard part types have registered renderers", () => {
      const expectedTypes: Part["type"][] = [
        "text",
        "reasoning",
        "tool",
        "agent",
        "task-list",
        "skill-load",
        "mcp-snapshot",
        "agent-list",
        "compaction",
        "task-result",
        "workflow-step",
      ];

      for (const type of expectedTypes) {
        expect(PART_REGISTRY[type]).toBeDefined();
        expect(typeof PART_REGISTRY[type]).toBe("function");
      }
    });
  });

  // -----------------------------------------------------------------------
  // 2. Workflow events go through applyStreamPartEvent (unified pipeline)
  // -----------------------------------------------------------------------

  describe("workflow events flow through unified applyStreamPartEvent", () => {
    test("workflow-step-start creates a WorkflowStepPart via the pipeline", () => {
      const msg = createAssistantMessage();
      const event: StreamPartEvent = {
        type: "workflow-step-start",
        workflowId: "ralph",
        nodeId: "planner",
        nodeName: "Planner",
        indicator: "[PLANNER]",
      };

      const result = applyStreamPartEvent(msg, event);
      const stepPart = result.parts?.find(
        (p): p is WorkflowStepPart => p.type === "workflow-step",
      );

      expect(stepPart).toBeDefined();
      expect(stepPart!.nodeId).toBe("planner");
      expect(stepPart!.status).toBe("running");
    });

    test("workflow-step-complete updates WorkflowStepPart via the pipeline", () => {
      const msg = createAssistantMessage();
      const started = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        workflowId: "ralph",
        nodeId: "orchestrator",
        nodeName: "Orchestrator",
        indicator: "[ORCHESTRATOR]",
      });

      const result = applyStreamPartEvent(started, {
        type: "workflow-step-complete",
        workflowId: "ralph",
        nodeId: "orchestrator",
        nodeName: "Orchestrator",
        status: "completed",
        durationMs: 5000,
      });

      const stepPart = result.parts?.find(
        (p): p is WorkflowStepPart => p.type === "workflow-step",
      );

      expect(stepPart).toBeDefined();
      expect(stepPart!.status).toBe("completed");
      expect(stepPart!.durationMs).toBe(5000);
    });

    test("task-list-update creates a TaskListPart via the pipeline", () => {
      const msg = createAssistantMessage();
      const event: StreamPartEvent = {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "Implement feature", status: "in_progress" },
          { id: "t2", title: "Write tests", status: "pending" },
        ],
      };

      const result = applyStreamPartEvent(msg, event);
      const taskPart = result.parts?.find(
        (p): p is TaskListPart => p.type === "task-list",
      );

      expect(taskPart).toBeDefined();
      expect(taskPart!.items).toHaveLength(2);
      expect(taskPart!.items[0]!.status).toBe("in_progress");
    });

    test("text-delta without agentId creates standard TextPart (stage content)", () => {
      const msg = createAssistantMessage();
      const event: StreamPartEvent = {
        type: "text-delta",
        delta: "Hello from stage",
      };

      const result = applyStreamPartEvent(msg, event);
      expect(result.content).toBe("Hello from stage");

      const textPart = result.parts?.find(
        (p): p is TextPart => p.type === "text",
      );
      expect(textPart).toBeDefined();
      expect(textPart!.content).toBe("Hello from stage");
    });

    test("tool-start without agentId creates standard ToolPart (stage tool calls)", () => {
      const msg = createAssistantMessage();
      const event: StreamPartEvent = {
        type: "tool-start",
        toolId: "tc-1",
        toolName: "bash",
        input: { command: "ls" },
      };

      const result = applyStreamPartEvent(msg, event);
      const toolPart = result.parts?.find(
        (p): p is ToolPart => p.type === "tool",
      );

      expect(toolPart).toBeDefined();
      expect(toolPart!.toolName).toBe("bash");
    });
  });

  // -----------------------------------------------------------------------
  // 3. Sub-agent events route through inline parts (correct behavior)
  // -----------------------------------------------------------------------

  describe("sub-agent events use routeToAgentInlineParts (not bespoke)", () => {
    test("text-delta with agentId routes to agent inline parts", () => {
      // First, create a message with an agent part
      const agentPart: AgentPart = {
        id: createPartId(),
        type: "agent",
        agents: [{
          id: "agent-1",
          name: "Worker",
          task: "Implement feature",
          status: "running",
          background: false,
          startedAt: new Date().toISOString(),
          inlineParts: [],
        }],
        createdAt: new Date().toISOString(),
      };
      const msg = createAssistantMessage([agentPart]);

      const event: StreamPartEvent = {
        type: "text-delta",
        delta: "sub-agent output",
        agentId: "agent-1",
      };

      const result = applyStreamPartEvent(msg, event);
      const updatedAgent = (result.parts?.[0] as AgentPart)?.agents[0];

      expect(updatedAgent).toBeDefined();
      expect(updatedAgent!.inlineParts).toHaveLength(1);
      expect((updatedAgent!.inlineParts![0] as TextPart).content).toBe("sub-agent output");
    });

    test("tool-start with agentId routes to agent inline parts", () => {
      const agentPart: AgentPart = {
        id: createPartId(),
        type: "agent",
        agents: [{
          id: "agent-2",
          name: "Debugger",
          task: "Debug issue",
          status: "running",
          background: false,
          startedAt: new Date().toISOString(),
          inlineParts: [],
        }],
        createdAt: new Date().toISOString(),
      };
      const msg = createAssistantMessage([agentPart]);

      const event: StreamPartEvent = {
        type: "tool-start",
        toolId: "tc-sub-1",
        toolName: "bash",
        input: { command: "echo test" },
        agentId: "agent-2",
      };

      const result = applyStreamPartEvent(msg, event);
      const updatedAgent = (result.parts?.[0] as AgentPart)?.agents[0];

      expect(updatedAgent).toBeDefined();
      expect(updatedAgent!.inlineParts).toHaveLength(1);
      expect((updatedAgent!.inlineParts![0] as ToolPart).toolName).toBe("bash");
    });
  });

  // -----------------------------------------------------------------------
  // 4. No bespoke rendering paths remain
  // -----------------------------------------------------------------------

  describe("rendering dispatch is exclusively via PART_REGISTRY", () => {
    test("PART_REGISTRY has exactly the expected number of renderers", () => {
      const registeredTypes = Object.keys(PART_REGISTRY);
      // All 11 part types must have renderers — no more, no less
      expect(registeredTypes).toHaveLength(11);
    });

    test("every Part type discriminant has a PART_REGISTRY entry", () => {
      // This ensures no part type can slip through without a renderer
      const allPartTypes: Part["type"][] = [
        "text",
        "reasoning",
        "tool",
        "agent",
        "task-list",
        "skill-load",
        "mcp-snapshot",
        "agent-list",
        "compaction",
        "task-result",
        "workflow-step",
      ];

      for (const type of allPartTypes) {
        expect(PART_REGISTRY[type]).toBeDefined();
      }

      // Registry should not contain any extra entries
      const registeredTypes = new Set(Object.keys(PART_REGISTRY));
      for (const type of allPartTypes) {
        registeredTypes.delete(type);
      }
      expect(registeredTypes.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Multi-stage lifecycle through unified pipeline
  // -----------------------------------------------------------------------

  describe("multi-stage workflow renders through unified pipeline", () => {
    test("planner → orchestrator → reviewer lifecycle creates correct parts", () => {
      let msg = createAssistantMessage();

      // Planner starts
      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        workflowId: "ralph",
        nodeId: "planner",
        nodeName: "Planner",
        indicator: "[PLANNER]",
      });

      // Planner produces text (standard pipeline, not bespoke)
      msg = applyStreamPartEvent(msg, {
        type: "text-delta",
        delta: "Planning tasks...",
      });

      // Planner completes
      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        workflowId: "ralph",
        nodeId: "planner",
        nodeName: "Planner",
        status: "completed",
        durationMs: 2000,
      });

      // Task list arrives
      msg = applyStreamPartEvent(msg, {
        type: "task-list-update",
        tasks: [
          { id: "t1", title: "Build feature", status: "pending" },
        ],
      });

      // Orchestrator starts
      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        workflowId: "ralph",
        nodeId: "orchestrator",
        nodeName: "Orchestrator",
        indicator: "[ORCHESTRATOR]",
      });

      // Orchestrator completes
      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        workflowId: "ralph",
        nodeId: "orchestrator",
        nodeName: "Orchestrator",
        status: "completed",
        durationMs: 10000,
      });

      // Reviewer starts and completes
      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-start",
        workflowId: "ralph",
        nodeId: "reviewer",
        nodeName: "Reviewer",
        indicator: "[REVIEWER]",
      });
      msg = applyStreamPartEvent(msg, {
        type: "workflow-step-complete",
        workflowId: "ralph",
        nodeId: "reviewer",
        nodeName: "Reviewer",
        status: "completed",
        durationMs: 3000,
      });

      // Verify all parts exist
      const parts = msg.parts ?? [];
      const stepParts = parts.filter((p) => p.type === "workflow-step") as WorkflowStepPart[];
      const taskParts = parts.filter((p) => p.type === "task-list") as TaskListPart[];
      const textParts = parts.filter((p) => p.type === "text") as TextPart[];

      expect(stepParts).toHaveLength(3);
      expect(stepParts[0]!.nodeId).toBe("planner");
      expect(stepParts[0]!.status).toBe("completed");
      expect(stepParts[1]!.nodeId).toBe("orchestrator");
      expect(stepParts[1]!.status).toBe("completed");
      expect(stepParts[2]!.nodeId).toBe("reviewer");
      expect(stepParts[2]!.status).toBe("completed");

      expect(taskParts).toHaveLength(1);
      expect(textParts).toHaveLength(1);
      expect(textParts[0]!.content).toBe("Planning tasks...");
    });
  });
});
