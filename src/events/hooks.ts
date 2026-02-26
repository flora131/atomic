/**
 * React Hooks for Event Bus
 *
 * This module provides React hooks for working with the event bus in components.
 * These hooks simplify event subscription and provide automatic cleanup on unmount.
 *
 * Key features:
 * - useEventBus: Access to bus and dispatcher instances
 * - useBusSubscription: Type-safe subscription with auto-cleanup
 * - useBusWildcard: Wildcard subscription with auto-cleanup
 * - Handler refs to avoid re-subscribing on handler identity changes
 *
 * Usage:
 * ```typescript
 * function MyComponent() {
 *   const { bus, dispatcher } = useEventBus();
 *
 *   // Subscribe to specific event
 *   useBusSubscription("stream.text.delta", (event) => {
 *     console.log(event.data.delta);
 *   });
 *
 *   // Subscribe to all events
 *   useBusWildcard((event) => {
 *     console.log(`[${event.type}]`, event.data);
 *   });
 *
 *   // Publish events
 *   const handleClick = () => {
 *     dispatcher.enqueue({ ... });
 *   };
 * }
 * ```
 */

import { useEffect, useRef } from "react";
import { useEventBusContext } from "./event-bus-provider.tsx";
import type { BusEvent, BusEventType, BusHandler, WildcardHandler } from "./bus-events.ts";

/**
 * Hook to get the event bus instance.
 *
 * Shorthand for useEventBusContext() that provides access to both the event bus
 * and batch dispatcher instances. The bus is used for subscribing to events,
 * while the dispatcher is used for publishing events.
 *
 * @returns The event bus context value containing bus and dispatcher
 * @throws Error if used outside EventBusProvider
 *
 * @example
 * ```typescript
 * function ChatComponent() {
 *   const { bus, dispatcher } = useEventBus();
 *
 *   // Use bus for subscriptions (via other hooks)
 *   // Use dispatcher to publish events
 *   const handleNewMessage = (text: string) => {
 *     dispatcher.enqueue({
 *       type: "stream.text.delta",
 *       sessionId: "abc123",
 *       runId: 1,
 *       timestamp: Date.now(),
 *       data: { delta: text, messageId: "msg1" }
 *     });
 *   };
 * }
 * ```
 */
export function useEventBus() {
  return useEventBusContext();
}

/**
 * Hook to subscribe to a specific event type on the bus.
 *
 * Automatically unsubscribes on unmount. Uses a ref for the handler to avoid
 * re-subscribing when the handler identity changes, which improves performance
 * and prevents unnecessary subscription churn.
 *
 * @param eventType - The specific event type to subscribe to
 * @param handler - Callback function to handle the event
 *
 * @example
 * ```typescript
 * function TextStreamComponent() {
 *   const [text, setText] = useState("");
 *
 *   useBusSubscription("stream.text.delta", (event) => {
 *     setText((prev) => prev + event.data.delta);
 *   });
 *
 *   return <div>{text}</div>;
 * }
 * ```
 *
 * @example
 * ```typescript
 * function ToolStatusComponent() {
 *   useBusSubscription("stream.tool.start", (event) => {
 *     console.log(`Tool started: ${event.data.toolName}`);
 *   });
 *
 *   useBusSubscription("stream.tool.complete", (event) => {
 *     console.log(`Tool completed: ${event.data.toolId}`);
 *   });
 * }
 * ```
 */
export function useBusSubscription<T extends BusEventType>(
  eventType: T,
  handler: BusHandler<T>
): void {
  const { bus } = useEventBusContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsubscribe = bus.on(eventType, ((event: BusEvent<T>) => {
      handlerRef.current(event);
    }) as BusHandler<T>);
    return unsubscribe;
  }, [bus, eventType]);
}

/**
 * Hook to subscribe to all events on the bus (wildcard).
 *
 * Automatically unsubscribes on unmount. Useful for debugging, logging,
 * and observability. Uses a ref for the handler to avoid re-subscribing
 * when the handler identity changes.
 *
 * @param handler - Callback function to handle all events
 *
 * @example
 * ```typescript
 * function DebugLogger() {
 *   useBusWildcard((event) => {
 *     console.debug(`[${event.type}] at ${event.timestamp}`, event.data);
 *   });
 *
 *   return null;
 * }
 * ```
 *
 * @example
 * ```typescript
 * function EventCounter() {
 *   const [count, setCount] = useState(0);
 *
 *   useBusWildcard((event) => {
 *     setCount((prev) => prev + 1);
 *   });
 *
 *   return <div>Total events: {count}</div>;
 * }
 * ```
 */
export function useBusWildcard(handler: WildcardHandler): void {
  const { bus } = useEventBusContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsubscribe = bus.onAll((event: BusEvent) => {
      handlerRef.current(event);
    });
    return unsubscribe;
  }, [bus]);
}
