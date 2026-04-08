// ─── React Contexts & Hooks ───────────────────────

import { createContext, useContext, useState, useEffect } from "react";
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

export function useStoreSubscription(store: PanelStore): void {
  const [, forceRender] = useState(0);
  useEffect(() => store.subscribe(() => forceRender((c) => c + 1)), [store]);
}
