/**
 * Event Bus Provider for React Context
 *
 * This module provides a React context provider for the AtomicEventBus singleton.
 * The event bus and batch dispatcher are created once and shared across the
 * entire application via React context.
 *
 * Key features:
 * - Singleton pattern: bus and dispatcher created once via useMemo
 * - Context throws if used outside provider for early error detection
 * - No cleanup needed since these are app-lifetime singletons
 *
 * Usage:
 * ```typescript
 * // In your app root:
 * <EventBusProvider>
 *   <YourApp />
 * </EventBusProvider>
 *
 * // In your components:
 * const { bus, dispatcher } = useEventBusContext();
 * ```
 */

import React, { createContext, useContext, useMemo } from "react";
import { AtomicEventBus } from "./event-bus.ts";
import { BatchDispatcher } from "./batch-dispatcher.ts";

/**
 * Context value containing the event bus singleton and batch dispatcher.
 */
interface EventBusContextValue {
  /** The global event bus for pub/sub operations */
  bus: AtomicEventBus;
  /** The batch dispatcher for efficient event batching */
  dispatcher: BatchDispatcher;
}

/**
 * React context for the event bus singleton.
 * @internal
 */
const EventBusContext = createContext<EventBusContextValue | null>(null);

/**
 * Provider component for the event bus singleton.
 *
 * Creates a singleton instance of the AtomicEventBus and BatchDispatcher
 * that persists for the lifetime of the application. These instances are
 * shared across all components via React context.
 *
 * The bus and dispatcher are created once via useMemo and never re-created,
 * ensuring consistent event routing throughout the app.
 *
 * @example
 * ```typescript
 * function App() {
 *   return (
 *     <EventBusProvider>
 *       <ChatUI />
 *     </EventBusProvider>
 *   );
 * }
 * ```
 */
export function EventBusProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => {
    const bus = new AtomicEventBus();
    const dispatcher = new BatchDispatcher(bus);
    return { bus, dispatcher };
  }, []);

  return (
    <EventBusContext.Provider value={value}>
      {children}
    </EventBusContext.Provider>
  );
}

/**
 * Hook to access the event bus context.
 *
 * Returns the singleton event bus and batch dispatcher instances.
 * Throws an error if called outside of an EventBusProvider, ensuring
 * early detection of incorrect usage.
 *
 * @returns The event bus context value containing bus and dispatcher
 * @throws Error if used outside EventBusProvider
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const { bus, dispatcher } = useEventBusContext();
 *
 *   // Subscribe to events
 *   useEffect(() => {
 *     return bus.on("stream.text.delta", (event) => {
 *       console.log(event.data.delta);
 *     });
 *   }, [bus]);
 *
 *   // Enqueue events
 *   dispatcher.enqueue({
 *     type: "stream.text.delta",
 *     sessionId: "abc123",
 *     runId: 1,
 *     timestamp: Date.now(),
 *     data: { delta: "Hello", messageId: "msg1" }
 *   });
 * }
 * ```
 */
export function useEventBusContext(): EventBusContextValue {
  const ctx = useContext(EventBusContext);
  if (!ctx) {
    throw new Error("useEventBusContext must be used within an EventBusProvider");
  }
  return ctx;
}
