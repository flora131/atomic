export function isSlashCommand(message: string): boolean {
  return message.startsWith("/");
}

export function parseSlashCommand(message: string): { command: string; args: string } {
  const trimmed = message.slice(1).trim();
  const wsIndex = trimmed.search(/[\s]/);
  if (wsIndex === -1) {
    return { command: trimmed.toLowerCase(), args: "" };
  }
  return {
    command: trimmed.slice(0, wsIndex).toLowerCase(),
    args: trimmed.slice(wsIndex + 1).trim(),
  };
}

export function handleThemeCommand(args: string): { newTheme: "dark" | "light"; message: string } | null {
  const themeName = args.toLowerCase();
  if (themeName === "dark" || themeName === "light") {
    return {
      newTheme: themeName,
      message: `Theme switched to ${themeName} mode.`,
    };
  }
  return null;
}
