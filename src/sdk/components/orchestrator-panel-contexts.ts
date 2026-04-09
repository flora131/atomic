// ─── React Contexts & Hooks ───────────────────────

import { createContext, useContext, useSyncExternalStore } from "react";
import type { PanelStore } from "./orchestrator-panel-store.ts";
import type { GraphTheme } from "./graph-theme.ts";

export const StoreContext = createContext<PanelStore | null>(null);
export const ThemeContext = createContext<GraphTheme | null>(null);
export const TmuxSessionContext = createContext("");

export function useStore(): PanelStore {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreContext.Provider");
  return ctx;
}

export function useGraphTheme(): GraphTheme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useGraphTheme must be used within ThemeContext.Provider");
  return ctx;
}

/**
 * Subscribe to the store and return its current version.
 *
 * Uses `useSyncExternalStore` so the subscription is active from the
 * very first render — no `useEffect` timing gap that could cause a
 * missed `addSession` update.
 */
export function useStoreVersion(store: PanelStore): number {
  return useSyncExternalStore(
    store.subscribe,
    () => store.version,
  );
}
