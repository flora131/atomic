/**
 * Stable Callback & Value Hooks
 *
 * Utility hooks that eliminate the ref-mirroring boilerplate pattern common
 * throughout the codebase. Instead of manually creating refs and updating
 * them during render, these hooks encapsulate that pattern into reusable
 * primitives.
 *
 * **Before (manual ref-mirroring):**
 * ```ts
 * const callbackRef = useRef(callback);
 * callbackRef.current = callback;
 * // ... later, in some effect or event handler:
 * callbackRef.current(...args);
 * ```
 *
 * **After (with useStableCallback):**
 * ```ts
 * const stableCallback = useStableCallback(callback);
 * // stableCallback is identity-stable and always calls the latest callback
 * ```
 */

import { useRef, useCallback } from "react";

// ============================================================================
// USE STABLE CALLBACK
// ============================================================================

/**
 * Returns a stable (identity-preserving) wrapper around a callback function.
 *
 * The returned function never changes identity across renders, but always
 * delegates to the **latest** version of the provided callback. This is useful
 * when you need to pass a callback to a dependency array (e.g. `useEffect`,
 * `useCallback`) without causing re-execution, while still ensuring the
 * callback sees up-to-date closure values.
 *
 * The ref is updated **during render** (not inside `useEffect`), so the latest
 * callback is available immediately — even within the same render cycle.
 *
 * @template T - The callback function type
 * @param callback - The callback to stabilize
 * @returns A stable wrapper function with the same signature as `callback`
 *
 * @example
 * ```ts
 * function useMyHook(onComplete: (result: string) => void) {
 *   const stableOnComplete = useStableCallback(onComplete);
 *
 *   useEffect(() => {
 *     // stableOnComplete never changes, so this effect runs only once,
 *     // but it always calls the latest `onComplete`.
 *     someAsyncWork().then(stableOnComplete);
 *   }, [stableOnComplete]);
 * }
 * ```
 */
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T,
): T {
  const callbackRef = useRef<T>(callback);
  callbackRef.current = callback; // Updated during render — always fresh

  // The wrapper is created once and never changes identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(
    ((...args: any[]) => callbackRef.current(...args)) as T,
    [],
  );
}

// ============================================================================
// USE STABLE VALUE
// ============================================================================

/**
 * Returns a mutable ref that is automatically kept in sync with the provided
 * value on every render.
 *
 * This is the non-function counterpart to {@link useStableCallback}. Use it
 * when you need to read the latest value of a prop or derived state inside
 * an effect, event handler, or async callback **without** adding it to a
 * dependency array.
 *
 * The ref is updated **during render**, so it reflects the current value
 * immediately — even within the same render cycle.
 *
 * @template T - The type of the value to track
 * @param value - The value to keep in sync
 * @returns A `MutableRefObject<T>` whose `.current` always equals the latest `value`
 *
 * @example
 * ```ts
 * function useMyHook(modelId: string) {
 *   const modelIdRef = useStableValue(modelId);
 *
 *   useEffect(() => {
 *     // This effect runs once, but always reads the latest modelId.
 *     const interval = setInterval(() => {
 *       console.log("Current model:", modelIdRef.current);
 *     }, 1000);
 *     return () => clearInterval(interval);
 *   }, [modelIdRef]);
 * }
 * ```
 */
export function useStableValue<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef<T>(value);
  ref.current = value; // Updated during render — always fresh
  return ref;
}

export default useStableCallback;
