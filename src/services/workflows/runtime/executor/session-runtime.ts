import { pipelineError } from "@/services/events/pipeline-logger.ts";
import type { WorkflowDefinition } from "@/services/workflows/types/index.ts";
import { registerActiveSession } from "@/services/agent-discovery/index.ts";
import type { CommandContext } from "@/types/command.ts";
import { getWorkflowSessionDir, initWorkflowSession } from "@/services/workflows/session.ts";

export interface WorkflowExecutionSessionRuntime {
  sessionDir: string;
  sessionId: string;
  workflowRunId: number;
}

export function initializeWorkflowExecutionSession(args: {
  context: CommandContext;
  definition: WorkflowDefinition;
  prompt: string;
}): WorkflowExecutionSessionRuntime {
  const { context, definition, prompt } = args;
  const sessionId = crypto.randomUUID();
  const sessionDir = getWorkflowSessionDir(definition.name, sessionId);
  const workflowRunId = crypto.getRandomValues(new Uint32Array(1))[0]!;

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
    sessionDir,
    sessionId,
    workflowRunId,
  };
}
