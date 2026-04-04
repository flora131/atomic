export type AtomicPrivilegedCommand = "update" | "uninstall";

/**
 * Detect permission-related filesystem failures surfaced by Bun/Node.
 */
export function isPermissionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("permission") || normalized.includes("eacces") || normalized.includes("eperm");
}

/**
 * Build consistent privilege escalation guidance for system-owned installs.
 */
export function getElevatedPrivilegesHint(
  command: AtomicPrivilegedCommand,
  isWindowsPlatform: boolean,
  includeManualFallback: boolean = false,
): string[] {
  const lines = [
    "",
    "Permission denied. Try running with elevated privileges:",
    isWindowsPlatform ? "  Run PowerShell as Administrator and try again" : `  sudo atomic ${command}`,
  ];

  if (includeManualFallback) {
    lines.push("", "Or manually delete the files shown above.");
  }

  return lines;
}
