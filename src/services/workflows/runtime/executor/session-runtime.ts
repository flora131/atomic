import type { EventBus } from "@/services/events/event-bus.ts";
import { WorkflowEventAdapter } from "@/services/events/adapters/workflow-adapter.ts";
import { pipelineError } from "@/services/events/pipeline-logger.ts";
import { type WorkflowDefinition, registerActiveSession } from "@/commands/tui/workflow-commands.ts";
import type { CommandContext } from "@/commands/tui/registry.ts";
import { getWorkflowSessionDir, initWorkflowSession } from "@/services/workflows/session.ts";

export interface WorkflowExecutionSessionRuntime {
  eventAdapter?: WorkflowEventAdapter;
  sessionDir: string;
  sessionId: string;
  workflowRunId: number;
}

export function initializeWorkflowExecutionSession(args: {
  context: CommandContext;
  definition: WorkflowDefinition;
  eventBus?: EventBus;
  prompt: string;
}): WorkflowExecutionSessionRuntime {
  const { context, definition, eventBus, prompt } = args;
  const sessionId = crypto.randomUUID();
  const sessionDir = getWorkflowSessionDir(sessionId);
  const workflowRunId = crypto.getRandomValues(new Uint32Array(1))[0]!;
  const eventAdapter = eventBus
    ? new WorkflowEventAdapter(eventBus, sessionId, workflowRunId)
    : undefined;

  if (eventBus) {
    eventBus.publish({
      type: "stream.session.start",
      sessionId,
      runId: workflowRunId,
      timestamp: Date.now(),
      data: { config: { workflowName: definition.name } },
    });
  }

  void initWorkflowSession(definition.name, sessionId).then((session) => {
    registerActiveSession(session);
  }).catch((error) => {
    pipelineError("Workflow", "session_init_error", {
      workflow: definition.name,
      sessionId,
    });
    console.error("[workflow] Failed to initialize session:", error);
  });

  context.updateWorkflowState({
    workflowActive: true,
    workflowType: definition.name,
    workflowConfig: { sessionId, userPrompt: prompt, workflowName: definition.name },
  });
  context.setStreaming(true);

  return {
    eventAdapter,
    sessionDir,
    sessionId,
    workflowRunId,
  };
}
