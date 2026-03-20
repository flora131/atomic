/**
 * Shared Animation Tick Hook
 *
 * Provides a consolidated animation timer via a callback-based subscription.
 * Instead of each AnimatedBlinkIndicator, LoadingIndicator, and StreamingBullet
 * creating independent setInterval timers, all consumers share a single timer
 * managed by the provider. Each consumer hook maintains its own local state
 * and only re-renders when its derived value (blink toggle or spinner frame)
 * actually changes.
 *
 * This reduces N independent intervals to 1 shared interval during streaming,
 * where N can be 10+ (multiple running tools, agents, spinners), AND avoids
 * the context-value cascade where every consumer re-renders on every tick.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Base interval in milliseconds. This is the GCD of common animation speeds
 * (100ms spinner, 500ms blink) so all derived animations stay in sync.
 */
const BASE_INTERVAL_MS = 100;

// ============================================================================
// TYPES & CONTEXT
// ============================================================================

interface AnimationTickControl {
  subscribe: (callback: (tick: number) => void) => void;
  unsubscribe: (callback: (tick: number) => void) => void;
}

const AnimationTickControlContext = createContext<AnimationTickControl | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

interface AnimationTickProviderProps {
  children: ReactNode;
}

/**
 * Provides a shared animation tick to all descendant components.
 * The timer only runs when there are active consumers (components
 * using useBlinkAnimation / useSpinnerAnimation).
 *
 * Unlike a context-value approach, this provider does NOT store the tick
 * counter in React state. Instead, it invokes registered callbacks on each
 * tick. Each consumer hook decides independently whether to update its own
 * local state, so only components whose derived value changed will re-render.
 */
export function AnimationTickProvider({ children }: AnimationTickProviderProps): ReactNode {
  const subscribersRef = useRef<Set<(tick: number) => void>>(new Set());
  const tickRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // Stable subscription controller — never changes identity
  const controlRef = useRef<AnimationTickControl>({
    subscribe: (callback: (tick: number) => void) => {
      subscribersRef.current.add(callback);
      if (subscribersRef.current.size === 1 && !intervalRef.current) {
        intervalRef.current = setInterval(() => {
          tickRef.current += 1;
          const tick = tickRef.current;
          for (const cb of subscribersRef.current) {
            cb(tick);
          }
        }, BASE_INTERVAL_MS);
      }
    },
    unsubscribe: (callback: (tick: number) => void) => {
      subscribersRef.current.delete(callback);
      if (subscribersRef.current.size === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    },
  });

  return (
    <AnimationTickControlContext.Provider value={controlRef.current}>
      {children}
    </AnimationTickControlContext.Provider>
  );
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Returns a boolean that toggles at the specified speed.
 * All consumers sharing the same speed stay perfectly in sync because
 * they derive from the same global tick counter.
 *
 * Only triggers a re-render when the boolean value actually changes,
 * rather than on every tick interval.
 *
 * @param speed - Toggle interval in ms (default: 500)
 * @returns Whether the indicator should be in its "on" state
 */
export function useBlinkAnimation(speed: number = 500): boolean {
  const control = useContext(AnimationTickControlContext);
  const ticksPerToggle = Math.max(1, Math.round(speed / BASE_INTERVAL_MS));
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!control) return;

    const onTick = (tick: number) => {
      const next = Math.floor(tick / ticksPerToggle) % 2 === 0;
      setVisible((prev) => prev === next ? prev : next);
    };

    control.subscribe(onTick);
    return () => control.unsubscribe(onTick);
  }, [control, ticksPerToggle]);

  return visible;
}

/**
 * Returns a frame index for spinner animations.
 * Cycles through 0..frameCount-1 at the specified speed.
 *
 * Only triggers a re-render when the frame index actually changes.
 *
 * @param frameCount - Number of frames in the animation
 * @param speed - Frame interval in ms (default: 100)
 * @returns Current frame index
 */
export function useSpinnerAnimation(frameCount: number, speed: number = 100): number {
  const control = useContext(AnimationTickControlContext);
  const ticksPerFrame = Math.max(1, Math.round(speed / BASE_INTERVAL_MS));
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!control || frameCount <= 0) return;

    const onTick = (tick: number) => {
      const next = Math.floor(tick / ticksPerFrame) % frameCount;
      setFrameIndex((prev) => prev === next ? prev : next);
    };

    control.subscribe(onTick);
    return () => control.unsubscribe(onTick);
  }, [control, frameCount, ticksPerFrame]);

  return frameIndex;
}
