/**
 * useThrottledValue Hook
 *
 * Throttles rapid value updates to prevent UI thrashing during streaming.
 * Used primarily for TextPart content updates during rapid text deltas.
 *
 * Inspired by OpenCode's createThrottledValue() pattern.
 */

import { useState, useEffect, useRef } from "react";

/**
 * Returns a throttled version of the input value that updates at most
 * once per `intervalMs` milliseconds.
 *
 * @param value - The rapidly-changing source value
 * @param intervalMs - Minimum interval between updates (default: 100ms)
 * @returns The throttled value
 */
export function useThrottledValue<T>(value: T, intervalMs: number = 100): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdateRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;
    if (elapsed >= intervalMs) {
      lastUpdateRef.current = now;
      setThrottled(value);
    } else {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => {
        lastUpdateRef.current = Date.now();
        setThrottled(value);
        pendingRef.current = null;
      }, intervalMs - elapsed);
    }
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, [value, intervalMs]);

  return throttled;
}

export default useThrottledValue;
