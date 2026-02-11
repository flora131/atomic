/**
 * Sub-Agent Graph Bridge
 *
 * Adapts SubagentSessionManager for use within graph execution context.
 * Wraps spawning with session-aware result persistence to
 * ~/.atomic/workflows/sessions/{sessionId}/agents/.
 *
 * Follows the existing setClientProvider() / setWorkflowResolver() global setter pattern.
 */

import type { SubagentSessionManager, SubagentSpawnOptions, SubagentResult } from "../ui/subagent-session-manager.ts";
import { saveSubagentOutput } from "../workflows/session.ts";

// ============================================================================
// Bridge Configuration
// ============================================================================

interface SubagentGraphBridgeConfig {
  sessionManager: SubagentSessionManager;
  sessionDir?: string;
}

// ============================================================================
// Bridge Class
// ============================================================================

export class SubagentGraphBridge {
  private sessionManager: SubagentSessionManager;
  private sessionDir: string | undefined;

  constructor(config: SubagentGraphBridgeConfig) {
    this.sessionManager = config.sessionManager;
    this.sessionDir = config.sessionDir;
  }

  setSessionDir(dir: string): void {
    this.sessionDir = dir;
  }

  async spawn(options: SubagentSpawnOptions): Promise<SubagentResult> {
    const result = await this.sessionManager.spawn(options);
    if (this.sessionDir) {
      await saveSubagentOutput(this.sessionDir, options.agentId, result);
    }
    return result;
  }

  async spawnParallel(
    agents: SubagentSpawnOptions[],
  ): Promise<SubagentResult[]> {
    const results = await this.sessionManager.spawnParallel(agents);
    if (this.sessionDir) {
      await Promise.all(
        results.map((result, i) =>
          saveSubagentOutput(this.sessionDir!, agents[i]!.agentId, result),
        ),
      );
    }
    return results;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalSubagentBridge: SubagentGraphBridge | null = null;

export function setSubagentBridge(bridge: SubagentGraphBridge): void {
  globalSubagentBridge = bridge;
}

export function getSubagentBridge(): SubagentGraphBridge | null {
  return globalSubagentBridge;
}
