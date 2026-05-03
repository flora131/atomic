/**
 * Frontier-based graph inference for workflow stage topology.
 *
 * Automatically infers parent-child edges from JavaScript's execution order:
 * - **Sequential** (`await`): completed stages are in the frontier when the
 *   next stage spawns → parent-child edge.
 * - **Parallel** (`Promise.all`): both calls fire in the same synchronous
 *   frame → frontier is empty for the second call → sibling edges.
 * - **Fan-in**: after `Promise.all` resolves, all parallel stages are in the
 *   frontier → the next stage depends on all of them.
 */
export class GraphFrontierTracker {
  /**
   * Stages that completed since the last stage was spawned in this scope.
   * When non-empty at spawn time, the new stage is sequential (depends on frontier).
   */
  private frontier: string[] = [];

  /**
   * The parent set for the current parallel batch — a snapshot of the frontier
   * at the point the first sibling consumed it.
   */
  private parallelAncestors: string[];

  constructor(parentName: string) {
    this.parallelAncestors = [parentName];
  }

  /**
   * Called synchronously when a new stage is spawned.
   * Returns the inferred graph parents for this stage.
   */
  onSpawn(): string[] {
    if (this.frontier.length > 0) {
      // Sequential: previous stage(s) completed → new wave
      this.parallelAncestors = [...this.frontier];
      this.frontier = [];
    }
    // Parallel sibling, first stage, or sequential → same ancestors
    return [...this.parallelAncestors];
  }

  /**
   * Called when a stage settles (completes or fails).
   * Adds the stage to the frontier so the next spawn can chain from it.
   */
  onSettle(name: string): void {
    this.frontier.push(name);
  }
}
