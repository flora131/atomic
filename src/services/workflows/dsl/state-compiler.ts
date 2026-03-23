/**
 * State Compiler
 *
 * Transforms a `.state()` schema configuration (using string reducer names)
 * into an annotation factory compatible with the graph execution engine.
 *
 * Maps string reducer names to `Reducers.*` functions from `graph/annotation.ts`:
 * - "replace" → Reducers.replace (default)
 * - "concat" → Reducers.concat
 * - "merge" → Reducers.merge
 * - "mergeById" → Reducers.mergeById(config.key) — requires `key` field
 * - "max" → Reducers.max
 * - "min" → Reducers.min
 * - "sum" → Reducers.sum
 * - "or" → Reducers.or
 * - "and" → Reducers.and
 * - Custom function → passed through directly
 */

import type { StateFieldOptions } from "@/services/workflows/dsl/types.ts";
import type { AnnotationRoot, Reducer } from "@/services/workflows/graph/annotation.ts";
import { Reducers, initializeState } from "@/services/workflows/graph/annotation.ts";
import type { BaseState } from "@/services/workflows/graph/types.ts";

// ============================================================================
// REDUCER MAP
// ============================================================================

/**
 * Map of string reducer names to their corresponding Reducer functions.
 *
 * All entries except "mergeById" are concrete `Reducer<T>` functions.
 * "mergeById" is excluded because it is a factory that requires a key
 * parameter — it is handled as a special case in `resolveReducer`.
 *
 * Uses `Reducer<any>` to match the `AnnotationRoot` convention which
 * also uses `Annotation<any>` for heterogeneous state fields.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REDUCER_MAP: Record<string, Reducer<any>> = {
  replace: Reducers.replace,
  concat: Reducers.concat,
  merge: Reducers.merge,
  max: Reducers.max,
  min: Reducers.min,
  sum: Reducers.sum,
  or: Reducers.or,
  and: Reducers.and,
};

// ============================================================================
// RESOLVER
// ============================================================================

/**
 * Resolve a StateFieldOptions's reducer to a concrete Reducer function.
 *
 * - `undefined` → returns `undefined` (annotation defaults to replace)
 * - A function  → returned as-is (custom reducer)
 * - `"mergeById"` → requires `config.key`; returns `Reducers.mergeById(key)`
 * - Any other string → looked up in `REDUCER_MAP`
 *
 * @param config - The field config from `.state()`
 * @returns A Reducer function, or undefined for default (replace) behavior
 * @throws If `"mergeById"` is specified without a `key` field
 * @throws If an unrecognized string reducer name is provided
 */
export function resolveReducer<T>(config: StateFieldOptions<T>): Reducer<T> | undefined {
  if (config.reducer === undefined) {
    return undefined; // Default — annotation layer will use Reducers.replace
  }

  // Custom function reducer — pass through directly
  if (typeof config.reducer === "function") {
    return config.reducer as Reducer<T>;
  }

  // Special case: mergeById is a factory that needs a key parameter
  if (config.reducer === "mergeById") {
    if (!config.key) {
      throw new Error(
        'StateFieldOptions with reducer "mergeById" requires a "key" field',
      );
    }
    // Reducers.mergeById expects `keyof T` where T extends object.
    // The DSL uses `string` for the key. We specify Record<string, unknown>
    // as the type parameter to satisfy the `extends object` constraint,
    // then cast the resulting reducer to the caller's type.
    const mergeReducer = Reducers.mergeById<Record<string, unknown>>(config.key);
    return mergeReducer as unknown as Reducer<T>;
  }

  // Standard string reducer lookup
  const reducer = REDUCER_MAP[config.reducer];
  if (!reducer) {
    throw new Error(`Unknown reducer name: "${config.reducer}"`);
  }

  return reducer as unknown as Reducer<T>;
}

// ============================================================================
// SCHEMA COMPILER
// ============================================================================

/**
 * Compile a `.state()` schema into an AnnotationRoot.
 *
 * Takes the user-facing `StateFieldOptions` records (with string reducer names)
 * and produces an `AnnotationRoot` (with concrete Reducer functions) that
 * the graph engine understands.
 *
 * @param schema - State schema from the builder's `.state()` call
 * @returns An AnnotationRoot for use with `initializeState` / `applyStateUpdate`
 */
export function compileStateSchema(
  schema: Record<string, StateFieldOptions>,
): AnnotationRoot {
  const annotations: AnnotationRoot = {};

  for (const [key, config] of Object.entries(schema)) {
    const reducer = resolveReducer(config);
    annotations[key] = {
      default: config.default,
      reducer,
    };
  }

  return annotations;
}

// ============================================================================
// STATE FACTORY
// ============================================================================

/**
 * Parameters required to initialize workflow state.
 */
export interface StateFactoryParams {
  readonly prompt: string;
  readonly sessionId: string;
  readonly sessionDir: string;
}

/**
 * Create a state factory function from a `.state()` schema.
 *
 * The returned factory creates a new `BaseState` instance with:
 * - Standard `BaseState` fields (`executionId`, `lastUpdated`, `outputs`)
 * - All custom fields initialized to their schema defaults
 *
 * When no schema is provided, the factory returns a bare `BaseState`.
 *
 * @param schema - State schema from the builder's `.state()` call, or `undefined`
 * @returns A factory function compatible with `WorkflowDefinition.createState`
 */
export function createStateFactory(
  schema: Record<string, StateFieldOptions> | undefined,
): (params: StateFactoryParams) => BaseState {
  return (params: StateFactoryParams): BaseState => {
    const baseState: BaseState = {
      executionId: params.sessionId || crypto.randomUUID(),
      lastUpdated: new Date().toISOString(),
      outputs: {},
    };

    if (!schema) {
      return baseState;
    }

    const annotations = compileStateSchema(schema);
    const customState = initializeState(annotations);

    return {
      ...baseState,
      ...customState,
    };
  };
}
