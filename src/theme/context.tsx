import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { darkTheme, darkThemeAnsi, lightTheme, lightThemeAnsi } from "@/theme/themes.ts";
import type { Theme, ThemeContextValue } from "@/theme/types.ts";

export interface ThemeProviderProps {
  initialTheme?: Theme;
  children: React.ReactNode;
}

const defaultContextValue: ThemeContextValue = {
  theme: darkTheme,
  toggleTheme: () => {},
  setTheme: () => {},
  isDark: true,
};

export const ThemeContext = createContext<ThemeContextValue>(defaultContextValue);

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function useThemeColors() {
  return useTheme().theme.colors;
}

export function ThemeProvider({
  initialTheme = darkTheme,
  children,
}: ThemeProviderProps): React.ReactNode {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const [dark, light] = useMemo(() => {
    const isAnsi = initialTheme === darkThemeAnsi || initialTheme === lightThemeAnsi;
    return isAnsi ? [darkThemeAnsi, lightThemeAnsi] : [darkTheme, lightTheme];
  }, [initialTheme]);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current.isDark ? light : dark));
  }, [dark, light]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme, setTheme: setThemeState, isDark: theme.isDark }),
    [theme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}
