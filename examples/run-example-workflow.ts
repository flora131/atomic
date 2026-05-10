import { closeDaemonConnection, runWorkflow } from "@bastani/atomic-sdk/workflows";
import { PanelClient } from "@bastani/atomic-sdk/components/panel-client";
import type { RegistrableWorkflow } from "@bastani/atomic-sdk";

export interface RunExampleWorkflowOptions {
  workflow: RegistrableWorkflow;
  inputs?: Record<string, string>;
  detach?: boolean;
  pathToAtomicExecutable?: string;
}

/**
 * Run an example workflow with the same foreground UX as `atomic workflow`.
 *
 * In an interactive terminal, foreground runs start the daemon workflow and
 * immediately mount the Atomic panel so users see the workflow pane. In
 * non-TTY contexts (tests/CI), foreground runs wait for `run/ended` without
 * mounting OpenTUI. Detached runs always return after `workflow/start`.
 */
export async function runExampleWorkflow({
  workflow,
  inputs = {},
  detach = false,
  pathToAtomicExecutable,
}: RunExampleWorkflowOptions): Promise<string> {
  if (detach || !process.stdout.isTTY) {
    const result = await runWorkflow({
      workflow,
      inputs,
      detach,
      pathToAtomicExecutable,
    });
    closeDaemonConnection(result.daemon);
    return result.runId;
  }

  const result = await runWorkflow({
    workflow,
    inputs,
    detach: true,
    pathToAtomicExecutable,
  });
  closeDaemonConnection(result.daemon);

  await PanelClient.mount({ runId: result.runId });
  return result.runId;
}
