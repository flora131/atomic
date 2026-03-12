export interface ThemeColors {
  background: string;
  foreground: string;
  accent: string;
  border: string;
  userMessage: string;
  assistantMessage: string;
  systemMessage: string;
  error: string;
  success: string;
  warning: string;
  muted: string;
  inputFocus: string;
  inputStreaming: string;
  userBubbleBg: string;
  userBubbleFg: string;
  dim: string;
  scrollbarFg: string;
  scrollbarBg: string;
  codeBorder: string;
  codeTitle: string;
}

export interface Theme {
  name: string;
  isDark: boolean;
  colors: ThemeColors;
}

export interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
}
