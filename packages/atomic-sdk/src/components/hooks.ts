/**
 * Shared React hooks for OpenTUI components.
 */

import { useRef } from "react";

/**
 * Return a ref whose `.current` always holds the latest value.
 *
 * Useful for reading state inside event callbacks (e.g. `useKeyboard`)
 * that capture the initial closure and would otherwise go stale.
 *
 * This is safe because OpenTUI's React reconciler is synchronous —
 * the ref is assigned during render, which is guaranteed to complete
 * before any event handler fires.
 */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
