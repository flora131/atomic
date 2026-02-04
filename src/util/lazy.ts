/**
 * Lazy initialization utility module.
 *
 * Creates a lazily evaluated value that is only computed on first access.
 * The result is cached and returned on subsequent calls.
 *
 * This pattern is useful for:
 * - Deferring expensive computations until they're actually needed
 * - Initializing singletons or configuration objects lazily
 * - Avoiding circular dependency issues by deferring evaluation
 *
 * @example
 * ```typescript
 * const expensiveConfig = lazy(() => {
 *   console.log('Computing...');
 *   return loadExpensiveConfig();
 * });
 *
 * // First call computes and caches
 * const config1 = expensiveConfig(); // logs "Computing..."
 *
 * // Subsequent calls return cached value
 * const config2 = expensiveConfig(); // no log, returns cached value
 *
 * // Reset to recompute on next access
 * expensiveConfig.reset();
 * const config3 = expensiveConfig(); // logs "Computing..." again
 * ```
 */

/**
 * Creates a lazily evaluated value.
 *
 * @template T - The type of the lazily computed value
 * @param fn - A function that computes the value (called at most once until reset)
 * @returns A function that returns the cached value, with a reset() method to clear the cache
 */
export function lazy<T>(fn: () => T): (() => T) & { reset: () => void } {
  let cached: T | undefined;
  let computed = false;

  const get = (() => {
    if (!computed) {
      cached = fn();
      computed = true;
    }
    return cached as T;
  }) as (() => T) & { reset: () => void };

  get.reset = () => {
    cached = undefined;
    computed = false;
  };

  return get;
}

export default lazy;
