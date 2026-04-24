/**
 * Orchestrator environment variable validation — extracted into its own
 * module so test files can import it directly without touching the
 * executor.ts module (which is mocked in worker.test.ts and
 * workflow-command.test.ts). Importing from here bypasses those mocks.
 */

import type { AgentType } from "../types.ts";
import { isValidAgent } from "../../services/config/definitions.ts";

/**
 * Read and validate the required orchestrator env vars, throwing on the
 * first missing or invalid value.
 *
 * Required vars: ATOMIC_WF_ID, ATOMIC_WF_TMUX, ATOMIC_WF_AGENT, ATOMIC_WF_CWD.
 */
export function validateOrchestratorEnv(): {
  workflowRunId: string;
  tmuxSessionName: string;
  agent: AgentType;
  cwd: string;
} {
  const requiredEnvVars = [
    "ATOMIC_WF_ID",
    "ATOMIC_WF_TMUX",
    "ATOMIC_WF_AGENT",
    "ATOMIC_WF_CWD",
  ] as const;
  for (const key of requiredEnvVars) {
    if (process.env[key] === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const workflowRunId = process.env.ATOMIC_WF_ID!;
  const tmuxSessionName = process.env.ATOMIC_WF_TMUX!;
  const rawAgent = process.env.ATOMIC_WF_AGENT!;
  if (!isValidAgent(rawAgent)) {
    throw new Error(
      `Invalid ATOMIC_WF_AGENT: "${rawAgent}". Expected one of: copilot, opencode, claude`,
    );
  }
  const cwd = process.env.ATOMIC_WF_CWD!;
  return { workflowRunId, tmuxSessionName, agent: rawAgent, cwd };
}
