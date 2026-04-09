/** @jsxImportSource @opentui/react */

import type { ReactNode } from "react";
import { PanelStore } from "@/sdk/components/orchestrator-panel-store.ts";
import {
  StoreContext,
  ThemeContext,
  TmuxSessionContext,
} from "@/sdk/components/orchestrator-panel-contexts.ts";
import type { GraphTheme } from "@/sdk/components/graph-theme.ts";

export const TEST_THEME: GraphTheme = {
  background: "#1e1e2e",
  backgroundElement: "#313244",
  text: "#cdd6f4",
  textMuted: "#a6adc8",
  textDim: "#7f849c",
  primary: "#89b4fa",
  success: "#a6e3a1",
  error: "#f38ba8",
  warning: "#f9e2af",
  info: "#89b4fa",
  border: "#585b70",
  borderActive: "#6c7086",
};

export function TestProviders({
  store,
  theme,
  tmuxSession,
  children,
}: {
  store: PanelStore;
  theme?: GraphTheme;
  tmuxSession?: string;
  children: ReactNode;
}) {
  return (
    <StoreContext.Provider value={store}>
      <ThemeContext.Provider value={theme ?? TEST_THEME}>
        <TmuxSessionContext.Provider value={tmuxSession ?? "test-session"}>
          {children}
        </TmuxSessionContext.Provider>
      </ThemeContext.Provider>
    </StoreContext.Provider>
  );
}
