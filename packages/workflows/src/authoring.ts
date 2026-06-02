/*
 * Type-only package authoring surface for standalone workflow packages.
 *
 * package.json points the root "types" condition here so authors can import
 * defineWorkflow and Type without pulling the Atomic runtime/extension graph into
 * their TypeScript program. Runtime loading still uses src/index.ts.
 */

import type { Static, TOptional, TSchema } from "typebox";

export { Type } from "typebox";
export type { Static, TSchema } from "typebox";

export type WorkflowSerializablePrimitive = string | number | boolean | null;
export type WorkflowSerializableValue =
  | WorkflowSerializablePrimitive
  | readonly WorkflowSerializableValue[]
  | { readonly [key: string]: WorkflowSerializableValue | undefined };
export type WorkflowSerializableObject = { readonly [key: string]: WorkflowSerializableValue | undefined };
export type WorkflowInputValues = WorkflowSerializableObject;
export type WorkflowOutputValues = WorkflowSerializableObject;

export type WorkflowOutputMode = "inline" | "file-only";
export type WorkflowContextMode = "fresh" | "fork";

export interface WorkflowModelFallbackFields {
  readonly fallbackModels?: readonly string[];
  readonly retryModels?: readonly string[];
}

export interface WorkflowModelAttempt extends WorkflowSerializableObject {
  readonly model: string;
  readonly success: boolean;
  readonly error?: string;
}

export interface WorkflowMaxOutput {
  readonly bytes?: number;
  readonly lines?: number;
}

export interface StageMcpOptions {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

export interface StageOptions extends WorkflowModelFallbackFields {
  readonly model?: string;
  readonly mcp?: StageMcpOptions;
  readonly cwd?: string;
  readonly context?: WorkflowContextMode;
  readonly forkFromSessionFile?: string;
  readonly gitWorktreeDir?: string;
  readonly baseBranch?: string;
  readonly sessionDir?: string;
  readonly output?: string | false;
  readonly outputMode?: WorkflowOutputMode;
  readonly reads?: readonly string[] | false;
  readonly maxOutput?: WorkflowMaxOutput;
  readonly artifacts?: boolean;
  readonly thinkingLevel?: string;
}

export interface CompleteStageOpts extends WorkflowModelFallbackFields {
  readonly model?: string;
  readonly maxTokens?: number;
}

export interface StageOutputOptions {
  readonly output?: string | false;
  readonly outputMode?: WorkflowOutputMode;
  readonly context?: WorkflowContextMode;
  readonly cwd?: string;
  readonly maxOutput?: WorkflowMaxOutput;
  readonly artifacts?: boolean;
  readonly sessionDir?: string;
}

export interface PromptOptions extends WorkflowModelFallbackFields {
  readonly model?: string;
  readonly maxTokens?: number;
}

export type StagePromptOptions = PromptOptions & StageOutputOptions;

export interface StageContext {
  readonly name: string;
  prompt(text: string, options?: StagePromptOptions): Promise<string>;
  complete(text: string, options?: CompleteStageOpts): Promise<string>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  subscribe(listener: (event: WorkflowSerializableValue) => void): () => void;
  readonly sessionFile: string | undefined;
  readonly sessionId: string;
  setModel(model: string): Promise<void>;
  setThinkingLevel(level: string): void;
  cycleModel(): Promise<WorkflowSerializableValue | undefined>;
  cycleThinkingLevel(): WorkflowSerializableValue;
  readonly agent: WorkflowSerializableValue;
  readonly model: WorkflowSerializableValue;
  readonly thinkingLevel: WorkflowSerializableValue;
  readonly messages: WorkflowSerializableValue;
  readonly isStreaming: boolean;
  navigateTree(
    targetId: string,
    options?: { readonly summarize?: boolean; readonly customInstructions?: string; readonly replaceInstructions?: boolean; readonly label?: string },
  ): Promise<{ readonly editorText?: string; readonly cancelled: boolean }>;
  compact(customInstructions?: string): Promise<WorkflowSerializableValue>;
  abortCompaction(): void;
  abort(): Promise<void>;
}

export interface WorkflowArtifact extends WorkflowSerializableObject {
  readonly kind: "output" | "session" | "diff" | "patch";
  readonly path: string;
  readonly taskName?: string;
  readonly branch?: string;
  readonly diffStat?: string;
  readonly filesChanged?: number;
  readonly insertions?: number;
  readonly deletions?: number;
}

export interface WorkflowTaskContext extends WorkflowSerializableObject {
  readonly name?: string;
  readonly text: string;
}

export type WorkflowTaskContextInput = string | WorkflowTaskContext | WorkflowTaskResult;

export interface WorkflowTaskResult extends WorkflowTaskContext {
  readonly stageName: string;
  readonly sessionId?: string;
  readonly sessionFile?: string;
  readonly artifacts?: readonly WorkflowArtifact[];
  readonly model?: string;
  readonly fastMode?: boolean;
  readonly attemptedModels?: readonly string[];
  readonly modelAttempts?: readonly WorkflowModelAttempt[];
  readonly warnings?: readonly string[];
}

export interface WorkflowTaskSessionFields {
  readonly prompt?: string;
  readonly task?: string;
  readonly output?: string | false;
  readonly outputMode?: WorkflowOutputMode;
  readonly reads?: readonly string[] | false;
  readonly worktree?: boolean;
  readonly gitWorktreeDir?: string;
  readonly baseBranch?: string;
  readonly maxOutput?: WorkflowMaxOutput;
  readonly artifacts?: boolean;
}

export interface WorkflowTaskOptions extends StageOptions, WorkflowTaskSessionFields {
  readonly previous?: WorkflowTaskContextInput | readonly WorkflowTaskContextInput[];
}

export interface WorkflowTaskStep extends WorkflowTaskOptions {
  readonly name: string;
}

export interface WorkflowSharedTaskDefaults extends StageOptions {
  readonly output?: string | false;
  readonly outputMode?: WorkflowOutputMode;
  readonly reads?: readonly string[] | false;
  readonly worktree?: boolean;
  readonly gitWorktreeDir?: string;
  readonly baseBranch?: string;
  readonly maxOutput?: WorkflowMaxOutput;
  readonly artifacts?: boolean;
}

export interface WorkflowChainOptions extends WorkflowSharedTaskDefaults {
  readonly task?: string;
  readonly chainDir?: string;
}

export interface WorkflowParallelOptions extends WorkflowSharedTaskDefaults {
  readonly task?: string;
  readonly concurrency?: number;
  readonly failFast?: boolean;
}

export interface WorkflowDirectTaskItem extends WorkflowTaskOptions {
  /** Task/stage label passed to direct task execution. */
  readonly name: string;
  /** Repeat count for direct parallel expansion. */
  readonly count?: number;
}

export interface WorkflowParallelChainStep {
  readonly parallel: readonly WorkflowDirectTaskItem[];
  readonly concurrency?: number;
  readonly failFast?: boolean;
  readonly worktree?: boolean;
  readonly gitWorktreeDir?: string;
  readonly baseBranch?: string;
}

export type WorkflowChainStep = WorkflowDirectTaskItem | WorkflowParallelChainStep;

export interface WorkflowDirectOptions extends StageOptions {
  /** Shared/root task used for `{task}` in direct parallel or chain steps. */
  readonly task?: string;
  /** Optional named chain identifier for status/artifact grouping. */
  readonly chainName?: string;
  readonly concurrency?: number;
  readonly failFast?: boolean;
  /** Chain-only shared artifact directory for relative reads, outputs, and worktree diffs. */
  readonly chainDir?: string;
  readonly reads?: readonly string[] | false;
  readonly output?: string | false;
  readonly outputMode?: WorkflowOutputMode;
  readonly worktree?: boolean;
  readonly gitWorktreeDir?: string;
  readonly baseBranch?: string;
  readonly maxOutput?: WorkflowMaxOutput;
  readonly artifacts?: boolean;
}

export interface WorkflowRunChildOptions<TInputs extends WorkflowInputValues = WorkflowInputValues> {
  readonly inputs?: TInputs;
  readonly stageName?: string;
}

export interface WorkflowChildResult<TOutputs extends WorkflowOutputValues = WorkflowOutputValues> extends WorkflowSerializableObject {
  readonly workflow: string;
  readonly runId: string;
  readonly status: "completed";
  readonly outputs: TOutputs;
}

export interface WorkflowUIContext {
  input(prompt: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
  select<T extends string>(message: string, options: readonly T[]): Promise<T>;
  editor(initial?: string): Promise<string>;
}

export interface WorkflowRunContext<TInputs extends WorkflowInputValues = WorkflowInputValues> {
  readonly inputs: Readonly<TInputs>;
  readonly cwd?: string;
  stage(name: string, options?: StageOptions): StageContext;
  task(name: string, options: WorkflowTaskOptions): Promise<WorkflowTaskResult>;
  chain(steps: readonly WorkflowTaskStep[], options?: WorkflowChainOptions): Promise<WorkflowTaskResult[]>;
  parallel(steps: readonly WorkflowTaskStep[], options?: WorkflowParallelOptions): Promise<WorkflowTaskResult[]>;
  workflow<TChildInputs extends WorkflowInputValues, TChildOutputs extends WorkflowOutputValues>(
    definition: WorkflowDefinition<TChildInputs, TChildOutputs>,
    options?: WorkflowRunChildOptions<TChildInputs>,
  ): Promise<WorkflowChildResult<TChildOutputs>>;
  readonly ui: WorkflowUIContext;
}

export type WorkflowRunFn<
  TInputs extends WorkflowInputValues = WorkflowInputValues,
  TOutputs extends WorkflowOutputValues = WorkflowOutputValues,
> = (ctx: WorkflowRunContext<TInputs>) => Promise<TOutputs> | TOutputs;

export interface WorkflowWorktreeInputBinding {
  readonly gitWorktreeDir: string;
  readonly baseBranch?: string;
}

export interface WorkflowDefinition<
  TInputs extends WorkflowInputValues = WorkflowInputValues,
  TOutputs extends WorkflowOutputValues = WorkflowOutputValues,
> {
  readonly __piWorkflow: true;
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string;
  readonly inputs: Readonly<Record<string, TSchema>>;
  readonly outputs?: Readonly<Record<string, TSchema>>;
  readonly inputBindings?: { readonly worktree?: WorkflowWorktreeInputBinding };
  run(ctx: WorkflowRunContext<TInputs>): Promise<TOutputs> | TOutputs;
}

type DeclaredEntry<K extends string, S extends TSchema> =
  S extends TOptional<TSchema>
    ? { readonly [P in K]?: Static<S> }
    : { readonly [P in K]: Static<S> };

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export interface WorkflowBuilder<
  TInputs extends WorkflowInputValues = {},
  TOutputs extends WorkflowOutputValues = {},
> {
  description(text: string): WorkflowBuilder<TInputs, TOutputs>;
  input<K extends string, S extends TSchema>(
    key: K,
    schema: S,
  ): WorkflowBuilder<Simplify<TInputs & DeclaredEntry<K, S>>, TOutputs>;
  output<K extends string, S extends TSchema>(
    key: K,
    schema: S,
  ): WorkflowBuilder<TInputs, Simplify<TOutputs & DeclaredEntry<K, S>>>;
  worktreeFromInputs(binding: WorkflowWorktreeInputBinding): WorkflowBuilder<TInputs, TOutputs>;
  run<TActualOutputs extends TOutputs>(
    fn: WorkflowRunFn<TInputs, TActualOutputs>,
  ): CompletedWorkflowBuilder<TInputs, TActualOutputs>;
}

export interface CompletedWorkflowBuilder<
  TInputs extends WorkflowInputValues = {},
  TOutputs extends WorkflowOutputValues = {},
> extends WorkflowBuilder<TInputs, TOutputs> {
  compile(): WorkflowDefinition<TInputs, TOutputs>;
}

export type AnyWorkflowDefinition = WorkflowDefinition<WorkflowInputValues, WorkflowOutputValues>;

export type RunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "killed";
export type WorkflowExecutionMode = "foreground" | "detached";
export type WorkflowDetailsMode = "named" | "single" | "parallel" | "chain" | "inspection" | "control";
export type WorkflowDetailsStatus = "accepted" | "running" | "completed" | "failed" | "killed" | "noop";
export type WorkflowAction = "list" | "get" | "inputs" | "run" | "status" | "interrupt" | "resume";

export interface RunOpts {
  readonly cwd?: string;
  readonly executionMode?: WorkflowExecutionMode;
  readonly runId?: string;
}

export interface StageSnapshot extends WorkflowSerializableObject {
  readonly id: string;
  readonly name: string;
  readonly status: RunStatus;
  readonly result?: WorkflowSerializableValue;
  readonly error?: string;
}

export interface RunResult<TOutputs extends WorkflowOutputValues = WorkflowOutputValues> extends WorkflowSerializableObject {
  readonly runId: string;
  readonly status: RunStatus;
  readonly result?: TOutputs;
  readonly error?: string;
  readonly stages: readonly StageSnapshot[];
}

export type ResolvedInputs<TInputs extends WorkflowInputValues = WorkflowInputValues> = Readonly<TInputs> & WorkflowSerializableObject;

export interface GitWorktreeSetupOptions extends WorkflowSerializableObject {
  readonly gitWorktreeDir: string;
  readonly baseBranch?: string;
  readonly cwd: string;
}

export interface GitWorktreeSetupResult extends WorkflowSerializableObject {
  readonly worktreeRoot: string;
  readonly cwd: string;
  readonly repositoryRoot: string;
  readonly created: boolean;
}

export interface WorkflowProgressSummary extends WorkflowSerializableObject {}
export interface WorkflowControlEvent extends WorkflowSerializableObject {}
export interface WorkflowIntercomSummary extends WorkflowSerializableObject {}

export interface WorkflowDetails extends WorkflowSerializableObject {
  readonly mode: WorkflowDetailsMode;
  readonly action?: WorkflowAction;
  readonly runId?: string;
  readonly status: WorkflowDetailsStatus;
  readonly context?: WorkflowContextMode;
  readonly results?: readonly WorkflowTaskResult[];
  readonly output?: WorkflowOutputValues;
  readonly progress?: WorkflowProgressSummary;
  readonly artifacts?: readonly WorkflowArtifact[];
  readonly controlEvents?: readonly WorkflowControlEvent[];
  readonly intercom?: WorkflowIntercomSummary;
  readonly warnings?: readonly string[];
  readonly error?: string;
}

export declare const INTERACTIVE_WORKFLOW_POLICY: WorkflowSerializableObject;
export declare const NON_INTERACTIVE_WORKFLOW_POLICY: WorkflowSerializableObject;
export declare function run<TInputs extends WorkflowInputValues, TOutputs extends WorkflowOutputValues>(
  definition: WorkflowDefinition<TInputs, TOutputs>,
  inputs: Readonly<TInputs>,
  opts?: RunOpts,
): Promise<RunResult<TOutputs>>;
export declare function runTask(task: WorkflowDirectTaskItem, runOptions?: RunOpts): Promise<WorkflowDetails>;
export declare function runTask(task: WorkflowDirectTaskItem, options?: WorkflowDirectOptions, runOptions?: RunOpts): Promise<WorkflowDetails>;
export declare function runParallel(tasks: readonly WorkflowDirectTaskItem[], options?: WorkflowDirectOptions, runOptions?: RunOpts): Promise<WorkflowDetails>;
export declare function runChain(steps: readonly WorkflowChainStep[], options?: WorkflowDirectOptions, runOptions?: RunOpts): Promise<WorkflowDetails>;
export declare function resolveInputs<TInputs extends WorkflowInputValues>(
  schema: Readonly<Record<keyof TInputs & string, TSchema>>,
  provided: Partial<TInputs>,
): ResolvedInputs<TInputs>;
export declare function setupGitWorktree(options: GitWorktreeSetupOptions): GitWorktreeSetupResult;

export interface WorkflowRegistry {
  register<TInputs extends WorkflowInputValues, TOutputs extends WorkflowOutputValues>(
    definition: WorkflowDefinition<TInputs, TOutputs>,
  ): WorkflowRegistry;
  merge(other: WorkflowRegistry): WorkflowRegistry;
  get(name: string): AnyWorkflowDefinition | undefined;
  has(name: string): boolean;
  remove(name: string): WorkflowRegistry;
  names(): string[];
  all(): AnyWorkflowDefinition[];
}

export declare function defineWorkflow(name: string): WorkflowBuilder;
export declare function createRegistry<TDefinitions extends readonly WorkflowDefinition<WorkflowInputValues, WorkflowOutputValues>[] = readonly WorkflowDefinition<WorkflowInputValues, WorkflowOutputValues>[]>(
  initial?: TDefinitions,
): WorkflowRegistry;
export declare function normalizeWorkflowName(name: string): string;
export declare function workflowNamesEqual(a: string, b: string): boolean;
