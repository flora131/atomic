import type {
  RunSnapshot,
  StageSnapshot,
  StoreSnapshot,
} from "./store-types.js";

export interface ExpandedWorkflowStageTarget {
  readonly runId: string;
  readonly stageId: string;
  readonly runName: string;
  readonly depth: number;
}

export interface ExpandedWorkflowStage extends StageSnapshot {
  readonly workflowGraphTarget: ExpandedWorkflowStageTarget;
}

export interface ExpandedWorkflowGraph {
  readonly stages: readonly ExpandedWorkflowStage[];
  readonly targets: ReadonlyMap<string, ExpandedWorkflowStageTarget>;
}

interface ExpandedRunResult {
  readonly stages: ExpandedWorkflowStage[];
  readonly terminalIds: readonly string[];
}

function virtualStageId(runId: string, stageId: string, isRootRun: boolean): string {
  return isRootRun ? stageId : `${runId}:${stageId}`;
}

function childRunIdFor(stage: StageSnapshot): string | undefined {
  return stage.workflowChildRun?.runId ?? stage.workflowChild?.runId;
}

function childAliasFor(stage: StageSnapshot): string | undefined {
  return stage.workflowChildRun?.alias ?? stage.workflowChild?.alias;
}

function localTerminalStageIds(stages: readonly StageSnapshot[]): readonly string[] {
  const parentIds = new Set<string>();
  for (const stage of stages) {
    for (const parentId of stage.parentIds) parentIds.add(parentId);
  }
  const terminals = stages
    .filter((stage) => !parentIds.has(stage.id))
    .map((stage) => stage.id);
  return terminals.length > 0 ? terminals : stages.map((stage) => stage.id);
}

/**
 * Build a view-only expanded graph for a run and any nested child workflow
 * runs it references. Child stages are cloned with virtual ids so their local
 * parent ids do not collide with parent-run stage ids; each virtual node keeps
 * a target mapping back to the actual `{ runId, stageId }` for attach/control.
 */
export function expandWorkflowGraph(
  snapshot: StoreSnapshot,
  rootRunId: string,
): ExpandedWorkflowGraph {
  const runById = new Map(snapshot.runs.map((run) => [run.id, run]));
  const root = runById.get(rootRunId);
  if (!root) return { stages: [], targets: new Map() };

  const targets = new Map<string, ExpandedWorkflowStageTarget>();
  // Cycle guard only. This relies on the store invariant that each child run is
  // referenced by exactly one parent stage (runIds are unique and a child run
  // has a single boundary stage), so removing a run from `visiting` on exit
  // cannot double-expand a shared child into duplicate virtual stage ids. If
  // that invariant is ever relaxed, dedupe expanded stages by virtual id here.
  const visiting = new Set<string>();

  const expandRun = (
    run: RunSnapshot,
    depth: number,
    incomingParentIds: readonly string[],
  ): ExpandedRunResult => {
    if (visiting.has(run.id)) return { stages: [], terminalIds: [] };
    visiting.add(run.id);

    const isRootRun = run.id === rootRunId;
    const expandedStages: ExpandedWorkflowStage[] = [];
    const replacementTerminals = new Map<string, readonly string[]>();

    for (const stage of run.stages) {
      const id = virtualStageId(run.id, stage.id, isRootRun);
      const parentIds = stage.parentIds.length === 0
        ? [...incomingParentIds]
        : stage.parentIds.flatMap((parentId) =>
            replacementTerminals.get(parentId) ?? [virtualStageId(run.id, parentId, isRootRun)],
          );
      const target: ExpandedWorkflowStageTarget = {
        runId: run.id,
        stageId: stage.id,
        runName: run.name,
        depth,
      };
      targets.set(id, target);
      expandedStages.push({
        ...stage,
        id,
        parentIds: Object.freeze(parentIds),
        workflowGraphTarget: target,
      });

      const childRunId = childRunIdFor(stage);
      if (childRunId === undefined) continue;
      const childRun = runById.get(childRunId);
      if (childRun === undefined) continue;
      const childExpanded = expandRun(childRun, depth + 1, [id]);
      expandedStages.push(...childExpanded.stages);
      replacementTerminals.set(
        stage.id,
        childExpanded.terminalIds.length > 0 ? childExpanded.terminalIds : [id],
      );
    }

    const terminalIds = localTerminalStageIds(run.stages).flatMap((stageId) =>
      replacementTerminals.get(stageId) ?? [virtualStageId(run.id, stageId, isRootRun)],
    );

    visiting.delete(run.id);
    return { stages: expandedStages, terminalIds };
  };

  const expanded = expandRun(root, 0, []);
  return { stages: expanded.stages, targets };
}

export function expandedStageTarget(
  graph: ExpandedWorkflowGraph,
  virtualStageIdValue: string,
): ExpandedWorkflowStageTarget | undefined {
  return graph.targets.get(virtualStageIdValue);
}

export function stageMatchesExpandedIdentifier(
  stage: ExpandedWorkflowStage,
  target: string,
): boolean {
  return (
    stage.id === target ||
    stage.name === target ||
    stage.id.startsWith(target) ||
    stage.workflowGraphTarget.stageId === target ||
    stage.workflowGraphTarget.stageId.startsWith(target) ||
    stage.workflowGraphTarget.runId === target ||
    stage.workflowGraphTarget.runId.startsWith(target)
  );
}

export function expandedStageLabel(stage: ExpandedWorkflowStage): string {
  const runPrefix = stage.workflowGraphTarget.runId.slice(0, 8);
  const stagePrefix = stage.workflowGraphTarget.stageId.slice(0, 8);
  const depthPrefix = stage.workflowGraphTarget.depth > 0
    ? `${childAliasFor(stage) ?? stage.workflowGraphTarget.runName}:`
    : "";
  return `${depthPrefix}${stage.name} (${runPrefix}/${stagePrefix})`;
}
