import { join } from "path";
import { homedir } from "os";

import { applyStateUpdate, initializeState } from "../graph/annotation.ts";
import type { Annotation, Feature, Reducer } from "../graph/annotation.ts";
import type { ContextWindowUsage, DebugReport, NodeId } from "../graph/types.ts";
import type { TaskItem, ReviewResult } from "./prompts.ts";

function annotation<T>(defaultValue: T | (() => T), reducer?: Reducer<T>): Annotation<T> {
  return {
    default: defaultValue,
    reducer,
  };
}

function concatReducer<T>(current: T[], update: T[]): T[] {
  const currentArray = Array.isArray(current) ? current : [];
  const updateArray = Array.isArray(update) ? update : [];
  return [...currentArray, ...updateArray];
}

function mergeByIdReducer<T extends object>(idField: keyof T): Reducer<T[]> {
  return (current: T[], update: T[]): T[] => {
    const currentArray = Array.isArray(current) ? current : [];
    const updateArray = Array.isArray(update) ? update : [];
    const idMap = new Map<unknown, T>();

    for (const item of currentArray) {
      const id = item[idField];
      if (id !== undefined) {
        idMap.set(id, item);
      }
    }

    for (const item of updateArray) {
      const id = item[idField];
      if (id !== undefined) {
        const existing = idMap.get(id);
        if (existing) {
          idMap.set(id, { ...existing, ...item });
        } else {
          idMap.set(id, item);
        }
      }
    }

    return Array.from(idMap.values());
  };
}

export interface RalphWorkflowState {
  executionId: string;
  lastUpdated: string;
  outputs: Record<NodeId, unknown>;
  researchDoc: string;
  specDoc: string;
  specApproved: boolean;
  tasks: TaskItem[];
  currentTasks: TaskItem[];
  reviewResult: ReviewResult | null;
  fixesApplied: boolean;
  featureList: Feature[];
  currentFeature: Feature | null;
  allFeaturesPassing: boolean;
  contextWindowUsage: ContextWindowUsage | null;
  iteration: number;
  prUrl: string | null;
  debugReports: DebugReport[];
  ralphSessionId: string;
  ralphSessionDir: string;
  yolo: boolean;
  yoloPrompt: string | null;
  yoloComplete: boolean;
  maxIterations: number;
  shouldContinue: boolean;
  prBranch: string | undefined;
  completedFeatures: string[];
  sourceFeatureListPath: string | undefined;
  maxIterationsReached: boolean | undefined;
}

export const RalphStateAnnotation = {
  executionId: annotation<string>(""),
  lastUpdated: annotation<string>(() => new Date().toISOString()),
  outputs: annotation<Record<NodeId, unknown>>({}),

  researchDoc: annotation<string>(""),
  specDoc: annotation<string>(""),
  specApproved: annotation<boolean>(false),

  tasks: annotation<TaskItem[]>([], mergeByIdReducer<TaskItem>("id")),
  currentTasks: annotation<TaskItem[]>([], (current: TaskItem[], update: TaskItem[]) => update),
  reviewResult: annotation<ReviewResult | null>(null),
  fixesApplied: annotation<boolean>(false),

  featureList: annotation<Feature[]>([], mergeByIdReducer<Feature>("description")),
  currentFeature: annotation<Feature | null>(null),
  allFeaturesPassing: annotation<boolean>(false),

  debugReports: annotation<DebugReport[]>([], concatReducer),

  prUrl: annotation<string | null>(null),
  prBranch: annotation<string | undefined>(undefined),

  contextWindowUsage: annotation<ContextWindowUsage | null>(null),

  iteration: annotation<number>(1),

  ralphSessionId: annotation<string>(""),
  ralphSessionDir: annotation<string>(""),
  yolo: annotation<boolean>(false),
  yoloPrompt: annotation<string | null>(null),
  yoloComplete: annotation<boolean>(false),
  maxIterations: annotation<number>(100),
  shouldContinue: annotation<boolean>(true),
  completedFeatures: annotation<string[]>([], concatReducer),
  sourceFeatureListPath: annotation<string | undefined>(undefined),
  maxIterationsReached: annotation<boolean | undefined>(undefined),
};

/**
 * Create a new Ralph workflow state with default values.
 *
 * @param executionId - Unique ID for this execution (auto-generated if not provided)
 * @param options - Optional initial values for Ralph-specific fields
 * @returns Initialized RalphWorkflowState
 */
export function createRalphState(
  executionId?: string,
  options?: Partial<RalphWorkflowState>
): RalphWorkflowState {
  const state = initializeState(RalphStateAnnotation);
  const ralphSessionId = options?.ralphSessionId ?? crypto.randomUUID();

  return {
    ...state,
    executionId: executionId ?? crypto.randomUUID(),
    lastUpdated: new Date().toISOString(),
    tasks: options?.tasks ?? [],
    currentTasks: options?.currentTasks ?? [],
    reviewResult: options?.reviewResult ?? null,
    fixesApplied: options?.fixesApplied ?? false,
    ralphSessionId,
    ralphSessionDir: options?.ralphSessionDir ?? `${join(homedir(), ".atomic", "workflows", "sessions", ralphSessionId)}`,
    yolo: options?.yolo ?? false,
    yoloPrompt: options?.yoloPrompt ?? null,
    yoloComplete: options?.yoloComplete ?? false,
    maxIterations: options?.maxIterations ?? 100,
    shouldContinue: options?.shouldContinue ?? true,
    completedFeatures: options?.completedFeatures ?? [],
    sourceFeatureListPath: options?.sourceFeatureListPath,
    maxIterationsReached: options?.maxIterationsReached,
    prBranch: options?.prBranch,
    ...options,
  };
}

/**
 * Apply an update to a Ralph workflow state.
 *
 * @param current - Current state
 * @param update - Partial update to apply
 * @returns New state with updates applied
 */
export function updateRalphState(
  current: RalphWorkflowState,
  update: Partial<RalphWorkflowState>
): RalphWorkflowState {
  const newState = applyStateUpdate(RalphStateAnnotation, current, update);
  return {
    ...newState,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Type guard to check if a value is a valid RalphWorkflowState.
 */
export function isRalphWorkflowState(value: unknown): value is RalphWorkflowState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    // Base state fields
    typeof obj.executionId === "string" &&
    typeof obj.lastUpdated === "string" &&
    typeof obj.outputs === "object" &&
    obj.outputs !== null &&
    // Atomic workflow fields
    typeof obj.researchDoc === "string" &&
    typeof obj.specDoc === "string" &&
    typeof obj.specApproved === "boolean" &&
    Array.isArray(obj.tasks) &&
    Array.isArray(obj.currentTasks) &&
    typeof obj.fixesApplied === "boolean" &&
    Array.isArray(obj.featureList) &&
    typeof obj.allFeaturesPassing === "boolean" &&
    Array.isArray(obj.debugReports) &&
    typeof obj.iteration === "number" &&
    // Ralph-specific fields
    typeof obj.ralphSessionId === "string" &&
    typeof obj.ralphSessionDir === "string" &&
    typeof obj.yolo === "boolean" &&
    typeof obj.maxIterations === "number" &&
    typeof obj.shouldContinue === "boolean" &&
    Array.isArray(obj.completedFeatures)
  );
}
